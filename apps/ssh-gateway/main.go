package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

type validateResponse struct {
	SandboxID string `json:"sandboxId"`
	HostPort  int    `json:"hostPort"`
}

type apiError struct {
	StatusCode int    `json:"statusCode"`
	Message    string `json:"message"`
}

func main() {
	port := envOrDefault("SSH_GATEWAY_PORT", "2222")
	apiURL := envOrDefault("API_URL", "http://localhost:3210")
	apiKey := os.Getenv("API_KEY")

	hostKeyPath := envOrDefault("SSH_HOST_KEY", "/etc/ssh-gateway/host_key")
	ensureHostKey(hostKeyPath)

	hostKeyBytes, err := os.ReadFile(hostKeyPath)
	if err != nil {
		log.Fatalf("failed to read host key: %v", err)
	}

	hostKey, err := gossh.ParsePrivateKey(hostKeyBytes)
	if err != nil {
		log.Fatalf("failed to parse host key: %v", err)
	}

	config := &gossh.ServerConfig{
		PasswordCallback: func(c gossh.ConnMetadata, pass []byte) (*gossh.Permissions, error) {
			return nil, fmt.Errorf("password auth not supported")
		},
		PublicKeyCallback: func(c gossh.ConnMetadata, pubKey gossh.PublicKey) (*gossh.Permissions, error) {
			return nil, fmt.Errorf("public key auth not supported at gateway")
		},
		NoClientAuth: false,
	}
	config.AddHostKey(hostKey)

	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatalf("failed to listen on :%s: %v", port, err)
	}
	log.Printf("SSH gateway listening on :%s", port)

	for {
		tcpConn, err := listener.Accept()
		if err != nil {
			log.Printf("accept failed: %v", err)
			continue
		}
		go handleConnection(tcpConn, config, apiURL, apiKey)
	}
}

func handleConnection(tcpConn net.Conn, config *gossh.ServerConfig, apiURL, apiKey string) {
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
		log.Printf("token validation failed for %s: %v", token[:min(8, len(token))], err)
		conn.Close()
		return
	}

	log.Printf("token validated: sandbox=%s hostPort=%d", target.SandboxID, target.HostPort)

	go gossh.DiscardRequests(reqs)

	for newChannel := range chans {
		go handleChannel(newChannel, target.HostPort)
	}
}

func handleChannel(newChannel gossh.NewChannel, hostPort int) {
	target, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", hostPort), 10*time.Second)
	if err != nil {
		log.Printf("failed to connect to sandbox port %d: %v", hostPort, err)
		_ = newChannel.Reject(gossh.ConnectionFailed, fmt.Sprintf("sandbox unreachable: %v", err))
		return
	}
	defer target.Close()

	channel, _, err := newChannel.Accept()
	if err != nil {
		log.Printf("failed to accept channel: %v", err)
		return
	}
	defer channel.Close()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		io.Copy(channel, target)
		channel.CloseWrite()
	}()
	go func() {
		defer wg.Done()
		io.Copy(target, channel)
		if tc, ok := target.(*net.TCPConn); ok {
			tc.CloseWrite()
		}
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
