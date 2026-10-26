# Changelog

## [Unreleased]

## [0.1.1] - 2026-10-26

- Keep an item's time on one line on narrow phones; the kind label stays available to screen readers.
- Show the HTTP notice only outside a secure context, so `localhost` no longer shows it.
- Drop decorative labels and effects from the pairing screen: the "ready" and "temporary code" badges, the scanner corners and scan line, and the uppercase kind label on items.
- Show item content first with its time underneath, and notes as plain text instead of a box inside the row.
- Make the ended-session notice neutral: a check when you ended it yourself, an information mark otherwise.
- Shorten interface text: "Copy link", no exclamation marks, no repeated renewal note, and a footer that states what is actually protected.

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
- Resource limits for public instances: concurrent sessions (`MAX_SESSIONS`), 2 MiB of ciphertext per session, four realtime connections per device, and per-/64 rate limiting for IPv6.
- Default port `47821`, configurable through `PORT`.
- Containers for Linux amd64/arm64 and binaries for Linux, macOS and Windows, with SHA-256 checksums.
