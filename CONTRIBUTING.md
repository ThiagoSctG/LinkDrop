# Contributing to LinkDrop

Thanks for your interest! Issues, fixes and improvements are welcome. Issues and pull requests can be written in English or Portuguese.

## Before you start

- Search for an existing issue first.
- For larger changes, open an issue describing the motivation and the proposal before writing code.
- Never post credentials, tokens, personal data or vulnerability details in issues. See [SECURITY.md](SECURITY.md).

## Layout

| Path | What lives there |
| --- | --- |
| `cmd/linkdrop` | Process entrypoint: configuration, signals, graceful shutdown, `healthcheck` subcommand |
| `internal/linkdrop` | The whole server as one `http.Handler`: API, realtime channel, in-memory store, rate limiting, static files |
| `web/src` | Preact frontend (screen, phone and shared session views) |
| `web/embed.go` | Embeds the built frontend (`web/dist`) into the binary |

## Architecture

The Go server owns sessions and broadcasts full snapshots over WebSocket. The Preact frontend renders those snapshots and sends explicit actions over HTTP. Building the frontend embeds its static files in the binary; production needs no separate frontend server.

State stays in memory because sharing is temporary: there is no database, migration or recovery after a restart. Run a single instance; replicas would hold different sessions. Each device authenticates using its own random endpoint key, and only the screen can clear the whole list. Item titles and contents are encrypted in the browser with AES-256-GCM; the backend handles opaque envelopes. The shared encryption key travels in the QR URL fragment and is distinct from server-issued endpoint credentials. See [the encryption design](docs/encryption.md).

The tests exercise the public HTTP handler and rendered UI instead of internal implementation details.

## Domain

The terms code, tests, issues and docs use for LinkDrop's concepts. UI text is translated; these names are not.

- **Screen** (`screen`): the device that shows the QR code, usually a shared display. It is the only Endpoint that can clear the whole list.
- **Phone** (`phone`): the device that scans the QR code and joins the Screen's Session.
- **Endpoint**: one of the two devices in a Session, identified by its Endpoint key and holding a Role (`screen` or `phone`).
- **Endpoint key**: an opaque, unguessable credential issued per Endpoint. HTTP requests send it in `x-endpoint-key`; the realtime channel sends it as the second WebSocket subprotocol after `linkdrop.v3`.
- **Encryption key**: a 256-bit session secret created by the Screen's browser. The QR shares it with the Phone through a URL fragment, never an API field. It encrypts item titles and contents and stays with device credentials in browser storage.
- **Pairing token**: a single-use, short-lived (2 min) token encoded in the QR code. Scanning it creates the Session, or replaces the Phone when issued by the Screen from inside an active Session (see Rejoin). A token that was never scanned expires; a used one lives as long as its Session, or for a Rejoin token until the next one replaces it.
- **Session**: the ephemeral link between one Screen and one Phone (which can be replaced by the Screen). It holds the Items and ends when an Endpoint ends it, after 30 minutes without Activity, or when the server restarts. Ending deletes the Items, keys and Pairing tokens.
- **Rejoin**: the Screen issuing a new Pairing token (`rejoinToken`) from inside an active Session so a new Phone can take the current one's place. The Items stay; the old Phone's connection ends with reason `replaced`. A Session holds at most one Rejoin token, and issuing another drops the previous one. It is never renewed automatically.
- **Item**: an entry in the shared list. The server holds an ID, a versioned ciphertext envelope and a creation time. After decrypting locally, a device classifies it as a **Link** (`link`, only absolute `http(s)` URLs) or a **Note** (`text`, everything else), with an optional title. The list is ordered newest first.
- **Spotlight**: a full-viewport overlay that shows one Item on the device that opened it: a Link as a large QR code, a Note as enlarged text. Opening it is Activity.
- **Activity**: an explicit action (add, remove, clear, copy, open, renew, spotlight, rejoin, end) that renews a Session's expiry. Reading, reloading and reconnecting are not Activity.
- **Snapshot**: the full state of a Session as one Endpoint sees it, pushed over the realtime channel on connect and after every change or Activity. It carries `expiresInMs`, the time left before the Session ends for inactivity, as a duration so a skewed device clock still counts down correctly.

## Local setup

Requirements: Go 1.27.3+ and Node.js 22+.

```bash
npm ci
npm run build
go run ./cmd/linkdrop
```

`npm run build:all` builds the frontend and the binary in one step. With the Go server running, `npm run dev` serves the frontend with hot reload on port 5173 and proxies `/api` to port 47821.

Use `localhost` for development, or the computer's reachable LAN IP to pair a phone. HTTP works with encrypted items and a transport notice, but should only be used on trusted networks. Use HTTPS for public deployments. Native Web Crypto handles AES-GCM where available; `@noble/ciphers` handles the same wire format when `crypto.subtle` is unavailable. Both require secure randomness through `crypto.getRandomValues`; there is no weak-randomness or plaintext fallback.

## Tests

- **Server:** tests drive the real `http.Handler` through `httptest`, over HTTP and WebSocket, with an injected clock. Test behavior through the API, not internal types.
- **Frontend:** tests render `<App />` with fake `fetch` and `WebSocket` (`web/src/test/fakes.ts`) and assert what the user sees and what goes over the wire.

Before opening a pull request, run:

```bash
gofmt -l . && go vet ./... && go test ./...
npm run format:check && npm run typecheck && npm test && npm run build
```

## Pull requests

- Keep the change focused and explain the problem it solves.
- Add tests for new or fixed behavior.
- Update the documentation when configuration, operation or visible behavior changes.
- Commit messages follow `type: description`, e.g. `feat:`, `fix:`, `docs:`, `test:`.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Releases

1. Update `package.json`, both version fields in `package-lock.json`, the default image version in `compose.yaml` and `.env.example`, and versioned commands in both READMEs.
2. Add a `CHANGELOG.md` section named `## [X.Y.Z]` describing user-visible changes.
3. Commit and push the changes, then create and push `vX.Y.Z`.

The tag workflow runs the same CI checks, including dependency vulnerability scans, before publishing. It validates version consistency, packages binaries with their license and README, generates SHA-256 checksums, and publishes the multi-architecture container and GitHub release. The release appears only after both artifact jobs succeed. A prerelease tag such as `v0.2.0-rc.1` never updates the container's `latest` tag.

After publishing, verify the container can be pulled without authentication and test an archive downloaded from the release. Release notes come from the changelog.
