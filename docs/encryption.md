# Item encryption

This describes the unreleased encrypted protocol. Released v0.1.0 clients use plaintext and are incompatible. Both devices must reload and pair again after the update. This implementation has not received an independent cryptographic audit.

## What is protected

The unmodified client encrypts item titles and contents before sending them to the backend. Both devices use a randomly generated 256-bit AES key. The Go backend has no encryption key, plaintext fields or decryption operation; it stores opaque encrypted items in memory and broadcasts them over WebSocket.

Pairing by LAN IP over HTTP is supported, with an always-visible transport notice. Native Web Crypto handles AES-GCM where `crypto.subtle` is available; otherwise the bundled `@noble/ciphers` implementation handles the same encrypted format. Keys, UUIDs and nonces use `crypto.getRandomValues`, which browsers make available on HTTP as well. Browsers without secure randomness are blocked, without a weak-randomness or plaintext fallback.

HTTP does not protect the application delivered to the browser or endpoint credentials in transit. A network attacker can alter the JavaScript to capture plaintext/keys, or steal endpoint credentials to disrupt the session. Use HTTP only on a trusted local network. HTTPS remains necessary for public instances and untrusted networks, and also enables browser features such as clipboard access. An IP address can be used with HTTPS if its certificate is trusted and valid for that IP.

The server sees IPs, endpoint roles, identifiers, ciphertext lengths, item counts, server-generated timestamps and activity. Lengths are not padded. Encryption does not conceal this metadata or prevent the server from denying service.

## Key lifecycle

1. The Screen creates a fresh 32-byte key with `crypto.getRandomValues` for each new pairing code. It requests a pairing token and a separate endpoint credential from the backend.
2. The browser builds a same-origin URL `/pair/{token}#key={base64url-key}`. It ignores the origin in the server's pairing URL rather than attaching a secret to a server-selected origin. `PUBLIC_URL` still affects API responses, but the Screen must be opened at the reachable origin the Phone will use.
3. The QR and the copy-link action include the fragment. Browsers do not transmit that fragment in HTTP requests. The Phone reads the key and removes both the token path and fragment from the address bar before claiming the token through the API. A missing, malformed or noncanonical key prevents the claim.
4. Each device saves its session ID, endpoint credential, role and encryption key in localStorage so reloading can resume. Saved connections without a valid encryption key are discarded. Closing a tab does not end a session. If browser storage is unavailable, reload cannot resume it.
5. When the Screen replaces a Phone, its new QR includes the existing session encryption key so the new Phone can read the retained list. The backend revokes the previous Phone's endpoint credential and sockets. It cannot erase plaintext or keys already copied by that Phone. There is no key rotation or forward secrecy within a session. To obtain a fresh encryption key, end the session and start another.
6. On detected termination, expiry or replacement, the device removes its saved connection. An offline device may retain a stale key until it next contacts the server. Server expiry still removes access and ciphertext. Clearing browser storage removes the saved credentials but is not cryptographic erasure of device backups or disk remnants.

Anyone with the full pairing link or QR has the session secret. Do not share it outside the intended devices. A server-issued pairing token alone does not contain that encryption key, although racing to claim a token can still deny the intended pairing.

## Encrypted item format

The client generates a random UUIDv4 item ID and a new random 12-byte IV for every encryption. It encrypts UTF-8 JSON containing only `title` and `content`, using AES-256-GCM with a 128-bit authentication tag. Both implementations append the tag to the ciphertext, so the wire format is identical on HTTP and HTTPS. UUIDs are generated from secure random bytes without relying on `crypto.randomUUID`, which is restricted to secure contexts.

The authenticated additional data is the UTF-8 encoding of:

```json
["linkdrop.item.v1", "SESSION_ID", "ITEM_UUID"]
```

Binding the protocol label, session ID and item ID prevents substituting ciphertext into another session or under another item identity. Each API item contains:

```json
{
  "id": "a UUIDv4 generated on the device",
  "encrypted": { "v": 1, "iv": "base64url without padding", "data": "base64url ciphertext and tag without padding" },
  "createdAt": "a timestamp assigned by the server"
}
```

POST requests contain `id` and `encrypted`; the response adds `createdAt`. No title, URL, note, item type or encryption key is sent in those fields. API credentials still travel separately in `x-endpoint-key`, or as a WebSocket subprotocol after `linkdrop.v3`; these credentials authorize access but cannot decrypt content.

The server validates UUIDv4 syntax, envelope version, canonical base64url encoding, a 12-byte IV and ciphertext/tag length of 16–65,536 bytes. It rejects unknown fields, legacy plaintext, duplicate live item IDs and items above the configured session limit. The ciphertext cap accommodates JSON escaping at the client limits of 10,000 content characters and 200 title characters. A malicious client can send structurally valid garbage; only the devices can authenticate or reject its ciphertext.

On decrypt, the device authenticates first, decodes JSON, checks content/title types and lengths, and independently classifies links. Only absolute HTTP(S) URLs without whitespace become clickable links. Notes render as escaped text. A decryption/validation failure clears the displayed snapshot and shows an error; no unencrypted interpretation is attempted. Revision guards discard asynchronous decryptions belonging to older snapshots or a terminated view.

## Boundaries and limitations

- The host delivers the JavaScript. A malicious host or compromised deployment can modify it to capture plaintext and keys, despite HTTPS and E2EE in the original source. An independently distributed and verified client would be needed to remove that code-delivery trust. Browser extensions, device compromise, XSS or scripts on the same origin can also access device secrets. Use a dedicated origin without analytics or third-party scripts.
- Both authorized devices hold the same symmetric key. Either can create valid items; it is not a digital signature distinguishing their authors. Phone replacement revokes API access, not knowledge of the key. If an old Phone obtains later ciphertext through a malicious server or another channel, its retained key can decrypt it.
- GCM authenticates each item, not the complete list. A server can omit, reorder or replay a previously valid item and alter its unauthenticated timestamp. There is no authenticated list history, replay defense or delivery guarantee. Deleting an item cannot revoke copies already obtained by another device.
- Server memory retention is separate from reverse-proxy logs, swap, crash dumps, screenshots, clipboard history and client storage. There is no claim of secure erasure across that infrastructure.
- Fresh IVs are generated randomly, not from a counter shared between devices. The session's small, temporary workload keeps collision probability low; this is not a long-lived archival encryption protocol.

## Verification

Frontend tests use real Web Crypto and `@noble/ciphers` implementations for cross-device round trips, native/library interoperability, nonce diversity, wrong-key failures, ciphertext/IV/session/item tampering, legacy rejection, URL fragment handling, Unicode and JSON size boundaries, safe link classification and storage resumption. UI tests cover pairing and encrypted send/receive without `crypto.subtle` or `crypto.randomUUID`, and block browsers without secure randomness. The Go handler tests reject plaintext and malformed envelopes, enforce resource bounds, preserve opaque items over HTTP/WebSocket, and maintain authentication and revocation checks.

Relevant references: [AES-GCM parameters](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams), [getRandomValues on HTTP](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues) and [the noble-ciphers implementation](https://github.com/paulmillr/noble-ciphers). These describe the primitives; they do not constitute an audit of this application protocol.
