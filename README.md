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
- **End-to-end encrypted items**: titles and contents are encrypted on your devices before reaching the server.
- **Shared-screen friendly**: show a link as a large QR code or a note in full screen.
- **Ephemeral**: everything lives in memory and is deleted when the session ends or after 30 minutes of inactivity.
- **Self-hosted and small**: a single ~7 MB binary or a multi-arch container image, light and dark themes, English and Portuguese.

## Quick start

```bash
docker run -d --name linkdrop -p 47821:47821 ghcr.io/thiagosctg/linkdrop:v0.1.0
```

On a trusted local network, open `http://<computer-LAN-IP>:47821` on the computer and scan its QR code with the phone. Both devices must reach that address; `localhost` on the phone points to the phone itself. Items remain encrypted on HTTP, but someone on the network could alter the application and capture keys or contents. The interface shows this limitation. Use HTTPS for public instances and networks you do not trust.

**Other options:**

- **Docker Compose**: clone the repo, copy `.env.example` to `.env` and run `docker compose up -d`.
- **Binaries** for Linux, macOS and Windows on the [Releases](https://github.com/ThiagoSctG/LinkDrop/releases/latest) page, with SHA-256 checksums. They are not code-signed.

## Configuration

Set environment variables; invalid values stop startup with an error.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `47821` | Listen port (host port with the supplied Compose file) |
| `PUBLIC_URL` | _empty_ | Base URL in API pairing responses; browser QR links use the current page's origin |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` and `X-Forwarded-Proto`; only behind a proxy |
| `SESSION_TTL` | `30m` | Inactivity before a session ends |
| `PAIRING_TTL` | `2m` | Lifetime of an unscanned QR code |
| `MAX_ITEMS_PER_SESSION` | `100` | Maximum items per session (each session also holds at most 2 MiB of ciphertext) |
| `MAX_SESSIONS` | `1000` | Concurrent sessions; unscanned QR codes are capped at twice this |
| `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW` | `60` / `1m` | API requests per client IP (IPv6 per /64) per window |
| `RATE_LIMIT_MAX_KEYS` | `10000` | Client IPs tracked at once; when full, the oldest is forgotten |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` (JSON on stderr) |

For public instances, use an HTTPS proxy that forwards WebSockets. If you enable `TRUST_PROXY`, restrict backend access to that proxy: forwarded headers are trusted, so the backend must not remain directly accessible to clients. Open the same reachable address on the screen as well; browser QR links deliberately use that origin rather than attaching encryption keys to a server-supplied URL. `PUBLIC_URL` still controls the unkeyed URL in API responses.

## Security and privacy

- Titles and contents are encrypted with AES-256-GCM in the browser. The session key is shared through the QR link's fragment (`#key=…`), which is not sent in HTTP requests. The server stores and relays ciphertext, without receiving the encryption key.
- HTTP by LAN IP works with item encryption and a visible transport notice. It does not authenticate the application delivered to your browser or protect endpoint credentials in transit. Prefer HTTPS; do not expose an HTTP instance publicly. The server still sees metadata such as IP addresses, item counts, encrypted sizes and activity times.
- The host delivers the web application: a malicious or compromised host could serve modified JavaScript that captures keys or plaintext. E2EE protects content handled by the unmodified application; it does not remove the need to trust the application delivered to your browser. This implementation has not had an independent cryptographic audit.
- The application keeps ciphertext in server memory and does not intentionally write item data to disk or logs. Infrastructure logs, swap, crash dumps, clipboard contents and device copies have their own retention. Restarting the server ends all sessions.
- Pairing links and saved device credentials (including the encryption key in browser storage) are secrets. Closing a tab does not end a session; use **End session** on shared computers. Replacing the phone revokes its server access but keeps the session encryption key to preserve the list. There is no forward secrecy or protection against replay/omission of previously valid items; end the session and start a new one to obtain a fresh key.
- Run a single instance; sessions are not shared between replicas.

See [the encryption design](docs/encryption.md) for the protocol, threat model and limitations.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Development

Requires Go 1.27.3+ and Node.js 22+.

```bash
npm ci && npm run build
go run ./cmd/linkdrop      # http://localhost:47821
npm run dev                # optional: hot reload on http://localhost:5173
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture, tests and release process. Issues and pull requests are welcome in English or Portuguese.

## License

[MIT](LICENSE) · [Changelog](CHANGELOG.md)
