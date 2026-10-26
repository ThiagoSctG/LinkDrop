# LinkDrop

[![CI](https://github.com/ThiagoSctG/LinkDrop/actions/workflows/ci.yml/badge.svg)](https://github.com/ThiagoSctG/LinkDrop/actions/workflows/ci.yml)

**English** · [Português](README.pt-BR.md)

Send links and notes between a screen and a phone without logins, messaging apps or lasting history.

The screen shows a temporary QR code. Scanning it joins the phone to the same session, and both devices share a live list. The session ends after 30 minutes without activity, and everything is deleted when it ends.

## Features

- Pairing by QR code or a copyable link
- Links and notes with optional titles, updated live on both devices
- Only `http(s)` links are clickable; anything else is plain text
- No accounts, no database: all state lives in memory and disappears with the session
- A single ~10 MB binary, or a ~16 MB container image (amd64 and arm64)
- Light and dark themes, English and Brazilian Portuguese
- Rate limiting, strict Content Security Policy, and no content in logs

## Run it

### Docker

```bash
docker run -d -p 3000:3000 --name linkdrop ghcr.io/thiagosctg/linkdrop-web:latest
```

Open `http://localhost:3000` on the screen and scan the QR code with your phone. Both devices must reach the same address, so use the machine's LAN IP or a public hostname rather than `localhost`.

### Docker Compose

```bash
cp .env.example .env
docker compose up -d
```

### Binary

Download a binary for your platform from the [releases](https://github.com/ThiagoSctG/LinkDrop/releases) page and run it:

```bash
PORT=3000 ./linkdrop
```

## Configuration

All settings are environment variables. Invalid values stop the server at startup with a clear message.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Listen port |
| `TRUST_PROXY` | `false` | Behind a reverse proxy, read the client IP from the last `X-Forwarded-For` hop and the scheme from `X-Forwarded-Proto`. Leave it off when exposed directly. |
| `PUBLIC_URL` | _(empty)_ | External origin for pairing links, e.g. `https://drop.example.com`. Empty uses the request's host. |
| `SESSION_TTL` | `30m` | Inactivity before a session ends |
| `PAIRING_TTL` | `2m` | Lifetime of an unscanned QR code |
| `MAX_ITEMS_PER_SESSION` | `100` | Items a session can hold |
| `RATE_LIMIT_REQUESTS` | `60` | API requests per client IP per window |
| `RATE_LIMIT_WINDOW` | `1m` | Rate limit window |
| `RATE_LIMIT_MAX_KEYS` | `10000` | Client IPs tracked at once |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` (JSON logs on stderr) |

The health endpoint is `GET /api/health`. Container images run `linkdrop healthcheck` for Docker's `HEALTHCHECK`.

**Restarts end sessions.** State is kept in memory on purpose. On shutdown, connected devices are told their session ended and return to the start screen.

Use HTTPS in production. Browsers only allow copying to the clipboard on secure origins.

## Development

Requirements: Go 1.26+ and Node.js 22+.

```bash
npm ci
npm run build          # builds the frontend into web/dist, which the Go binary embeds
go run ./cmd/linkdrop  # http://localhost:3000
```

`npm run build:all` builds the frontend and then the `linkdrop` binary in one step.

For frontend work with hot reload, keep the Go server running and start Vite in another terminal. It proxies `/api` to port 3000:

```bash
npm run dev            # http://localhost:5173
```

Checks:

```bash
go vet ./... && go test ./...
npm run typecheck && npm test && npm run format:check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout and conventions.

## Privacy

LinkDrop does not need an account and never writes link or note contents, tokens or keys to its logs. Session data exists only in the server's memory and is deleted when the session ends or expires.

## License

[MIT](LICENSE)
