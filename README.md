# Microsandbox Cloud

Minimal NestJS control plane and signed proxy for running named Microsandbox VMs from arbitrary OCI images, with optional SSH access.

## What it does

- Creates detached Microsandbox VMs from an OCI image.
- Publishes a runtime's primary exposed container port onto a private host port.
- Injects a static Go SSH daemon into sandboxes for true SSH access.
- Persists runtime, host, and port state in SQLite.
- Issues short-lived signed proxy URLs for HTTP and WebSocket access.
- Proxies `/proxy/:sandboxId/*` to the correct local sandbox port.
- Supports caller-supplied sandbox IDs, normalized naming, lifecycle actions, file sync, exec, and Microsandbox secrets.

This first version is still single-host. The schema keeps `runtimeHostId` so the service can grow into a multi-host scheduler later.

## Project structure

```
microsandbox-cloud/
├── apps/
│   ├── cloud-api/           ← NestJS control plane (TypeScript)
│   ├── inject-sshd/         ← Static Go SSH daemon injected into sandboxes
│   └── ssh-gateway/         ← Token-authenticated SSH gateway proxy (Go)
├── data/
│   └── ssh/                 ← Pre-built Go binaries
├── deploy/                  ← Production deployment files (systemd)
├── scripts/                 ← Build & packaging scripts
├── package.json             ← Root workspace
└── tsconfig.base.json       ← Shared TypeScript config
```

## SSH Architecture

```
User: ssh -p 2222 <session_token>@gateway-host
          │
          ▼ TCP connect :2222
    ssh-gateway  ──GET /ssh/validate?token=...──► NestJS API
          │                                         │
          │  ← { sandboxId, hostPort: 31001 }       │
          ▼                                         │
    TCP connect to 127.0.0.1:31001                  │
          │                                         │
          ▼                                         │
    inject-sshd (inside sandbox VM, :22)  ◄── Docker port map 31001→:22
          │
          │ SSH handshake (host key, public key auth)
          ▼
    User gets a shell
```

### inject-sshd

A static Go SSH daemon injected into every sandbox with SSH enabled. It:
- Listens on container port 22
- Authenticates via public keys only
- Auto-generates a host key if none provided
- Provides PTY shell, command exec, and SFTP
- Works on any OCI image (no OpenSSH required)

### ssh-gateway

A standalone Go daemon that proxies SSH connections to sandboxes:
1. Extracts session token from SSH username
2. Validates it with the API (`GET /ssh/validate`)
3. Raw-TCP proxies to the sandbox's published port

The client never talks directly to inject-sshd — the full SSH handshake happens through the proxy.

## Configuration

Copy `apps/cloud-api/.env.example` to `apps/cloud-api/.env` and configure:

```bash
MICROSANDBOX_CLOUD_PORT=3210
MICROSANDBOX_CLOUD_SQLITE_PATH=./data/microsandbox-cloud.sqlite
MICROSANDBOX_CLOUD_INTERNAL_API_TOKEN=change-me
MICROSANDBOX_CLOUD_PROXY_TOKEN_SECRET=change-me-too
MICROSANDBOX_CLOUD_PROXY_BASE_URL=http://localhost:3210
MICROSANDBOX_CLOUD_DEFAULT_IMAGE=nginx:stable-alpine
MICROSANDBOX_CLOUD_DEFAULT_EXPOSED_PORT=8080
MICROSANDBOX_CLOUD_DEFAULT_VOLUME_MOUNT_PATH=/workspace
MICROSANDBOX_CLOUD_PORT_RANGE_START=31000
MICROSANDBOX_CLOUD_PORT_RANGE_END=31999
MICROSANDBOX_CLOUD_HEALTHCHECK_TIMEOUT_MS=3000
MICROSANDBOX_CLOUD_RUNTIME_READY_TIMEOUT_MS=15000
```

Full reference with defaults in [`apps/cloud-api/.env.example`](apps/cloud-api/.env.example).

## API

Private runtime control:

```http
POST   /internal/runtimes/ensure
GET    /internal/runtimes/:sandboxId
POST   /internal/runtimes/:sandboxId/start
POST   /internal/runtimes/:sandboxId/stop
POST   /internal/runtimes/:sandboxId/power
DELETE /internal/runtimes/:sandboxId
POST   /internal/runtimes/:sandboxId/exec
POST   /internal/runtimes/:sandboxId/files
POST   /internal/runtimes/:sandboxId/refresh-activity
GET    /internal/runtimes/:sandboxId/ssh-connection
```

SSH session management:

```http
POST   /internal/ssh-session              ← create session token
DELETE /internal/ssh-session/:token        ← revoke a session
GET    /internal/ssh/validate?token=...    ← validate for gateway
```

Public connection:

```http
POST /public/runtimes/:sandboxId/connection
```

Proxy:

```http
GET /proxy/:sandboxId/*
GET /proxy/:sandboxId/ws
```

Set `Authorization: Bearer <MICROSANDBOX_CLOUD_INTERNAL_API_TOKEN>` for private/control endpoints when a token is configured.

## SSH usage

### 1. Create a sandbox with SSH enabled

```json
POST /internal/runtimes/ensure
{
  "sandboxId": "my-sandbox",
  "image": "ubuntu:22.04",
  "command": ["sleep", "3600"],
  "ssh": {
    "enabled": true,
    "publicKeys": ["ssh-ed25519 AAAAC3... your-public-key"],
    "user": "root"
  }
}
```

Returns the sandbox spec including an allocated `ssh` port:

```json
{
  "ssh": {
    "hostPort": 31001,
    "containerPort": 22
  }
}
```

### 2. Get connection info

```http
GET /internal/runtimes/my-sandbox/ssh-connection
```

### 3. Create a session token

```http
POST /internal/ssh-session
{
  "sandboxId": "my-sandbox"
}
```

Returns:

```json
{
  "token": "abc123...",
  "expiresAt": "2026-05-22T08:00:00.000Z"
}
```

### 4. Connect via SSH

```bash
ssh -p 2222 <session_token>@<gateway-host>
```

## Development

```bash
# Install dependencies
npm install

# Build Go SSH binaries (inject-sshd + ssh-gateway)
npm run build:ssh

# Build TypeScript
npm run build

# Run tests
npm run test

# Lint
npm run lint

# Start API in dev mode (watch)
npm run start:dev

# Start SSH gateway (separate terminal)
./data/ssh/ssh-gateway
```

The gateway reads configuration from environment variables:
- `API_URL` — NestJS API base URL (default: `http://localhost:3210`)
- `API_KEY` — must match `MICROSANDBOX_CLOUD_INTERNAL_API_TOKEN`
- `SSH_GATEWAY_PORT` — listen port (default: `2222`)
- `SSH_HOST_KEY` — path to host private key (auto-generated if missing)

## Production deployment

```bash
# Build everything
npm run build:all

# Copy to deployment directory
mkdir -p /opt/microsandbox-cloud
cp -r apps/cloud-api/dist data/ssh apps/cloud-api/package.json apps/cloud-api/.env /opt/microsandbox-cloud/
cd /opt/microsandbox-cloud && npm install --production

# Start API
node apps/cloud-api/dist/main.js

# Start SSH gateway (see deploy/ for systemd unit)
./data/ssh/ssh-gateway
```

See `deploy/ssh-gateway.service` and `deploy/ssh-gateway.env` for a production systemd setup.

## Release

```bash
npm run build:all
npm run package:release -- v0.1.0
```

Produces:

- `artifacts/microsandbox-cloud-v0.1.0.tar.gz`
- `artifacts/microsandbox-cloud-v0.1.0.tar.gz.sha256`

The release tarball includes the compiled Go SSH binaries for `linux/amd64` and `linux/arm64`, so no Go toolchain is needed at deploy time.

### GitHub Actions

- `.github/workflows/ci.yml` — lint, test, build on PRs and pushes to `main`
- `.github/workflows/release.yml` — on `v*` tags, publishes GitHub release assets including the SSH Go binaries
