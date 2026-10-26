<div align="center">

<img src="docs/images/logo.svg" width="72" height="72" alt="">

# LinkDrop

**Move links and notes between a computer and a phone. Scan a QR code, share a live list. No sign-in, nothing kept.**

[![CI](https://github.com/ThiagoSctG/LinkDrop/actions/workflows/ci.yml/badge.svg)](https://github.com/ThiagoSctG/LinkDrop/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ThiagoSctG/LinkDrop?sort=semver)](https://github.com/ThiagoSctG/LinkDrop/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**English** · [Português](README.pt-BR.md)

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.png">
  <img src="docs/images/hero-light.png" alt="LinkDrop on a computer and a phone showing the same shared list of links and notes">
</picture>

## Why LinkDrop?

Getting a URL from your phone to a meeting-room screen, or a note from a laptop to your phone, usually means emailing yourself or signing in to a messaging app on a computer that isn't yours. LinkDrop skips that: open it on the computer, scan the QR code, and both devices share one list until you end the session.

## Features

- **QR pairing** with a short-lived code. No accounts, no app to install.
- **Live, two-way list** of links and notes, with optional titles.
- **Shared-screen friendly**: show a link as a large QR code or a note in full screen.
- **Ephemeral**: everything lives in memory and is deleted when the session ends or after 30 minutes of inactivity.
- **Self-hosted and small**: a single ~7 MB binary or a multi-arch container image, light and dark themes, English and Portuguese.

## Quick start

```bash
docker run -d --name linkdrop -p 47821:47821 ghcr.io/thiagosctg/linkdrop:v0.1.0
```

Open `http://<computer-LAN-IP>:47821` on the computer and scan the QR code with your phone. Both devices must reach that address, so `localhost` will not work for the phone.

**Other options:**

- **Docker Compose**: clone the repo, copy `.env.example` to `.env` and run `docker compose up -d`.
- **Binaries** for Linux, macOS and Windows on the [Releases](https://github.com/ThiagoSctG/LinkDrop/releases/latest) page, with SHA-256 checksums. They are not code-signed.

## Configuration

Set environment variables; invalid values stop startup with an error.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `47821` | Listen port (host port with the supplied Compose file) |
| `PUBLIC_URL` | _empty_ | External origin for pairing links, e.g. `https://drop.example.com` |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` and `X-Forwarded-Proto`; only behind a proxy |
| `SESSION_TTL` | `30m` | Inactivity before a session ends |
| `PAIRING_TTL` | `2m` | Lifetime of an unscanned QR code |
| `MAX_ITEMS_PER_SESSION` | `100` | Maximum items per session |
| `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW` | `60` / `1m` | API requests per client IP per window |
| `RATE_LIMIT_MAX_KEYS` | `10000` | Client IPs tracked at once |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` (JSON on stderr) |

For internet access, put LinkDrop behind an HTTPS proxy that forwards WebSockets, set `PUBLIC_URL` and enable `TRUST_PROXY`. With [Caddy](https://caddyserver.com/), `reverse_proxy localhost:47821` is all it takes.

## Security and privacy

- Not end-to-end encrypted: the server can read shared contents. Host your own instance or use one you trust.
- Contents stay in memory and are never written to disk or logs. Restarting the server ends all sessions.
- Pairing links and saved device keys grant access to a session. Treat them as credentials.
- Run a single instance; sessions are not shared between replicas.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Development

Requires Go 1.26.10+ and Node.js 22+.

```bash
npm ci && npm run build
go run ./cmd/linkdrop      # http://localhost:47821
npm run dev                # optional: hot reload on http://localhost:5173
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture, tests and release process. Issues and pull requests are welcome in English or Portuguese.

## License

[MIT](LICENSE) · [Changelog](CHANGELOG.md)
