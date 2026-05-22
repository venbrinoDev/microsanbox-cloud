package main

import (
	"crypto/rand"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/creack/pty"
	"github.com/gliderlabs/ssh"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ed25519"
)

func main() {
	port := envOrDefault("SSHD_PORT", "22")
	hostKeyPath := envOrDefault("SSHD_HOST_KEY", "/etc/ssh/host_key")

	ensureHostKey(hostKeyPath)

	server := &ssh.Server{
		Addr: ":" + port,
		Handler: sessionHandler,
		PublicKeyHandler: authHandler,
		PasswordHandler: func(ctx ssh.Context, password string) bool {
			return false
		},
		SubsystemHandlers: map[string]ssh.SubsystemHandler{
			"sftp": sftpHandler,
		},
	}

	log.Printf("inject-sshd listening on :%s", port)
	log.Fatal(server.ListenAndServe())
}

func authHandler(ctx ssh.Context, key ssh.PublicKey) bool {
	authKeysPath := envOrDefault("SSHD_AUTHORIZED_KEYS", "/root/.ssh/authorized_keys")
	authorized, err := os.ReadFile(authKeysPath)
	if err != nil {
		return false
	}
	return keyAuthorized(key.Marshal(), authorized)
}

func sessionHandler(s ssh.Session) {
	shell := envOrDefault("SHELL", "/bin/sh")

	if s.RawCommand() != "" {
		cmd := exec.Command(shell, "-c", s.RawCommand())
		cmd.Stdout = s
		cmd.Stderr = s.Stderr()
		cmd.Stdin = s
		if err := cmd.Run(); err != nil {
			log.Printf("command failed: %v", err)
		}
		return
	}

	cmd := exec.Command(shell)

	term := "xterm-256color"
	for _, env := range s.Environ() {
		if strings.HasPrefix(env, "TERM=") {
			term = strings.TrimPrefix(env, "TERM=")
			break
		}
	}

	cmd.Env = append(os.Environ(),
		"TERM="+term,
		"SHELL="+shell,
	)
	cmd.Dir = homeDir()

	ptyReq, winCh, isPty := s.Pty()
	if isPty {
		f, err := pty.StartWithSize(cmd, &pty.Winsize{
			Cols: uint16(ptyReq.Window.Width),
			Rows: uint16(ptyReq.Window.Height),
		})
		if err != nil {
			log.Printf("pty failed: %v", err)
			s.Exit(1)
			return
		}
		defer f.Close()

		go func() {
			for win := range winCh {
				_ = pty.Setsize(f, &pty.Winsize{
					Cols: uint16(win.Width),
					Rows: uint16(win.Height),
				})
			}
		}()

		go io.Copy(f, s)
		io.Copy(s, f)
	} else {
		cmd.Stdout = s
		cmd.Stderr = s.Stderr()
		cmd.Stdin = s
		if err := cmd.Run(); err != nil {
			log.Printf("shell failed: %v", err)
		}
	}

	if err := cmd.Wait(); err != nil {
		log.Printf("shell exited: %v", err)
	}
}

func sftpHandler(s ssh.Session) {
	server, err := sftp.NewServer(s)
	if err != nil {
		log.Printf("sftp init failed: %v", err)
		return
	}
	defer server.Close()
	if err := server.Serve(); err != nil && err != io.EOF {
		log.Printf("sftp serve failed: %v", err)
	}
}

func keyAuthorized(keyBytes []byte, authorized []byte) bool {
	lines := strings.Split(string(authorized), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			continue
		}
		if subtle.ConstantTimeCompare(keyBytes, decoded) == 1 {
			return true
		}
	}
	return false
}

func ensureHostKey(path string) {
	if _, err := os.Stat(path); err == nil {
		return
	}
	log.Printf("generating host key at %s", path)

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

func homeDir() string {
	home, err := os.UserHomeDir()
	if err == nil {
		return home
	}
	return "/root"
}
