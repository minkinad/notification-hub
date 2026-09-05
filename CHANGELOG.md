# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog, and this project follows semantic versioning once public releases are published.

## Unreleased

### Added

- Production Dockerfile and Docker Compose setup
- Postgres/Redis development infrastructure compose file
- Readiness and liveness health endpoints
- Integration guide for application developers
- Contribution and security guidance
- Project-scoped idempotency keys for event creation and ingestion
- Dead-letter notification listing and replay API

- Detailed repository instructions in `AGENTS.md` and production deployment/architecture guidance
- Real PostgreSQL/Redis delivery integration tests and a dedicated CI job
- HTTP health contract tests in the quality gate
- Configurable `HEALTH_CHECK_TIMEOUT_MS` with a 2000 ms default

### Fixed

- Retry/replay queue identities no longer collide with retained delivery jobs
- Stale outbox acknowledgements cannot delete newly scheduled retries
- Concurrent delivery results serialize parent event status updates
- Worker claims enforce due time and observed notification state
- Provider success followed by persistence failure no longer schedules an automatic resend
- Partial queue publication reports confirmed/pending counts without overwriting event status
- Health responses have bounded deadlines, share pending dependency checks, bypass general throttling and disable caching
- Health diagnostics hide internal driver errors and report unready during shutdown

### Removed

- Project work-management APIs, schema models, seed data, and documentation

### Security

- Hashed API key storage with one-time key reveal
- Channel config secret redaction in API responses and audit changes
- HTTP delivery timeout, response-size, redirect, and private-network protections
- Outbox-backed delivery queue recovery
- Global HTTP throttling and durable retry outbox recovery
- Generic production responses for unexpected server errors
- Required non-placeholder JWT secrets with a minimum length of 32 characters
- AES-256-GCM encryption for sensitive channel configuration values
