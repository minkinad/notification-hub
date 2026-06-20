# Security Policy

## Supported Versions

Security fixes target the latest `main` branch until formal versioned releases are introduced.

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Email the maintainer or project security contact with:

- affected version or commit
- reproduction steps
- expected impact
- suggested mitigation, if known

You should receive an acknowledgement within 72 hours. If the issue is accepted, the fix will be coordinated before public disclosure.

## Security Baseline

Notification Hub is designed with these defaults:

- API keys are stored as SHA-256 hashes and revealed only once.
- Sensitive channel config fields are encrypted with AES-256-GCM and redacted in responses.
- Webhook and HTTP-provider delivery block localhost/private networks by default.
- HTTP delivery uses timeout and response-size limits.
- Event ingestion supports project and per-key rate limits.

Operators are still responsible for:

- using strong `JWT_SECRET` values
- keeping `CHANNEL_CONFIG_ENCRYPTION_KEY` stable, separate, and backed up
- enforcing TLS at the edge
- storing API keys in a secret manager
- configuring CORS for trusted origins
- restricting database and Redis network exposure
- applying dependency and container security updates
