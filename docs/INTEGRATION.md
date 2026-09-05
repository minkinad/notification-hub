# Integration Guide

Notification Hub exposes a versioned REST API for creating projects, configuring channels, ingesting events, and inspecting delivery state.

Base URL:

```text
https://your-notification-hub.example.com/api/v1
```

Local development URL:

```text
http://localhost:3000/api/v1
```

## Authentication Modes

Use JWT bearer tokens for operator and dashboard workflows:

```http
Authorization: Bearer <JWT_TOKEN>
```

Use `x-api-key` for application-to-application event ingestion:

```http
x-api-key: <PROJECT_OR_MANAGED_API_KEY>
```

Managed API keys support scopes, expiration, revocation, last-used tracking, and optional per-key rate limits. Full key values are returned only when created or regenerated. Store them immediately in your secret manager.

## Recommended Integration Flow

1. Register or log in an operator account.
2. Create a project.
3. Store the returned legacy project API key if you want a simple first integration.
4. Prefer creating a managed API key with `events:ingest` for production apps.
5. Create one or more channels.
6. Send events to `/events/ingest`.
7. Poll `/events/:id` or `/notifications?projectId=...` to inspect fan-out and delivery status.

## Minimal Event Ingest

```bash
curl -X POST "$NOTIFICATION_HUB_URL/api/v1/events/ingest" \
  -H "x-api-key: $NOTIFICATION_HUB_API_KEY" \
  -H "Idempotency-Key: invoice-inv_1001" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "invoice.created",
    "data": {
      "invoiceId": "inv_1001",
      "amount": 1999,
      "currency": "USD"
    }
  }'
```

Successful ingestion creates an event and notification intents for active project channels. Delivery is asynchronous.

`Idempotency-Key` is optional, project-scoped, and limited to 255 characters.
Repeated requests with the same key return the original event without creating
duplicate notification intents. Use a stable business identifier and reuse it
when retrying a timed-out ingest request.

## Event Payload Contract

`type` should be a stable business event name such as `invoice.created`, `user.registered`, or `payment.failed`.

`data` is JSON and should contain only the fields needed by downstream templates/providers. Avoid sending credentials or large blobs.

## Delivery Semantics

Notification Hub persists delivery schedules and retries failed queue publication.
External effects may be repeated; exactly-once delivery is not guaranteed:

- Event and notification records are stored transactionally.
- Queue scheduling is backed by `delivery_outbox`; initial delivery, retry, and replay use the same dispatcher.
- Each schedule has its own queue job identity. Retrying publication of one schedule reuses that identity; a new delivery attempt gets a new one.
- Delivery workers can retry failed provider calls with exponential backoff.
- Provider endpoints should be idempotent by `notificationId`.

A worker crash after claiming a notification can leave it in `PROCESSING`; automatic lease recovery is not implemented yet. Redis loss after successful queue publication also requires operational recovery. See the [architecture review](ARCHITECTURE.md#delivery-contract-and-remaining-limits).

Ingest reports confirmed dispatches as `notificationsQueued` and unconfirmed dispatches, when present, as `notificationsQueuePending`. Pending confirmation does not necessarily mean the Redis job is absent. Queue availability does not overwrite the event status.

Webhook and HTTP-provider deliveries include:

```json
{
  "notificationId": "clx...",
  "eventId": "clx...",
  "projectId": "clx...",
  "type": "invoice.created",
  "recipient": "https://example.com/hook",
  "subject": null,
  "data": {},
  "createdAt": "2026-06-01T00:00:00.000Z"
}
```

## Status Model

Events:

- `PENDING`: stored with no active channels; no later automatic fan-out is performed
- `PROCESSING`: notifications are open
- `COMPLETED`: all notifications were sent
- `FAILED`: at least one notification failed and no notifications are open

Notifications:

- `PENDING`: waiting to be processed
- `PROCESSING`: claimed by a worker
- `SENT`: provider accepted delivery or mock delivery was recorded
- `RETRYING`: scheduled for another attempt
- `FAILED`: retries exhausted

Permanently failed notifications are available through
`GET /notifications/dead-letter`. An operator can schedule a fresh delivery
cycle with `POST /notifications/:id/replay`; replay resets the retry budget and
uses the delivery outbox if Redis is unavailable.

## Health Endpoints

- `GET /api/v1/health/live`: process liveness, no dependency checks
- `GET /api/v1/health/ready`: readiness with concurrent Postgres/Redis checks; returns `503` on failure, timeout or shutdown
- `GET /api/v1/health`: diagnostic `200` response; inspect `data.status` and `data.dependencies`, not just HTTP status

Health routes bypass general throttling and set `Cache-Control: no-store`. `HEALTH_CHECK_TIMEOUT_MS` defaults to 2000 ms. Dependency errors expose only `unavailable`, `timeout` or `shutting_down` reasons. Production readiness errors use the standard error envelope with `message: "Service is not ready"`; detailed dependency status is available from the diagnostic route.
- `GET /api/v1/health`: detailed dependency status

## Rate Limits

Project and managed key limits are enforced for `/events/ingest`. A `429` response includes `limit`, `remaining`, and `resetAt`.

## Security Expectations

- Treat API keys as secrets.
- Store keys in a secret manager.
- Rotate keys periodically.
- Prefer managed keys over the legacy project key.
- Keep webhook providers idempotent and validate request origin at your edge.
