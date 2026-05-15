# Microsandbox Cloud

Minimal NestJS control plane and signed proxy for running named Microsandbox runtimes from arbitrary OCI images.

## What it does

- Creates detached Microsandbox VMs from an OCI image.
- Publishes a runtime's primary exposed container port onto a private host port.
- Persists runtime, host, and port state in SQLite.
- Issues short-lived signed proxy URLs for HTTP and WebSocket access.
- Proxies `/proxy/:sandboxId/*` to the correct local sandbox port.
- Supports caller-supplied sandbox IDs, normalized naming, lifecycle actions, file sync, exec, and Microsandbox secrets.

This first version is still single-host. The schema keeps `runtimeHostId` so the service can grow into a multi-host scheduler later.

## Configuration

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
```

## Runtime identity

A runtime is identified by one caller-supplied `sandboxId`.

It is normalized before persistence and before infrastructure names are derived:

- lowercase
- only `a-z`, `0-9`, `.`, `_`, `-`
- other characters collapse to `-`

## Generic runtime contract

`ensure` accepts a runtime spec:

- `sandboxId`
- `image`
- `command`
- `env`
- `files`
- `secrets`
- `workingDir`
- `port`
- `resources`
- optional persistent volume settings

Example:

```json
{
  "sandboxId": "preview-pr-42",
  "image": "nginx:stable-alpine",
  "command": ["nginx", "-g", "daemon off;"],
  "port": {
    "containerPort": 80,
    "protocol": "tcp"
  },
  "resources": {
    "cpu": 1,
    "memoryMiB": 512,
    "diskGiB": 2
  },
  "persistentVolume": false
}
```

## Secrets

`secrets` maps directly to Microsandbox's secret builder model from the official docs:

- `env`
- `value`
- optional `placeholder`
- `allowedHosts`
- `allowedHostPatterns`
- `allowAnyHostDangerous`
- `requireTlsIdentity`
- `injectHeaders`
- `injectBasicAuth`
- `injectQuery`
- `injectBody`

Example:

```json
{
  "sandboxId": "fetcher",
  "image": "ghcr.io/example/fetcher:latest",
  "command": ["node", "index.js"],
  "secrets": [
    {
      "env": "OPENAI_API_KEY",
      "value": "sk-...",
      "allowedHosts": ["api.openai.com"],
      "requireTlsIdentity": true,
      "injectHeaders": true
    }
  ]
}
```

Reference: [Microsandbox secrets docs](https://docs.microsandbox.dev/sandboxes/secrets)

## API

Private runtime control:

```http
POST /internal/runtimes/ensure
GET /internal/runtimes/:sandboxId
POST /internal/runtimes/:sandboxId/start
POST /internal/runtimes/:sandboxId/stop
POST /internal/runtimes/:sandboxId/power
DELETE /internal/runtimes/:sandboxId
POST /internal/runtimes/:sandboxId/exec
POST /internal/runtimes/:sandboxId/files
POST /internal/runtimes/:sandboxId/refresh-activity
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

## Connection payload

The public connection response includes:

- `sandboxId`
- `runtimeId`
- `proxyBaseUrl`
- `httpUrl`
- `wsUrl`
- `token`
- `expiresAt`
- `primaryPort`
- `protocol`

## Development

```bash
npm install
npx tsc -p tsconfig.json --noEmit
npm run lint
npm test -- --runInBand
npm run build
npm run start:dev
```

## Release

`microsandbox-cloud` is released independently from Jovita.

- `main` pushes run CI and package a release tarball as a workflow artifact.
- `v*` tags run the same build and publish GitHub release assets.

Create a release bundle locally with:

```bash
npm run build
npm run package:release -- v0.1.0
```

That produces:

- `artifacts/microsandbox-cloud-v0.1.0.tar.gz`
- `artifacts/microsandbox-cloud-v0.1.0.tar.gz.sha256`

The release tarball contains:

- `dist/`
- runtime `package.json` and `package-lock.json`
- `README.md`
- `LICENSE`

### GitHub Actions

The repository ships with two workflows:

- `.github/workflows/ci.yml`
  - runs lint, tests, and build on pull requests and pushes to `main`
- `.github/workflows/release-deploy.yml`
  - runs on pushes to `main`
  - runs on tags matching `v*`
  - uploads release tarballs as workflow artifacts
  - publishes GitHub release assets for tags

Host-specific deployment is intentionally left to the consumer. Jovita or any other user can fetch the tagged tarball and install it however they want.
