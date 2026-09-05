# Notification Hub

Notification Hub is a NestJS backend for accepting application events and delivering notifications through project-specific channels. PostgreSQL stores events, notification state, and durable delivery schedules. BullMQ and Redis run background delivery in the same process as the HTTP API.

The repository includes authentication, project isolation, managed API keys, transactional outbox scheduling, retry/replay workflows, health probes, Docker images, and automated tests. Review the [production limits](#production-readiness-and-limits) before using it for unattended delivery.

## Documentation

| Document | Purpose |
| --- | --- |
| [Deployment guide](docs/DEPLOYMENT.md) | Runtime configuration, migrations, probes, rollout and recovery |
| [Integration guide](docs/INTEGRATION.md) | Authentication, API examples, payloads and delivery semantics |
| [Architecture review](docs/ARCHITECTURE.md) | Module boundaries, delivery invariants, known risks and priorities |
| [Contribution guide](CONTRIBUTING.md) | Development workflow, tests and commits |
| [Agent instructions](AGENTS.md) | Repository-specific engineering rules and verification requirements |
| [Security policy](SECURITY.md) | Security defaults and reporting guidance |
| [Changelog](CHANGELOG.md) | Unreleased changes |

## Production readiness and limits

Implemented safeguards include hashed API keys, encrypted sensitive channel fields, project ownership checks, request validation, HTTP delivery destination checks, durable scheduling, atomic worker claims, and serialized event status updates.

Several operational limits remain:

- **Worker crash recovery:** a crash after claiming a notification can leave it in `PROCESSING`. Automatic lease recovery is not implemented. A database failure after provider acceptance also leaves an ambiguous result; it does not automatically resend.
- **Mock delivery:** email/SMS without a configured HTTP provider and Telegram without a usable token can record mock success, including with `NODE_ENV=production`. Verify each channel with a real provider before enabling traffic. `SENT` means provider acceptance or mock completion, not a delivery receipt.
- **Redis data loss:** outbox recovery covers unconfirmed queue publication. It does not reconstruct every acknowledged job after Redis loses data.
- **Access policy:** ownership is enforced, but `VIEWER` does not currently imply read-only access to owned resources. API-key checks do not consult the owner's active flag. Public registration is enabled; restrict it at the edge if that is unsuitable for your deployment.
- **Operations:** provider receipts, delivery leases, metrics/tracing, retention policies and bulk dead-letter replay are not implemented. Audit writes are best effort.

There is no exactly-once delivery guarantee. HTTP consumers should deduplicate using the stable `notificationId`. The [architecture review](docs/ARCHITECTURE.md#delivery-contract-and-remaining-limits) explains the remaining work and acceptance criteria.

## Runtime and architecture

Use Node.js 22 to match the production Docker image. CI also exercises Node.js 20. Dependencies are pinned by `package-lock.json`; use `npm ci`. Integration CI uses PostgreSQL 16 and Redis 7.

```mermaid
flowchart LR
    API[JWT / API-key ingest] --> TX[PostgreSQL transaction]
    TX --> Records[Event + notifications]
    TX --> Outbox[Delivery outbox]
    Outbox --> Dispatcher[Dispatcher]
    Dispatcher --> Queue[BullMQ / Redis]
    Queue --> Worker[Delivery worker]
    Worker --> Provider[Provider]
    Worker --> Result[Result transaction]
    Result --> Records
    Result -->|retry| Outbox
```

Event creation and notification fan-out commit with their initial schedules. Each schedule uses its immutable outbox row ID as the queue job ID. Retry/replay gets a fresh schedule identity; repeated publication of the same schedule reuses its ID. Workers claim due notifications atomically and update the parent event under a database row lock. Provider and Redis calls run outside these transactions.

API replicas also run workers and outbox sweeps. Scaling the HTTP deployment therefore scales delivery consumers; there is no worker-only entry point yet.

## Local setup

### Docker Compose

```bash
cp .env.example .env
```

Replace `JWT_SECRET` and `CHANNEL_CONFIG_ENCRYPTION_KEY` with **separate** random values of at least 32 characters. Generate each value locally, for example with `openssl rand -hex 32`; store production values in your secret manager.

```bash
npm run docker:up
```

Compose starts PostgreSQL and Redis, applies migrations through the `migrate` service, and starts the API. It does not seed accounts. This Compose file is a local/example deployment: it includes development database credentials and publishes dependency ports. For production networking and external dependencies, follow the [deployment guide](docs/DEPLOYMENT.md).

```bash
npm run docker:down
```

The default Compose stack retains its named database and Redis volumes when stopped without `--volumes`.

### Local Node.js

```bash
npm ci
cp .env.example .env
# Replace both secret placeholders before starting the application.
npm run dev:infra
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
```

`prisma:deploy` applies committed migrations. Use `npm run prisma:migrate` only when developing a new schema migration against a disposable/local database.

| Endpoint | URL |
| --- | --- |
| API base | `http://localhost:3000/api/v1` |
| Swagger | `http://localhost:3000/docs` |
| Liveness | `http://localhost:3000/api/v1/health/live` |
| Readiness | `http://localhost:3000/api/v1/health/ready` |
| Diagnostic summary | `http://localhost:3000/api/v1/health` |

The optional `npm run seed` command creates known development credentials (`admin@notification-hub.com` / `admin123`) and fixed sample API keys. Run it only against a disposable development database. It is not a production provisioning procedure.

## Configuration

[`.env.example`](.env.example) is the configuration template. Validation lives in [`env.validation.ts`](src/common/config/env.validation.ts). Export variables through the runtime environment or use `.env` for local development.

| Variable | Default / requirement | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required PostgreSQL URL | Application persistence; production pool/connect timeouts belong in your database configuration |
| `JWT_SECRET` | Required, at least 32 characters | JWT signing; documented placeholders are rejected |
| `CHANNEL_CONFIG_ENCRYPTION_KEY` | Required, at least 32 characters | Channel secret encryption; back up and keep stable until a re-encryption procedure exists |
| `JWT_EXPIRATION` | `7d` | JWT validity |
| `NODE_ENV` | `development` | Set `production` in deployed environments; this does not disable mock delivery |
| `PORT` | `3000` | HTTP listen port |
| `REDIS_URL` | Optional `redis://` URL | Takes precedence over host/port for rate limiting and BullMQ |
| `REDIS_HOST`, `REDIS_PORT` | `localhost`, `6379` | Redis fallback connection |
| `CORS_ORIGIN` | `*` | Set an explicit trusted origin; CORS is not authorization |
| `HEALTH_CHECK_TIMEOUT_MS` | `2000`, integer `1..30000` | Per-dependency response deadline; checks run concurrently |
| `RATE_LIMIT_WINDOW_MS` | `60000` | General HTTP throttling window; health routes are exempt |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | General HTTP request limit; the default store is per process |
| `DELIVERY_HTTP_TIMEOUT_MS` | `5000` | Provider HTTP request timeout; pre-request DNS resolution is outside this timer |
| `DELIVERY_HTTP_MAX_RESPONSE_BYTES` | `32768` | Maximum provider response body read |
| `DELIVERY_HTTP_BLOCK_PRIVATE_NETWORKS` | `true` | Reject private/local HTTP delivery destinations |
| `DELIVERY_OUTBOX_INTERVAL_MS` | `30000` | Recovery sweep interval; a sweep also runs at startup |
| `APP_NAME`, `APP_VERSION` | `NotificationHub`, `1.0.0` | Metadata returned by health endpoints |

Project/key ingest limits are separate from general HTTP throttling and are stored in Redis. `rediss://` is not currently accepted by environment validation; do not assume direct Redis TLS support is configured. Review connectivity requirements before selecting a managed service.

## API and delivery

All routes below are relative to `/api/v1`. Swagger provides DTO details. Successful responses use `{ success, data, message, timestamp, path }`; failures use `{ statusCode, message, timestamp, path }` with additional details only in development.

| Area | Routes |
| --- | --- |
| Authentication | `POST /auth/register`, `POST /auth/login` |
| Users | `GET/PATCH /users/profile`; admin-only `GET /users` |
| Projects | `POST/GET /projects`, `GET/PATCH/DELETE /projects/:id`, `POST /projects/:id/regenerate-key` |
| API keys | `GET/POST /projects/:id/api-keys`, `PATCH/DELETE /projects/:id/api-keys/:keyId` |
| Channels | `POST/GET /channels`, `GET/PATCH/DELETE /channels/:id`; list requires `projectId` |
| Events | `POST/GET /events`, `GET /events/:id`, API-key `POST /events/ingest` |
| Notifications | `GET /notifications`, `GET /notifications/dead-letter`, `GET /notifications/:id`, `POST /notifications/:id/retry`, `POST /notifications/:id/replay` |

Use JWT authentication to create a project, configure a channel and create a managed API key with the `events:ingest` scope. The full key is returned once. Save it before leaving the create response.

```bash
curl --fail-with-body -X POST http://localhost:3000/api/v1/events/ingest \
  -H 'Content-Type: application/json' \
  -H "x-api-key: $PROJECT_API_KEY" \
  -H 'Idempotency-Key: invoice-inv_1001' \
  -d '{"type":"invoice.created","data":{"invoiceId":"inv_1001","amount":1999}}'
```

Reuse the same project-scoped idempotency key when retrying the same request. A conflicting payload currently returns the original event, so never reuse a key for a different business operation. An event with no active channels remains `PENDING`; adding a channel later does not automatically fan it out.

| Channel | Configuration and behavior |
| --- | --- |
| `WEBHOOK` | `url`: HTTP(S) destination without URL credentials; optional `headers` |
| `TELEGRAM` | `chatId` or `username`; real sending needs a usable `botToken` that does not start with `test-` |
| `EMAIL` | `to` or `email`; HTTP delivery needs `provider: "http"` and `deliveryUrl` (or `url`); otherwise mock |
| `SMS` | `phone`; same HTTP-provider configuration as email; otherwise mock |

Only one channel per type is allowed in each project. Delivery uses the channel's current configuration. Queue confirmation is reported as `notificationsQueued`; `notificationsQueuePending` indicates unconfirmed publication when present. It is not a count of failed provider deliveries. See the [integration guide](docs/INTEGRATION.md) for payloads, states and replay behavior.

## Health and monitoring

| Route | HTTP contract | Use |
| --- | --- | --- |
| `/health/live` | `200` while the process serves requests; no dependency I/O | Liveness |
| `/health/ready` | `200` when PostgreSQL and Redis respond; `503` on failure, timeout or shutdown | Traffic readiness |
| `/health` | `200` with `data.status: ok/degraded` and dependency diagnostics | Diagnostic summary; do not use HTTP status alone for readiness |

Health responses set `Cache-Control: no-store` and bypass the general request throttle. Dependency failures expose stable reasons (`unavailable`, `timeout`, `shutting_down`), not driver error messages or connection strings. A timeout bounds the response; it does not cancel the underlying driver call. Concurrent requests share in-flight checks so outages do not accumulate one database/Redis operation per probe.

Set the platform probe timeout above `HEALTH_CHECK_TIMEOUT_MS` (for example 5 seconds for the 2-second default). Dependency readiness does not prove that notifications are being delivered or that the outbox is draining. Monitor overdue `PROCESSING` records, outbox age, queue backlog, retries and provider failures separately. See [probe configuration](docs/DEPLOYMENT.md#health-probes).

## Verification and contribution

```bash
npm run ci:verify
```

This validates/generates Prisma, checks formatting and lint, runs unit tests and health HTTP tests, and builds the application. HTTP health tests use controlled dependency substitutes; they do not require PostgreSQL or Redis.

Delivery integration tests use actual PostgreSQL and Redis:

```bash
docker compose -p notification-hub-architecture-test -f docker-compose.test.yml up -d --wait
export TEST_DATABASE_URL=postgresql://notification_test:notification_test@127.0.0.1:15433/notification_hub_test
export TEST_REDIS_URL=redis://127.0.0.1:16380
DATABASE_URL="$TEST_DATABASE_URL" npm run prisma:deploy
npm run test:integration
docker compose -p notification-hub-architecture-test -f docker-compose.test.yml down
```

Tests require explicit test URLs and use isolated fixtures/queues. CI runs quality checks, health HTTP tests, delivery integration tests, coverage collection, dependency review on pull requests, and a Docker build. Full HTTP authorization and worker process-kill coverage remain follow-up work.

Use focused commits such as `fix(health): bound dependency probe response time` or `test(delivery): cover retained-job replay`. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

## Deployment

Build with the checked-in Dockerfile and apply committed migrations before starting the new application. Use protected database/Redis networks, TLS termination, managed secrets and tested backups. The image runs as the non-root `node` user.

When upgrading the delivery dispatcher from acknowledgement by notification ID, **drain/stop old instances before starting new ones**. Mixing versions can delete a newer retry schedule. This delivery change adds no schema migration. Detailed commands and rollback constraints are in [DEPLOYMENT.md](docs/DEPLOYMENT.md).

## License

[MIT](LICENSE).
