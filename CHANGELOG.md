# Changelog

## [Unreleased]

## [0.1.0] - 2026-10-26

First public release of LinkDrop.

- Pair a screen and a phone with a temporary QR code or link, without an account.
- Share links and notes in both directions with live updates.
- Encrypt item titles and contents end to end with AES-256-GCM in the browser; the session key travels in the QR link's fragment and never reaches the backend.
- Pair by LAN IP over plain HTTP on trusted networks, with a visible transport notice; HTTPS is recommended for public instances.
- Copy items, undo removal, and display links as QR codes or notes in full screen.
- Renew sessions and replace the paired phone while keeping the shared list.
- Light and dark themes, with English and Brazilian Portuguese interfaces.
- In-memory sessions that expire after 30 minutes of inactivity and end on restart.
- Default port `47821`, configurable through `PORT`.
- Containers for Linux amd64/arm64 and binaries for Linux, macOS and Windows, with SHA-256 checksums.
