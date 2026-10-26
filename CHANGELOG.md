# Changelog

## [Unreleased]

- Encrypt item titles and contents end to end with AES-256-GCM in the browser; share the session key through the QR URL fragment, never through the backend.
- Reject legacy plaintext items and invalid encrypted envelopes; authenticate item and session identity when decrypting.
- Preserve HTTP pairing by LAN IP with AES-GCM through `@noble/ciphers` when native encryption is unavailable; show the transport limitation and recommend HTTPS for public deployments. Block browsers without secure randomness, without falling back to plaintext.
- Retain encryption keys locally for reload/rejoin, reject old saved credentials, and move realtime clients to `linkdrop.v3`. Both devices must reload and pair again after updating.
- Document metadata exposure, browser-delivery trust, key retention and the lack of forward secrecy or replay protection.

## [0.1.0] - 2026-10-26

First public release of LinkDrop.

- Pair a screen and a phone with a temporary QR code or link, without an account.
- Share links and notes in both directions with live updates.
- Copy items, undo removal, and display links as QR codes or notes in full screen.
- Renew sessions and replace the paired phone while keeping the shared list.
- Light and dark themes, with English and Brazilian Portuguese interfaces.
- In-memory sessions that expire after 30 minutes of inactivity and end on restart.
- Default port `47821`, configurable through `PORT`.
- Containers for Linux amd64/arm64 and binaries for Linux, macOS and Windows, with SHA-256 checksums.
