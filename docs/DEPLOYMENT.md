# Deployment Guide

Notification Hub is a stateless NestJS API plus two stateful dependencies:

- PostgreSQL for durable data
- Redis for rate limits and BullMQ queues

## Required Runtime Configuration

Set these variables in every environment:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=<at-least-32-random-characters>
CHANNEL_CONFIG_ENCRYPTION_KEY=<separate-at-least-32-random-characters>
REDIS_URL=redis://...
NODE_ENV=production
```

Recommended:

```bash
CORS_ORIGIN=https://your-dashboard.example.com
DELIVERY_HTTP_BLOCK_PRIVATE_NETWORKS=true
DELIVERY_HTTP_TIMEOUT_MS=5000
DELIVERY_HTTP_MAX_RESPONSE_BYTES=32768
DELIVERY_OUTBOX_INTERVAL_MS=30000
```

## Database Migrations

Run migrations before starting new application instances:

```bash
npm run prisma:deploy
```

For Docker Compose, the `migrate` service runs this step before `api` starts.

## Docker

Build the production image:

```bash
docker build -t notification-hub .
```

Run the full local stack:

```bash
cp .env.example .env
# Replace JWT_SECRET and CHANNEL_CONFIG_ENCRYPTION_KEY before starting the stack.
docker compose up --build
```

## Kubernetes or Container Platforms

Use these probes:

```text
Liveness:  GET /api/v1/health/live
Readiness: GET /api/v1/health/ready
```

Readiness checks PostgreSQL and Redis and returns `503` until both are reachable.

## Scaling

The API is stateless and can run multiple replicas. Delivery workers are part of the same NestJS process in this repository, so every API replica also processes queue jobs. This is acceptable for small and medium deployments.

For larger deployments, split HTTP and worker processes by adding a worker-only bootstrap or deployment profile.

## Operational Checklist

- Use managed PostgreSQL with backups and point-in-time recovery.
- Use managed Redis or a persistent Redis deployment appropriate for BullMQ.
- Terminate TLS at the edge or load balancer.
- Set a strong `JWT_SECRET` and rotate it through your platform secret manager.
- Store `CHANNEL_CONFIG_ENCRYPTION_KEY` in a secret manager and back it up. Do not rotate it without re-encrypting existing channel configs.
- Set `CORS_ORIGIN` to explicit trusted origins.
- Keep `DELIVERY_HTTP_BLOCK_PRIVATE_NETWORKS=true` unless you are intentionally delivering to private infrastructure.
- Monitor `/api/v1/health/ready`, queue depth, failed delivery logs, and database connection pressure.
- Run `npm run ci:verify` in CI before deploying.
