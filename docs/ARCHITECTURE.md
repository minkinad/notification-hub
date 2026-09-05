# Architecture review and delivery invariants

Reviewed on 2026-09-05. This document describes the implemented design and its remaining limits. It is not a claim of production certification.

## System boundaries

Keep the modular NestJS monolith as the current deployment unit. PostgreSQL owns event, notification, and scheduling state; Redis/BullMQ transports delivery jobs. `projects` owns project access and API keys; `events` accepts events and creates notification intents; `notifications` owns delivery transitions, retries, replay, and dispatch. External provider calls happen outside database transactions.

```mermaid
flowchart LR
    Client --> Auth[JWT / project API key]
    Auth --> Events[Events service]
    Events --> Transaction[PostgreSQL transaction]
    Transaction --> Event[Event + notifications]
    Transaction --> Outbox[Delivery outbox]
    Outbox --> Dispatcher[Outbox dispatcher]
    Dispatcher --> Queue[BullMQ]
    Queue --> Worker[Delivery worker]
    Worker --> Provider[External provider]
    Worker --> Result[Result transaction + event lock]
    Result --> Event
    Result -->|retry schedule| Outbox
```

The dependency on outbox scheduling is mandatory for ingestion and delivery services. Missing delivery wiring now fails application composition instead of silently committing notifications without a durable schedule. Only the dispatcher uses the queue adapter; producers do not enqueue and acknowledge independently.

## Reliability changes

| Failure scenario found in the review | Implemented behavior |
| --- | --- |
| A retained BullMQ job has `jobId = notificationId`; replay is silently deduplicated against that old job. | Use the immutable outbox row ID as the job ID. Retry and replay replace the schedule with a new row and a new ID. Re-dispatch of that same schedule reuses its ID. |
| A worker schedules its retry before the original enqueue returns; acknowledgement by `notificationId` deletes the new retry. | Acknowledge only the exact dispatched row ID. A stale acknowledgement or failure update cannot mutate its replacement. |
| Several replicas dispatch the same row or a row disappears during a sweep. | Queue deduplication handles simultaneous dispatch of one schedule; conditional `deleteMany`/`updateMany` tolerate already removed rows. One failed entry does not abort the batch. |
| An old job executes before a newly scheduled retry is due. | Check `nextRetryAt` before provider work and in the atomic claim. Claim also matches the observed status, retry count, and modification time. Dispatch failure backoff never advances an existing retry deadline. |
| Two channels finish together, each observing the other as unfinished. | Result and manual retry/replay transactions lock the parent event first. Explicit `READ COMMITTED` transactions serialize aggregate updates for that event. |
| Partial queue failure overwrites an event status after some workers have already finished. | Dispatch reports confirmed and pending counts without writing event status. The event aggregate depends on notifications, not Redis availability. |
| A successful provider call is followed by a database error, which is caught as a delivery failure. | Provider errors and persistence errors have separate paths. Persistence failure propagates to the worker and does not automatically schedule another provider call. |
| A slow sweep overlaps every timer tick. | Coalesce sweeps within a process, sweep once at startup, clear the timer and await the current sweep at shutdown. |

No database schema migration is needed: existing `DeliveryOutbox.id` supplies the schedule identity. Replacing a schedule uses delete + create inside the notification transaction, so rollback preserves the old row. Callers must serialize transitions before replacement; delivery and manual retry/replay use the parent event lock. Ingest creates a new event and its notifications in one transaction.

The event lock is acquired before notification result updates, logs, and outbox replacement. HTTP calls and Redis calls never run under this lock. Different events remain independent. BullMQ documents deduplication by retained job ID in [Job IDs](https://docs.bullmq.io/guide/jobs/job-ids); PostgreSQL describes transaction-scoped row locks in [Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html).

## Delivery contract and remaining limits

A committed notification always has a committed initial schedule. Queue publication can be retried; acknowledgement confirms publication, not provider delivery. `notificationsQueued` counts confirmed dispatches in that response, while `notificationsQueuePending` counts unconfirmed dispatches. An unconfirmed dispatch may already exist in Redis if PostgreSQL acknowledgement failed.

This provides durable scheduling across enqueue failures. It does not provide exactly-once external effects or unconditional eventual delivery. Consumers should deduplicate by `notificationId`, which stays stable across retries and replay.

The following work remains, in priority order:

| Priority | Evidence and impact | Next change and acceptance criterion |
| --- | --- | --- |
| P0 before unattended production delivery | A process crash after claiming `PROCESSING`, or a failure to persist the provider result, leaves an ambiguous delivery. A resumed BullMQ job currently skips `PROCESSING`. | Add an expiring delivery lease and attempt fencing, recovery sweep, and provider idempotency contract. Prove recovery with process termination tests before/after provider acknowledgement, including a late response from the original worker. Do not blindly reset all `PROCESSING` rows. |
| P0 for real provider rollout | Email/SMS without an HTTP provider and Telegram without a usable token record mock success, including in production. | Make mock delivery an explicit development option; validate provider configuration at channel creation. Prove production cannot report `SENT` for an unconfigured provider. |
| P1 | Published outbox rows are removed, so Redis data loss after acknowledgement is outside recovery coverage. | Define Redis durability and recovery objectives; reconcile overdue database notifications with queue state, coordinated with delivery leases. Test restart from empty Redis. |
| P1 | Rate limiting uses separate `INCR` and `EXPIRE`; the shared Redis client retries indefinitely. Health probes now bound responses and coalesce pending operations, but shared driver commands still need bounded transport policies. | Use an atomic counter/expiry operation, bounded ingest request deadlines, and separate HTTP/worker Redis connection policies. Fault-injection tests must terminate requests and probes within a documented timeout. |
| P1 | Project ownership protects tenant access, but `VIEWER` is not a write restriction on project resources. Managed/legacy API-key verification does not check the owner's active flag. | Define and enforce the access matrix and account-deactivation policy for both JWT and API-key paths. Add HTTP tests for cross-project access, role restrictions, and deactivation. |
| P1 | Reusing an ingest idempotency key with a different payload returns the first event. Audit writes are best effort. | Define payload-conflict behavior (for example HTTP 409), audit durability requirements, and retention. Test simultaneous duplicate requests with equal and conflicting payloads. |
| P1 | Workers use the current channel configuration; channel deletion cascades into historical notifications/logs without refreshing event status. | Define whether delivery uses a configuration snapshot; prefer archival semantics when history must remain inspectable. Test channel changes/deletion with queued deliveries. |
| P2 | API and worker processes scale together; probes only report dependency reachability. | Add queue/outbox age, delivery latency, stuck-processing and retry metrics first. Split worker bootstrap when measurements justify independent scaling. Add composite query indexes using production query plans. |

These are explicit follow-up design items; this change does not silently choose product policies for them.

## Verification

Unit regressions cover dispatch acknowledgement races, partial publication, delayed retry deadlines, concurrent sweep coalescing, atomic claims, event state reduction, and separation of provider/persistence errors.

Integration tests use real PostgreSQL and Redis to cover retained-job replay, concurrent dispatch deduplication, stale acknowledgement, enqueue recovery, transaction rollback, duplicate worker claims, and parallel channel completion. They test service and persistence boundaries; HTTP authorization and process-kill recovery require additional suites.

Run the regular quality gate:

```bash
npm ci
npm run ci:verify
```

Run integration tests against isolated, ephemeral infrastructure:

```bash
docker compose -p notification-hub-architecture-test -f docker-compose.test.yml up -d --wait
export TEST_DATABASE_URL=postgresql://notification_test:notification_test@127.0.0.1:15433/notification_hub_test
export TEST_REDIS_URL=redis://127.0.0.1:16380
DATABASE_URL="$TEST_DATABASE_URL" npm run prisma:deploy
npm run test:integration
docker compose -p notification-hub-architecture-test -f docker-compose.test.yml down
```

`TEST_POSTGRES_PORT` and `TEST_REDIS_PORT` can override the Compose ports; update test URLs accordingly. The suite requires explicit test URLs and never falls back to application credentials. It creates unique fixture users and queue names and removes only those fixtures. Migrations belong in a disposable test database. CI runs these tests in a separate job with PostgreSQL 16 and Redis 7 services.

## Rollout

Drain/stop old application instances before starting the new delivery implementation: an old dispatcher still acknowledges by notification ID and could delete a new schedule. Do not mix old and new dispatchers during a rolling update. Existing queue jobs remain readable because their payload is still `{ notificationId }`; pending outbox rows acquire their job identity from their existing row ID. No production infrastructure is modified by the test workflow.
