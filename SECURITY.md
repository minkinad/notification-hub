# Security policy

## Scope and reporting

Security fixes target the current maintained code. This repository does not currently publish a version-support schedule or a guaranteed response SLA.

Do not post vulnerability details, credentials or customer data in public issues. Use the repository's private vulnerability reporting channel if enabled. Otherwise ask the maintainer for a private contact without disclosing exploit details publicly.

A useful report includes the affected commit/version, a minimal reproduction, prerequisites, likely impact and suggested mitigation. Redact real secrets and personal data. Coordinate disclosure with the maintainer after a private report has been received.

## Implemented controls

- JWT authentication and project ownership checks protect managed resources.
- Project/managed API keys are stored as SHA-256 hashes; raw values are revealed only on creation/regeneration.
- Sensitive channel configuration fields use AES-256-GCM at rest and are redacted in API responses and audit changes.
- Provider HTTP uses destination validation, validated-DNS pinning, redirect blocking, request timeout and response-size limits.
- General HTTP throttling and Redis-backed ingest quotas limit requests; health routes deliberately bypass the general throttle.
- Unexpected production errors hide internal details. Health diagnostics return safe reason codes and bound response time without exposing driver connection errors.
- The runtime Docker image runs as the non-root `node` user.

These controls do not establish complete production readiness. See the [documented architecture limits](docs/ARCHITECTURE.md#delivery-contract-and-remaining-limits), especially account/API-key deactivation policy, `VIEWER` write semantics, best-effort audit logging, mock provider success and recovery of ambiguous deliveries.

## Operator responsibilities

Use separate strong JWT/encryption secrets and a secret manager. Back up the channel encryption key with a tested recovery procedure; there is no automatic key rotation/re-encryption mechanism. Never deploy the fixed seed credentials to a live environment.

Terminate TLS at the edge, restrict PostgreSQL/Redis networks, configure authentication and backups, and restrict public registration/Swagger when required. Set an explicit trusted CORS origin; it is not an authorization boundary. Current Redis URL validation accepts `redis://`, not `rediss://`, so verify transport requirements before deployment.

Keep private-network delivery blocking enabled unless internal destinations are explicitly required and reviewed. Avoid secrets in URL query strings, event payloads and provider response bodies: those fields may be stored in notification/delivery records. Do not assume that every provider response or business payload is automatically redacted.

Review dependency/container updates, retention requirements and restoration tests regularly. Health readiness proves dependency connectivity, not successful provider delivery. Operational procedures are in the [deployment guide](docs/DEPLOYMENT.md).
