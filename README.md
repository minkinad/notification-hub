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
- Project isolation with per-project API keys
- Configurable per-project `rateLimit` and `rateLimitWindow`
- Channel management for `EMAIL`, `TELEGRAM`, `WEBHOOK`, and `SMS`
- Event ingestion through authenticated API calls or `x-api-key`
- Automatic notification creation for active project channels
- Notification inspection and retry scheduling
- Prisma-based PostgreSQL persistence
- Redis and BullMQ bootstrap modules for async expansion
- Request validation, structured error responses, and Swagger docs
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
5. Operators inspect notifications and trigger retries when needed.

## Tech Stack

- Node.js
- TypeScript
- NestJS 11
- Prisma
- PostgreSQL
- Redis
- BullMQ
- Swagger / OpenAPI
- Jest
- ESLint

## Project Status

This repository is ready to run and demonstrates a complete backend foundation for a notification platform.

Implemented:

- Authentication and authorization
- Core CRUD APIs for users, projects, channels, events, notifications
- Event-to-notification fan-out logic
- Health endpoint
- Validation, docs, tests, and local developer tooling

Not included yet:

- Real delivery workers for email, Telegram, SMS, or webhook dispatch
- Delivery receipts from external providers
- Dead-letter queue processing
- Metrics, tracing, and dashboards
- Full e2e test environment with real infrastructure containers

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Create environment file

```bash
cp .env.example .env
```

### 3. Generate Prisma client

```bash
npm run prisma:generate
```

### 4. Apply database migrations

```bash
npm run prisma:migrate
```

### 5. Seed local data

```bash
npm run seed
```

### 6. Start the application

```bash
npm run start:dev
```

Application URLs:

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/docs`
- Health: `http://localhost:3000/api/v1/health`

## Environment Variables

Use [.env.example](.env.example) as the base configuration.

Required:

- `DATABASE_URL`
- `JWT_SECRET`

Recommended:

- `REDIS_URL` or `REDIS_HOST` + `REDIS_PORT`
- `CORS_ORIGIN`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`

## Seed Credentials

The seed script creates a default admin account and sample project data.

- Email: `admin@notification-hub.com`
- Password: `admin123`

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
- `GET /notifications/:id`
- `POST /notifications/:id/retry`

System:

- `GET /health`

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

### Ingest an event with project API key

```bash
curl -X POST http://localhost:3000/api/v1/events/ingest \
  -H "x-api-key: <PROJECT_API_KEY>" \
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
npm run start:dev
npm run build
npm run lint
npm test
npm run prisma:validate
npm run prisma:studio
```

## Testing

The current test suite covers critical service behavior:

- project ownership checks
- event fan-out into notification records
- notification creation behavior with and without active channels

Run tests with:

```bash
npm test
```

## Operational Notes

- The API uses URI versioning and currently serves `v1`.
- Global validation strips unknown fields and rejects invalid payloads.
- Responses are wrapped by a response interceptor for consistent API shape.
- Errors are normalized by a global exception filter.
- Redis and BullMQ are wired for future async processing, even though external delivery workers are not implemented yet.

## Roadmap

- Add worker processes for actual channel delivery
- Introduce delivery execution history from external providers
- Replace simple project API key usage with first-class API key management flows
- Add audit logs to every write operation
- Add e2e coverage against real Postgres and Redis
- Add metrics and observability integrations

## Contributing

Contributions are welcome. For non-trivial changes, open an issue first to discuss the intended design or behavior before submitting a pull request.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
