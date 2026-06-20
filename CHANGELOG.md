# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog, and this project follows semantic versioning once public releases are published.

## Unreleased

### Added

- Production Dockerfile and Docker Compose setup
- Postgres/Redis development infrastructure compose file
- Readiness and liveness health endpoints
- Integration guide for application developers
- Open-source contribution, security, and code of conduct documents
- Project-scoped idempotency keys for event creation and ingestion
- Dead-letter notification listing and replay API

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
