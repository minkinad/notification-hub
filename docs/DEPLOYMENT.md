# Deployment guide

Notification Hub runs an HTTP API, BullMQ workers and the outbox dispatcher in one NestJS process. PostgreSQL and Redis are external stateful dependencies. Read the [production limits](../README.md#production-readiness-and-limits) before enabling live delivery.

## Runtime configuration

Use Node.js 22 or the checked-in Docker image. Supply secrets through your deployment platform; `.env` is a local convenience, not a secret distribution mechanism.

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@DATABASE_HOST:5432/notification_hub
REDIS_URL=redis://REDIS_HOST:6379
JWT_SECRET=REPLACE_WITH_A_SEPARATE_RANDOM_VALUE_OF_AT_LEAST_32_CHARACTERS
CHANNEL_CONFIG_ENCRYPTION_KEY=REPLACE_WITH_ANOTHER_RANDOM_VALUE_OF_AT_LEAST_32_CHARACTERS
CORS_ORIGIN=https://your-dashboard.example.com
HEALTH_CHECK_TIMEOUT_MS=2000
DELIVERY_HTTP_BLOCK_PRIVATE_NETWORKS=true
DELIVERY_HTTP_TIMEOUT_MS=5000
DELIVERY_HTTP_MAX_RESPONSE_BYTES=32768
DELIVERY_OUTBOX_INTERVAL_MS=30000
```

Replace every placeholder. Container connection addresses must be reachable from the container; `localhost` refers to that container. Configure PostgreSQL connection/pool and server-side statement limits for your environment. Health response deadlines do not cancel underlying driver calls.

`REDIS_URL` takes precedence over `REDIS_HOST`/`REDIS_PORT`. Current validation accepts `redis://`, not `rediss://`; direct Redis TLS requires a deliberate configuration/code change. Protect both stateful services with network controls and authentication. Keep encryption keys stable and backed up: rotating the channel key without re-encryption makes existing secret values unreadable.

The [README configuration table](../README.md#configuration) lists all options and defaults. In the example Compose stack, environment values are explicitly passed to `api`; adding a variable to `.env` alone does not automatically pass an unlisted variable into that container.

## Build and migrations

The runtime image uses a non-root `node` user. Prisma migration tooling is available in the builder image; run migrations as a separate deployment step.

```bash
docker build --target builder -t notification-hub-migrations:local .
docker build --target runner -t notification-hub:local .
```

After provisioning a protected database and creating a runtime environment file or equivalent secret injection:

```bash
docker run --rm --env-file /path/to/production.env \
  notification-hub-migrations:local npm run prisma:deploy
```

Use release-specific image tags/digests in your deployment system. Apply committed migrations once before starting new instances, inspect the result, and back up data before schema changes. Do not use `prisma migrate dev`, `db push`, database reset or `seed` in production.

An example local host binding behind a reverse proxy:

```bash
docker run -d --name notification-hub --restart unless-stopped \
  --env-file /path/to/production.env \
  -p 127.0.0.1:3000:3000 notification-hub:local
```

Terminate TLS and configure request limits at the edge. Restrict `/docs` and `/auth/register` there when they should not be publicly available; the application currently exposes them. CORS does not replace authentication or network policy.

## Example Compose stack

```bash
cp .env.example .env
# Replace both secret placeholders.
docker compose up --build
```

The `migrate` service completes before the API starts. This is an example/local stack with fixed development database credentials, published PostgreSQL/Redis ports and persistent named volumes. Adapt secrets, networks, backup and Redis persistence before treating it as a production topology. Do not run the development seed against live data.

## Health probes

| Route | Success | Failure | Dependency work |
| --- | --- | --- | --- |
| `GET /api/v1/health/live` | `200` | Process cannot answer | None |
| `GET /api/v1/health/ready` | `200` | `503` | PostgreSQL `SELECT 1` and Redis `PING` |
| `GET /api/v1/health` | `200`, `data.status=ok` | `200`, `data.status=degraded` | Same checks as readiness |

All three routes set `Cache-Control: no-store` and bypass general HTTP throttling. Readiness becomes degraded once the health shutdown hook runs, including for requests whose probes were already pending. Healthy responses use the normal API envelope; production readiness errors use the standard error envelope with `message: "Service is not ready"`.

The diagnostic route exposes only safe per-dependency status/reasons. `timeout` means the configured response deadline elapsed, `unavailable` means the check failed or returned an invalid reply, and `shutting_down` means shutdown has begun. No raw driver errors or credentials are returned.

`HEALTH_CHECK_TIMEOUT_MS` defaults to 2000 ms, with checks running concurrently. Pending driver operations are reused until they settle, even after a response deadline. Configure the platform timeout above this budget. Liveness must not depend on PostgreSQL/Redis availability after startup: dependency failures should remove readiness rather than cause a restart loop. See the [Kubernetes probe documentation](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) for platform semantics.

Example container probe fragment for the default two-second budget:

```yaml
ports:
  - name: http
    containerPort: 3000
startupProbe:
  httpGet:
    path: /api/v1/health/live
    port: http
  periodSeconds: 5
  timeoutSeconds: 5
  failureThreshold: 30
livenessProbe:
  httpGet:
    path: /api/v1/health/live
    port: http
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
readinessProbe:
  httpGet:
    path: /api/v1/health/ready
    port: http
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

This is a container fragment, not a complete Kubernetes deployment. Tune startup and termination budgets from observed initialization and delivery times. The application connects dependencies before it starts listening; startup failure is still possible when dependencies are absent. Once running, readiness demonstrates dependency connectivity, not queue progress, provider health, schema compatibility or completion of every notification.

## Scaling and rollout

Every API replica processes queue jobs and runs an outbox sweep. Within a process, overlapping sweeps are coalesced; across replicas, immutable schedule IDs and conditional acknowledgements protect publication. Provider calls occur outside event-result transactions. Set replica counts and database connection budgets together; worker-only deployment is not implemented.

When upgrading from outbox acknowledgement by notification ID, **drain/stop old instances before starting new ones**. An old dispatcher can delete a newer retry schedule. Existing job payloads remain `{ notificationId }`, and existing outbox row IDs are usable by the new dispatcher. No schema migration is added by this change, but a mixed-version rolling rollout is unsafe for this transition.

The process has Nest shutdown hooks. Allow time for in-flight delivery and outbox work when stopping it; a forced termination can leave ambiguous `PROCESSING` notifications. The health hook signals unready but is not a full traffic-draining protocol. Coordinate edge draining and worker shutdown at the platform level.

For rollback, preserve database/Redis data and verify old-code compatibility with all applied migrations and queue semantics first. Do not assume that reverting the image reverses a migration or that old dispatchers can run beside new ones. Never reset the database or flush Redis as a rollback shortcut.

## Monitoring and recovery

Collect and alert on dependency readiness, outbox age/count, notification age by status, queue backlog/failures, retries, provider errors and database connection pressure. These metrics and dashboards are not yet built into the service; implement them in your observability stack. Use notification/event IDs for correlation and avoid exporting secrets or sensitive payloads.

| Situation | Operational response |
| --- | --- |
| Readiness `503` | Inspect safe `/health` reasons; check connectivity and dependency logs. A green liveness endpoint is expected during dependency failure. |
| Unconfirmed outbox entries after queue outage | Restore queue connectivity; the startup/periodic sweep retries publication. Check that outbox age falls after recovery. |
| `PROCESSING` remains overdue | Investigate worker/provider evidence. There is no automatic lease recovery, and the retry API rejects `PROCESSING`. Do not blindly reset rows: provider acceptance may already have occurred. |
| Terminal `FAILED` notifications | Inspect delivery logs and provider configuration, then use the authenticated `POST /notifications/:id/replay` endpoint when a new delivery cycle is intended. |
| Redis loses acknowledged jobs | Restore durable Redis data or perform a reviewed reconciliation with database/provider evidence. The outbox does not reconstruct all acknowledged jobs. |
| Encryption key loss/change | Recover the correct key from backup. There is no automatic key rotation or re-encryption command. |

Back up PostgreSQL and the channel encryption key, configure Redis persistence according to recovery objectives, and test restores. Provider-side idempotency by `notificationId` is necessary to make repeated delivery effects manageable. Review the [architecture priorities](ARCHITECTURE.md#delivery-contract-and-remaining-limits) before unattended production use.

## Release verification

Run `npm run ci:verify`, delivery integration tests on disposable infrastructure, and a Docker build when packaging changes. CI defines these checks in `.github/workflows/ci.yml`. Run a real provider smoke test in a controlled environment before production traffic; mock success does not verify an external integration.
