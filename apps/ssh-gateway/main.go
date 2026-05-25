package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync/atomic"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

type validateResponse struct {
	SandboxID string `json:"sandboxId"`
	HostPort  int    `json:"hostPort"`
	ExpiresAt string `json:"expiresAt"`
}

func main() {
	port := envOrDefault("SSH_GATEWAY_PORT", "2222")
	apiURL := envOrDefault("API_URL", "http://localhost:3210")
	apiKey := os.Getenv("API_KEY")
	sshUser := envOrDefault("SSH_USER", "root")
	gatewayKeyPath := envOrDefault("SSH_GATEWAY_KEY", "data/ssh/gateway-key")
	hostKeyPath := envOrDefault("SSH_HOST_KEY", "data/ssh/gateway_host_key")
	idleTimeout := readDurationSeconds("SSH_IDLE_TIMEOUT_SECONDS", 10*60)

	ensureHostKey(hostKeyPath)

	hostKeyBytes, err := os.ReadFile(hostKeyPath)
	if err != nil {
		log.Fatalf("failed to read host key: %v", err)
	}

	hostKey, err := gossh.ParsePrivateKey(hostKeyBytes)
	if err != nil {
		log.Fatalf("failed to parse host key: %v", err)
	}

	gatewaySigner := loadOrGenerateGatewayKey(gatewayKeyPath)

	config := &gossh.ServerConfig{
		NoClientAuth: true,

		PasswordCallback: func(c gossh.ConnMetadata, pass []byte) (*gossh.Permissions, error) {
			return nil, fmt.Errorf("password auth not supported")
		},
		PublicKeyCallback: func(c gossh.ConnMetadata, pubKey gossh.PublicKey) (*gossh.Permissions, error) {
			return nil, fmt.Errorf("public key auth not supported at gateway")
		},
	}
	config.AddHostKey(hostKey)

	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatalf("failed to listen on :%s: %v", port, err)
	}
	log.Printf("SSH gateway listening on :%s", port)
	log.Printf("gateway key loaded, connecting to sandboxes as user %q", sshUser)

	for {
		tcpConn, err := listener.Accept()
		if err != nil {
			log.Printf("accept failed: %v", err)
			continue
		}
		go handleConnection(tcpConn, config, apiURL, apiKey, sshUser, gatewaySigner, idleTimeout)
	}
}

func handleConnection(
	tcpConn net.Conn,
	config *gossh.ServerConfig,
	apiURL, apiKey, sshUser string,
	gatewaySigner gossh.Signer,
	idleTimeout time.Duration,
) {
	defer tcpConn.Close()

	tcpConn.SetDeadline(time.Now().Add(30 * time.Second))

	conn, chans, reqs, err := gossh.NewServerConn(tcpConn, config)
	if err != nil {
		log.Printf("SSH handshake failed: %v", err)
		return
	}

	tcpConn.SetDeadline(time.Time{})

	token := conn.User()
	log.Printf("connection from %s, token=%s", conn.RemoteAddr(), token[:min(8, len(token))]+"...")

	target, err := validateToken(apiURL, apiKey, token)
	if err != nil {
		log.Printf("token validation failed: %v", err)
		conn.Close()
		return
	}
	expiresAt, err := time.Parse(time.RFC3339, target.ExpiresAt)
	if err != nil {
		log.Printf("invalid token expiry for sandbox=%s: %v", target.SandboxID, err)
		conn.Close()
		return
	}
	if !expiresAt.After(time.Now()) {
		log.Printf("token already expired for sandbox=%s", target.SandboxID)
		conn.Close()
		return
	}

	sandboxAddr := fmt.Sprintf("127.0.0.1:%d", target.HostPort)
	log.Printf("token validated: sandbox=%s connecting to %s as user %q", target.SandboxID, sandboxAddr, sshUser)

	sandboxConfig := &gossh.ClientConfig{
		User: sshUser,
		Auth: []gossh.AuthMethod{
			gossh.PublicKeys(gatewaySigner),
		},
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	sandboxConn, err := gossh.Dial("tcp", sandboxAddr, sandboxConfig)
	if err != nil {
		log.Printf("failed to connect to sandbox %s: %v", sandboxAddr, err)
		conn.Close()
		return
	}
	defer sandboxConn.Close()

	var closed atomic.Bool
	closeConns := func() {
		if closed.CompareAndSwap(false, true) {
			_ = conn.Close()
			_ = sandboxConn.Close()
			_ = tcpConn.Close()
		}
	}

	lastActivityNs := atomic.Int64{}
	lastActivityNs.Store(time.Now().UnixNano())
	touch := func() {
		lastActivityNs.Store(time.Now().UnixNano())
	}

	go enforceSessionLimits(closeConns, &lastActivityNs, expiresAt, idleTimeout)

	go gossh.DiscardRequests(reqs)

	for newChannel := range chans {
		go bridgeChannel(newChannel, sandboxConn, touch, closeConns)
	}
}

func bridgeChannel(
	newChannel gossh.NewChannel,
	sandboxConn *gossh.Client,
	touch func(),
	closeConns func(),
) {
	clientChannel, clientReqs, err := newChannel.Accept()
	if err != nil {
		log.Printf("failed to accept channel: %v", err)
		return
	}
	defer clientChannel.Close()

	sandboxChannel, sandboxReqs, err := sandboxConn.OpenChannel(newChannel.ChannelType(), newChannel.ExtraData())
	if err != nil {
		log.Printf("failed to open sandbox channel: %v", err)
		return
	}
	defer sandboxChannel.Close()

	var wg sync.WaitGroup
	wg.Add(4)

	go func() {
		defer wg.Done()
		for req := range clientReqs {
			if req == nil {
				return
			}
			touch()
			ok, err := sandboxChannel.SendRequest(req.Type, req.WantReply, req.Payload)
			if req.WantReply {
				replyPayload := []byte(nil)
				if err != nil {
					replyPayload = []byte(err.Error())
				}
				req.Reply(ok, replyPayload)
			}
		}
	}()

	go func() {
		defer wg.Done()
		for req := range sandboxReqs {
			if req == nil {
				return
			}
			touch()
			ok, err := clientChannel.SendRequest(req.Type, req.WantReply, req.Payload)
			if req.WantReply {
				replyPayload := []byte(nil)
				if err != nil {
					replyPayload = []byte(err.Error())
				}
				req.Reply(ok, replyPayload)
			}
		}
	}()

	go func() {
		defer wg.Done()
		_, _ = io.Copy(sandboxChannel, &activityReader{Reader: clientChannel, touch: touch})
		_ = sandboxChannel.CloseWrite()
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(clientChannel, &activityReader{Reader: sandboxChannel, touch: touch})
		_ = clientChannel.CloseWrite()
		closeConns()
	}()

	wg.Wait()
}

func validateToken(apiURL, apiKey, token string) (*validateResponse, error) {
	u, _ := url.Parse(apiURL + "/ssh/validate")
	q := u.Query()
	q.Set("token", token)
	u.RawQuery = q.Encode()
	
	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("api request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("api returned %d: %s", resp.StatusCode, string(body))
	}

	var result validateResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	if result.HostPort == 0 {
		return nil, fmt.Errorf("invalid response: hostPort is 0")
	}

	return &result, nil
}

type activityReader struct {
	io.Reader
	touch func()
}

func (r *activityReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	if n > 0 && r.touch != nil {
		r.touch()
	}
	return n, err
}

func enforceSessionLimits(
	closeConns func(),
	lastActivityNs *atomic.Int64,
	expiresAt time.Time,
	idleTimeout time.Duration,
) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		now := time.Now()
		if !expiresAt.IsZero() && !now.Before(expiresAt) {
			log.Printf("closing SSH session at absolute expiry %s", expiresAt.Format(time.RFC3339))
			closeConns()
			return
		}
		if idleTimeout > 0 {
			last := time.Unix(0, lastActivityNs.Load())
			if now.Sub(last) >= idleTimeout {
				log.Printf("closing SSH session after idle timeout %s", idleTimeout)
				closeConns()
				return
			}
		}

		sleep := 5 * time.Second
		if !expiresAt.IsZero() {
			untilExpiry := time.Until(expiresAt)
			if untilExpiry <= 0 {
				closeConns()
				return
			}
			sleep = minDuration(sleep, untilExpiry)
		}
		if idleTimeout > 0 {
			last := time.Unix(0, lastActivityNs.Load())
			untilIdle := idleTimeout - now.Sub(last)
			if untilIdle <= 0 {
				closeConns()
				return
			}
			sleep = minDuration(sleep, untilIdle)
		}

		ticker.Reset(maxDuration(500*time.Millisecond, sleep))
		<-ticker.C
	}
}

func readDurationSeconds(key string, fallbackSeconds int) time.Duration {
	raw := envOrDefault(key, "")
	if raw == "" {
		return time.Duration(fallbackSeconds) * time.Second
	}
	var seconds int
	if _, err := fmt.Sscanf(raw, "%d", &seconds); err != nil || seconds < 0 {
		return time.Duration(fallbackSeconds) * time.Second
	}
	return time.Duration(seconds) * time.Second
}

func minDuration(a, b time.Duration) time.Duration {
	return time.Duration(math.Min(float64(a), float64(b)))
}

func maxDuration(a, b time.Duration) time.Duration {
	return time.Duration(math.Max(float64(a), float64(b)))
}

func loadOrGenerateGatewayKey(path string) gossh.Signer {
	if data, err := os.ReadFile(path); err == nil {
		signer, err := gossh.ParsePrivateKey(data)
		if err == nil {
			log.Printf("loaded gateway key from %s", path)
			return signer
		}
		log.Printf("failed to parse gateway key at %s, regenerating: %v", path, err)
	}

	log.Printf("generating new gateway key at %s", path)

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		log.Fatalf("failed to generate gateway key: %v", err)
	}

	privBytes, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		log.Fatalf("failed to marshal private key: %v", err)
	}

	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: privBytes,
	})

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		log.Fatalf("failed to create gateway key dir: %v", err)
	}

	if err := os.WriteFile(path, privPEM, 0o600); err != nil {
		log.Fatalf("failed to write gateway private key: %v", err)
	}

	pubSSH, err := gossh.NewPublicKey(pub)
	if err != nil {
		log.Fatalf("failed to create public key: %v", err)
	}

	pubLine := string(gossh.MarshalAuthorizedKey(pubSSH))
	pubPath := path + ".pub"
	if err := os.WriteFile(pubPath, []byte(pubLine), 0o644); err != nil {
		log.Fatalf("failed to write gateway public key: %v", err)
	}

	log.Printf("gateway key generated, public key saved to %s", pubPath)

	signer, err := gossh.ParsePrivateKey(privPEM)
	if err != nil {
		log.Fatalf("failed to parse freshly generated key: %v", err)
	}
	return signer
}

func ensureHostKey(path string) {
	if _, err := os.Stat(path); err == nil {
		return
	}
	log.Printf("generating gateway host key at %s", path)

	_, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		log.Fatalf("failed to generate host key: %v", err)
	}

	privBytes, err := x509.MarshalPKCS8PrivateKey(privKey)
	if err != nil {
		log.Fatalf("failed to marshal private key: %v", err)
	}

	pemBlock := &pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: privBytes,
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		log.Fatalf("failed to create host key dir: %v", err)
	}

	if err := os.WriteFile(path, pem.EncodeToMemory(pemBlock), 0o600); err != nil {
		log.Fatalf("failed to write host key: %v", err)
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
