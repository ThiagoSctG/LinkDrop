# Security Policy

## Supported versions

LinkDrop is in early development. Security fixes are released only for the latest version.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through [**Report a vulnerability**](https://github.com/ThiagoSctG/LinkDrop/security/advisories/new) in the repository's **Security** tab. Reports in English or Portuguese are welcome.

When possible, include:

- a description of the issue and its expected impact;
- minimal steps to reproduce it;
- the affected version, commit or environment;
- a suggested fix, if you have one.

Do not access other people's data, disrupt services or disclose the issue before a fix is coordinated. You will receive an acknowledgement as soon as possible, followed by an impact assessment and next steps.

## Scope

LinkDrop encrypts item titles and contents on the devices before transmission. The backend should receive neither plaintext items nor encryption keys. Reports of unintended key disclosure, plaintext transmission, authentication bypass or rendering unauthenticated ciphertext on a device are in scope. The backend can validate envelope structure, but it cannot authenticate the ciphertext without the devices' key.

The host still delivers the web client. Modified JavaScript served by a malicious host, a compromised device or a browser extension can access plaintext and keys; E2EE cannot protect against that execution environment. Metadata and availability remain visible to the server. These boundaries, and the absence of forward secrecy, are documented in [Security and privacy](README.md#security-and-privacy) and [the encryption design](docs/encryption.md).

HTTP access by LAN IP is supported for trusted local networks, with a transport notice. It encrypts items but cannot protect the delivered client or endpoint credentials from an active network attacker. Use HTTPS for public instances and untrusted networks.
