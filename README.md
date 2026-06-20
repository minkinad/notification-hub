# Notification Hub

[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![NestJS](https://img.shields.io/badge/nestjs-11-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/typescript-5.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/prisma-5-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Notification Hub is a production-oriented NestJS backend for ingesting domain events, storing notification intents, and exposing a clean API for authentication, project isolation, channel management, event tracking, and retry workflows.

It is designed as the core of a centralized notification platform for SaaS products and internal systems that need a single service for event intake and notification orchestration.

## Features

- JWT authentication with registration and login
- User profile management
- Admin-only user listing
- Project isolation with hashed per-project API keys
- First-class project API key management with one-time key reveal, named keys, scopes, expiration, revocation, and last-used tracking
- Configurable per-project `rateLimit` and `rateLimitWindow`
- Redis-backed ingest rate limiting per managed API key or legacy project key
- Channel management for `EMAIL`, `TELEGRAM`, `WEBHOOK`, and `SMS`
- Event ingestion through authenticated API calls or `x-api-key`
- Project-scoped idempotency keys for duplicate-safe event ingestion
- Automatic notification creation, outbox-backed BullMQ delivery scheduling, and queue recovery
- Notification inspection, retry scheduling, delivery logs, and status transitions
- Dead-letter inspection and replay for permanently failed notifications
- AES-256-GCM encryption for sensitive channel configuration values at rest
- Audit logging for project, API key, channel, event, and notification retry writes
- Prisma migrations and PostgreSQL persistence
- HTTP delivery protections for timeout, response-size limits, redirects, and local/private network targets
- Redis and BullMQ bootstrap modules for async expansion
- Request validation, structured error responses, and Swagger docs
- Docker and Docker Compose setup for local and production-style runs
- Liveness/readiness endpoints for container orchestration
- Linting and unit test coverage for critical service flows

## Architecture

The service is organized around a modular NestJS application:

- `auth`: registration, login, JWT validation
- `users`: current profile and admin user listing
- `projects`: tenant-like project boundaries and API key lifecycle
- `channels`: channel configuration per project
- `events`: event ingestion and notification fan-out
- `notifications`: notification visibility and retry control
- `health`: service health endpoint
- `common`: guards, filters, interceptors, Prisma, Redis, queue bootstrap

High-level flow:

1. A client creates a project and configures one or more channels.
2. The client sends an event through the authenticated API or project API key.
3. The event is stored in PostgreSQL.
4. The system creates notification records for all active channels on the project.
5. A delivery outbox records notifications that must be queued, then BullMQ jobs are scheduled.
6. Delivery workers process queued notifications, write delivery logs, and update event status.
7. If queue scheduling fails, the outbox reconciler retries enqueueing in the background.
8. Operators inspect notifications and trigger retries when needed.

## Tech Stack

- Node.js
- TypeScript
- NestJS 11
- Prisma
- PostgreSQL
- Redis
- BullMQ
- Docker / Docker Compose
- Swagger / OpenAPI
- Jest
- ESLint

## Project Status

This repository is ready to run and demonstrates a complete backend foundation for a notification platform.

Implemented:

- Authentication and authorization
- Core CRUD APIs for users, projects, channels, events, notifications
- Hashed legacy and managed project API key lifecycle
- Redis-backed ingest rate limiting
- Event-to-notification fan-out and outbox-backed BullMQ delivery queueing
- Delivery state machine with retry/backoff and delivery logs
- HTTP delivery guardrails for webhook/HTTP providers
- Audit logs for write operations
- Prisma migration history
- Health endpoint
- Dockerfile, Docker Compose, and deployment guide
- Integration guide for external application developers
- Validation, docs, tests, and local developer tooling

Not included yet:

- Provider-specific email and SMS integrations beyond HTTP-provider/mocked delivery
- Delivery receipts and callbacks from external providers
- Dead-letter queue processing
- Metrics, tracing, and dashboards

## Quick Start

### Option A: Full stack with Docker

Create the environment file and replace `JWT_SECRET` and
`CHANNEL_CONFIG_ENCRYPTION_KEY` with separate values of at least 32 random
characters:

```bash
cp .env.example .env
```

```bash
npm run docker:up
```

This starts PostgreSQL, Redis, runs Prisma migrations, and starts the API.

Application URLs:

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/docs`
- Health: `http://localhost:3000/api/v1/health`
- Liveness: `http://localhost:3000/api/v1/health/live`
- Readiness: `http://localhost:3000/api/v1/health/ready`

Stop the stack with:

```bash
npm run docker:down
```

### Option B: Local Node.js

Start local infrastructure:

```bash
npm run dev:infra
```

Install dependencies:

```bash
npm install
```

Create environment file:

```bash
cp .env.example .env
```

Replace `JWT_SECRET` and `CHANNEL_CONFIG_ENCRYPTION_KEY` before starting the
application.

Generate Prisma client:

```bash
npm run prisma:generate
```

Apply database migrations:

```bash
npm run prisma:migrate
```

Seed local data:

```bash
npm run seed
```

Start the application:

```bash
npm run start:dev
```

Application URLs:

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/docs`
- Health: `http://localhost:3000/api/v1/health`

## Documentation

- [Integration guide](docs/INTEGRATION.md): authentication modes, event ingest, delivery semantics, status model
- [Deployment guide](docs/DEPLOYMENT.md): runtime config, migrations, Docker, probes, scaling notes
- [Contributing guide](CONTRIBUTING.md): local setup, quality gate, pull request expectations
- [Security policy](SECURITY.md): vulnerability reporting and operational security baseline

## Environment Variables

Use [.env.example](.env.example) as the base configuration.

Required:

- `DATABASE_URL`
- `JWT_SECRET`
- `CHANNEL_CONFIG_ENCRYPTION_KEY`

Recommended:

- `REDIS_URL` or `REDIS_HOST` + `REDIS_PORT`
- `CORS_ORIGIN`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`
- `DELIVERY_HTTP_TIMEOUT_MS`
- `DELIVERY_HTTP_MAX_RESPONSE_BYTES`
- `DELIVERY_HTTP_BLOCK_PRIVATE_NETWORKS`
- `DELIVERY_OUTBOX_INTERVAL_MS`

## Seed Credentials

The seed script creates a default admin account and sample project data.

- Email: `admin@notification-hub.com`
- Password: `admin123`
- Legacy project API key: `test-api-key-12345`
- Managed ingest API key: `test-managed-api-key-12345`

## API Overview

Base path: `/api/v1`

Authentication:

- `POST /auth/register`
- `POST /auth/login`

Users:

- `GET /users/profile`
- `PATCH /users/profile`
- `GET /users` admin only

Projects:

- `POST /projects`
- `GET /projects`
- `GET /projects/:id`
- `PATCH /projects/:id`
- `DELETE /projects/:id`
- `POST /projects/:id/regenerate-key`
- `GET /projects/:id/api-keys`
- `POST /projects/:id/api-keys`
- `PATCH /projects/:id/api-keys/:keyId`
- `DELETE /projects/:id/api-keys/:keyId`

Channels:

- `POST /channels`
- `GET /channels?projectId=...`
- `GET /channels/:id`
- `PATCH /channels/:id`
- `DELETE /channels/:id`

Events:

- `POST /events`
- `POST /events/ingest`
- `GET /events`
- `GET /events/:id`

Notifications:

- `GET /notifications`
- `GET /notifications/dead-letter`
- `GET /notifications/:id`
- `POST /notifications/:id/retry`
- `POST /notifications/:id/replay`

System:

- `GET /health`
- `GET /health/live`
- `GET /health/ready`

## Example Workflow

### Register and authenticate

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@example.com",
    "password": "password123",
    "firstName": "Owner",
    "lastName": "User"
  }'
```

### Create a project

```bash
curl -X POST http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Billing Platform",
    "description": "Project for billing notifications",
    "rateLimit": 1000,
    "rateLimitWindow": 3600
  }'
```

### Add a webhook channel

```bash
curl -X POST http://localhost:3000/api/v1/channels \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "<PROJECT_ID>",
    "type": "WEBHOOK",
    "name": "Primary Webhook",
    "config": {
      "url": "https://example.com/hooks/notifications"
    }
  }'
```

Channel config rules:

- `EMAIL`: requires `to` or `email`
- `TELEGRAM`: requires `chatId` or `username`
- `WEBHOOK`: requires a valid `url`
- `SMS`: requires `phone`

Delivery behavior:

- `WEBHOOK` sends an HTTP `POST` to `config.url`.
- `TELEGRAM` sends via the Telegram Bot API when `botToken` is configured and not a test token.
- `EMAIL` and `SMS` can be delivered through an HTTP provider by setting `config.provider` to `http` and `config.deliveryUrl`; otherwise they use mock delivery and still produce delivery logs.
- HTTP delivery blocks redirects, blocks localhost/private-network targets by default, applies a timeout, and caps provider response reads.
- Failed deliveries are retried with exponential backoff until `maxRetries` is reached.
- Queue scheduling is backed by `delivery_outbox`, so notifications created while BullMQ is unavailable can be enqueued by the reconciler later.

### Create a managed API key

```bash
curl -X POST http://localhost:3000/api/v1/projects/<PROJECT_ID>/api-keys \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production ingest",
    "scopes": ["events:ingest"],
    "rateLimit": 500,
    "rateLimitWindow": 3600
  }'
```

The `key` value is returned only in this create response. Subsequent project and API-key reads expose `apiKeyPrefix` or `keyPrefix`, while the database stores only SHA-256 hashes.

### Ingest an event with project API key

```bash
curl -X POST http://localhost:3000/api/v1/events/ingest \
  -H "x-api-key: <PROJECT_API_KEY>" \
  -H "Idempotency-Key: invoice-inv_1001" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "invoice.created",
    "data": {
      "invoiceId": "inv_1001",
      "amount": 1999
    }
  }'
```

## Development

Useful commands:

```bash
npm run dev:infra
npm run dev:infra:down
npm run start:dev
npm run build
npm run lint
npm test
npm run prisma:validate
npm run prisma:migrate
npm run prisma:deploy
npm run prisma:studio
npm run ci:verify
```

## Testing

The current test suite covers critical service behavior:

- project ownership checks
- event fan-out into notification records
- notification creation behavior with and without active channels
- managed API key verification and creation
- idempotent event ingestion
- ingest rate limiting
- notification retry scheduling and delivery status transitions
- channel config encryption and dead-letter replay
- API key, project isolation, delivery, and validation regressions

Run tests with:

```bash
npm test
```

## Operational Notes

- The API uses URI versioning and currently serves `v1`.
- Global validation strips unknown fields and rejects invalid payloads.
- Responses are wrapped by a response interceptor for consistent API shape.
- Errors are normalized by a global exception filter.
- Redis backs project ingest rate limits and BullMQ delivery scheduling.
- `GET /api/v1/health/live` checks process liveness only.
- `GET /api/v1/health/ready` checks PostgreSQL and Redis and returns `503` when dependencies are unavailable.
- Delivery workers process webhook and Telegram deliveries directly. Email and SMS use HTTP-provider delivery when configured, otherwise mock delivery is recorded for local workflows.
- Project and managed API keys are stored as SHA-256 hashes with non-secret prefixes for lookup/debugging. Full secrets are only returned when created or regenerated.
- Sensitive channel config values are encrypted at rest and redacted in API responses and audit changes.
- Keep `CHANNEL_CONFIG_ENCRYPTION_KEY` stable and backed up; changing it requires re-encrypting existing channel configs.

## Deployment

Run database migrations before starting new application instances:

```bash
npm run prisma:deploy
```

Build the production image:

```bash
docker build -t notification-hub .
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for environment variables, probes, and scaling notes.

## Roadmap

- Add provider-specific email and SMS adapters
- Add dead-letter retention policies and bulk replay
- Add e2e coverage against real Postgres and Redis
- Add metrics and observability integrations

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. For non-trivial changes, open an issue first to discuss the intended design or behavior.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
