# Engineering instructions for Notification Hub

These instructions apply to the whole repository unless a more specific `AGENTS.md` applies. Follow explicit user instructions and higher-priority environment instructions first. This file describes the current implementation; update it when the architecture, commands or verification contract changes.

## Purpose and working approach

Notification Hub accepts project-scoped events, creates notification intents, and schedules provider delivery. Correctness under retries, concurrency and dependency failures matters more than adding abstractions or claiming broad production readiness.

Before editing:

1. Read `git status --short` and identify existing work. Preserve unrelated changes and do not reset, clean or overwrite them.
2. Read the affected module, its DTOs, tests and module wiring. Inspect callers before changing a service signature.
3. For delivery work, read `docs/ARCHITECTURE.md`. For public behavior, also read `docs/INTEGRATION.md`; for runtime changes, read `docs/DEPLOYMENT.md`.
4. Identify the failure being fixed and the observable behavior that will demonstrate it. Prefer a bounded, coherent change over unrelated cleanup.
5. Work within the user's authorized scope. Reversible local edits and verification do not require repeated confirmation. Do not deploy, publish, push or contact others unless that action is authorized.

Use `rg`/`rg --files` for repository searches. Keep tool output focused and communicate meaningful findings, changes of direction and verification results. Do not expose secrets while inspecting environment or connection settings. Do not introduce sub-agent work unless requested by the user or required by higher-priority instructions.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/main.ts` | HTTP bootstrap, URI versioning, validation, response/error handling, CORS, Swagger, shutdown hooks |
| `src/app.module.ts` | Root module composition and global HTTP throttling |
| `src/modules/auth`, `src/modules/users` | Registration/login, JWT identity, profile and admin user listing |
| `src/modules/projects` | Project ownership, legacy and managed API-key lifecycle |
| `src/modules/channels` | Per-project channel validation, encrypted configuration and redaction |
| `src/modules/events` | Authenticated/API-key ingest, idempotency, transactional fan-out |
| `src/modules/notifications` | Notification queries, retry/replay API and delivery orchestration |
| `src/modules/notifications/delivery` | Outbox scheduling/dispatch, queue adapter, worker, provider calls, event lock |
| `src/modules/health` | Liveness, bounded readiness and safe dependency diagnostics |
| `src/common` | Prisma, Redis, rate limits, guards, HTTP safety, JSON/secrets helpers, audit |
| `prisma/schema.prisma`, `prisma/migrations` | Persistence model and ordered migration history |
| `prisma/seed.ts` | Optional fixtures with known development credentials |
| `src/**/*.spec.ts` | Unit regressions |
| `test/health.e2e-spec.ts` | Real HTTP health contract with substituted dependencies |
| `test/delivery.integration-spec.ts` | Delivery tests using actual PostgreSQL and Redis |
| `.github/workflows/ci.yml` | Quality, HTTP tests, delivery integration, coverage, dependency review and Docker build |
| `docker-compose*.yml` | Example application stack, local infrastructure and disposable test infrastructure |

## Runtime and commands

Use Node.js 22 to match the Docker image. CI also runs the quality job on Node.js 20. npm and `package-lock.json` are the package-management contract; use `npm ci` for reproducible installs. Do not replace the package manager or regenerate dependency versions as incidental cleanup.

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | Nest development server with watch |
| `npm run dev:infra` / `npm run dev:infra:down` | Start/stop local PostgreSQL and Redis |
| `npm run prisma:generate` | Generate the Prisma client from the schema |
| `npm run prisma:validate` | Validate the schema without requiring a running database |
| `npm run prisma:deploy` | Apply committed migrations to the explicitly configured database |
| `npm run prisma:migrate` | Develop a new migration against a local/disposable database |
| `npm run format:check` / `npm run format` | Check/write the repository's configured source formatting |
| `npm run lint` | ESLint with TypeScript checks |
| `npm test` | Unit suite, serial execution |
| `npm run test:e2e` | Health HTTP contract; no external infrastructure required |
| `npm run test:integration` | Delivery integration; requires explicit test database/Redis URLs |
| `npm run ci:verify` | Prisma validation/generation, format, lint, unit, HTTP tests and build |
| `npm run build` | Clean and compile the application |

Use `.env.example` as a template and replace both secret placeholders. Do not print or commit real `.env` contents. `seed` creates known credentials; never run it against production or treat it as secure account provisioning.

## Module and TypeScript conventions

- Keep controllers focused on HTTP mapping and delegate business rules to services. Validate request bodies and query parameters through DTOs, `class-validator` and the global validation pipe.
- Follow existing Nest dependency injection and module imports/exports. Use mandatory dependencies for guarantees such as outbox scheduling and ingest rate limiting. Do not use `@Optional()` to make an incorrectly wired application appear healthy.
- Use the existing `@common` and `@modules` aliases. Keep types precise in production code; use `unknown` and the JSON helpers when parsing external values. Do not add `any` or lint suppressions to bypass type errors.
- Reuse Prisma enums and JSON types, existing pagination helpers, secret helpers and the safe HTTP client. Avoid parallel implementations of the same policy.
- Keep network operations outside database transactions. Use bounded transactions and a consistent lock order. Add an abstraction only when it owns a real invariant or removes meaningful duplication.
- Do not manually edit generated Prisma clients, build output or dependency files. Schema changes go through a new migration and client generation.

## Delivery invariants

These rules are part of the correctness contract. Changes need regression evidence and updated documentation.

1. **PostgreSQL owns durable intent.** Event creation, notification creation and initial scheduling commit together. Retry/replay status changes and replacement schedules also commit together. A Redis outage must not remove committed delivery intent.
2. **Only the outbox dispatcher publishes application delivery jobs.** Event, notification and delivery services call `schedule(tx, ...)` and dispatch the returned entries after commit. Do not restore direct enqueue + independent acknowledgement paths.
3. **Schedule identity is immutable.** `DeliveryOutbox.id` is the BullMQ `jobId`. Re-publishing a schedule reuses its ID; a new retry/replay creates a new row/ID. Do not use the notification ID as the sole queue identity: retained jobs would suppress future replays.
4. **Acknowledge the exact row.** Delete/update the dispatched row by its ID, never acknowledge by `notificationId`. An old worker/dispatcher may complete after a new retry has already been scheduled. Conditional updates must tolerate deletion/replacement by another replica.
5. **Replacement is transactional.** Outbox delete + create must run inside the caller's transaction after the notification transition is serialized. Do not independently remove the old schedule before a commit boundary.
6. **Do not advance retry deadlines.** Both the pre-check and atomic worker claim enforce `nextRetryAt`. Queue publication backoff must not turn a future retry into an immediate one.
7. **Claim observed state atomically.** Match notification status, retry count, modification time and due time. A stale job must not unconditionally write `PROCESSING` or perform provider work after losing the claim.
8. **Lock the parent event before result transitions.** Use `lockDeliveryEvent` before notification result writes, manual retry/replay transitions, logs and replacement schedules. These transactions explicitly use `READ COMMITTED`. Different events can progress independently; do not hold the lock across HTTP or Redis calls.
9. **Event state follows notification state.** Open notifications imply `PROCESSING`; all terminal notifications imply `FAILED` if any failed, otherwise `COMPLETED`. Queue publication failures must not overwrite a concurrently completed event. Events created without channels remain `PENDING` with no automatic later fan-out.
10. **Separate provider failure from persistence failure.** A provider success followed by a database error is an ambiguous delivery; do not catch it as a provider failure and schedule an automatic duplicate. Surface the error to the worker and preserve diagnostic evidence.
11. **Keep recovery bounded.** Coalesce sweeps within a process, tolerate concurrent replicas and per-entry failures, and stop timers during shutdown. Queue publication confirmation does not prove provider delivery.
12. **Preserve the external idempotency key.** Provider payload `notificationId` remains stable across retries and replay even though schedule/job identity changes.

Do not silently introduce exactly-once claims, lease recovery, bulk state resets or provider idempotency assumptions. The current implementation cannot automatically recover every abandoned `PROCESSING` notification or every job lost with Redis. A safe recovery design needs expiring claims, attempt fencing, provider semantics and process-kill tests.

## Authorization, data and security

- Every resource read/write must preserve project ownership or an explicitly defined administrative policy. Do not rely on a caller-supplied project ID without validating ownership.
- Managed API keys need active/expiration/project checks and the appropriate scope. Keep raw keys out of storage, logs, error messages and read responses; only creation/regeneration may reveal a key once.
- Use existing encryption/redaction helpers for channel configuration. Do not rotate the encryption key without a data re-encryption plan. Avoid leaking secrets through URLs, provider bodies, delivery errors, audit fields or health output.
- Use `safePostJson` for provider HTTP. Preserve destination validation, validated-DNS pinning, redirect blocking, response-size limits and header sanitization. Do not replace it with unrestricted `fetch`.
- Keep public API failures stable. Unexpected internal exceptions must not expose driver errors or stack traces. Preserve the application's response envelope and URI versioning unless an API change is explicitly intended.
- Verify product policy before treating `VIEWER`, inactive account behavior, changed idempotency payloads or channel deletion as already enforced. Their current limitations are documented in `docs/ARCHITECTURE.md`.
- Audit logging is currently best effort. Do not describe it as a transactional compliance ledger. Channel deletion currently cascades into historical notifications/logs; account for this when changing lifecycle semantics.

## Health contract

- `/api/v1/health/live` performs no dependency I/O and remains a process-liveness check.
- `/api/v1/health/ready` returns `200` only when dependencies respond and shutdown has not begun; failure, timeout or shutdown returns `503`.
- `/api/v1/health` retains its diagnostic `200` contract with `data.status: ok/degraded`. Do not make an orchestrator infer readiness from this route's HTTP status.
- Preserve `Cache-Control: no-store` and exemption from the general request throttle. Health requests must not trigger restarts simply because user traffic exhausts an IP limit.
- `HEALTH_CHECK_TIMEOUT_MS` bounds each response; checks run concurrently. Reuse pending driver operations until they settle. A `Promise.race` timeout does not cancel Prisma or Redis work.
- Return only safe reason codes (`unavailable`, `timeout`, `shutting_down`). Do not include connection URLs, passwords or raw exception messages.
- A healthy dependency probe does not prove queue progress, provider delivery, migration compatibility or freedom from stuck notifications. Monitor delivery separately.

## Database, configuration and infrastructure changes

Add a new migration for schema changes. Never rewrite applied migration history, reset a non-disposable database or run `prisma migrate dev` against production. Review cascades, tenant constraints, indexes, data backfills and compatibility before changing relations. Validate a new migration from an empty test database and consider upgrade behavior from existing data.

For a new runtime option, update validation/defaults, `.env.example`, relevant tests, README and deployment documentation. If Compose uses an explicit `environment` list, pass the option through there as appropriate. Do not document unsupported behavior: for example, validation currently accepts `redis://` but not `rediss://`.

Use the dedicated Compose test project and `TEST_DATABASE_URL`/`TEST_REDIS_URL` for integration work. Tests must not fall back to production application credentials. Clean up only fixtures, containers and queues created for the task; never flush shared Redis or stop unrelated stacks. The setup and cleanup commands are in README.

The production image runs as `node` and does not contain development tooling for migrations. Use the builder/migration image or a separate migration job. The default Compose stack is an example with development credentials and exposed dependency ports, not a hardened production topology.

When upgrading from outbox acknowledgement by notification ID, stop/drain old instances before starting new ones. Mixed dispatchers can delete newer schedules. Do not imply that a normal mixed-version rolling deployment is safe for this transition.

## Verification requirements

Match verification to behavior:

| Change | Required evidence |
| --- | --- |
| Service/DTO/authorization change | Relevant unit regression; HTTP coverage when the HTTP contract changes |
| Health or response/filter/throttling change | Health unit and `test:e2e` checks, including failure/timeout and secret-redaction behavior |
| Delivery/outbox/claim/transaction change | Relevant unit regressions and real PostgreSQL/Redis integration suite |
| Migration | Schema validation/client generation; migration application in isolated infrastructure; relevant persistence tests |
| Docker/runtime packaging | Build and appropriate startup/probe smoke check when packaging behavior changes |
| Documentation-only change | Check commands, paths, anchors, configuration defaults and claims against source; no artificial implementation-mirroring tests |

Run `npm run ci:verify` for code changes before finalizing. Do not disable checks, add `--passWithNoTests`, delete meaningful regressions or relax TypeScript/lint rules to make a change pass. Once relevant checks pass, rerun them only for subsequent changes or unresolved concerns.

Test names should describe the behavior being protected. Prefer deterministic interleavings for races and controlled timers for deadlines. Unit mocks do not establish real database lock or queue deduplication guarantees. Report infrastructure limitations explicitly if a required check cannot run; never imply a skipped check passed.

## Documentation and delivery of work

Keep README focused on setup, API entry points, operational contracts and current limits. Keep detailed design in `docs/ARCHITECTURE.md`, runtime procedures in `docs/DEPLOYMENT.md`, and client semantics in `docs/INTEGRATION.md`. Update `CHANGELOG.md` under Unreleased for user-visible behavior. Avoid invented support contacts, release guarantees, coverage percentages or availability promises.

Use Conventional Commits when commits are requested or otherwise authorized:

- `fix(delivery): ...` for queue, retry, claim and result-correctness fixes.
- `fix(health): ...` for probe correctness and safe failure behavior.
- `test(delivery): ...` or `test(health): ...` for independent regression infrastructure.
- `ci: ...` for automated verification wiring.
- `docs: ...` for README, architecture, operations and contributor instructions.
- `feat`, `refactor`, or `chore` only when they accurately describe the change.

Stage explicit paths or hunks; review the staged diff before each commit. Keep behavior and its unit tests together. Split unrelated behavior, test infrastructure and documentation into reviewable commits. Do not amend existing commits, create releases or push without authorization. Check `git status --short` after committing and account for any remaining changes.

The final report should state what changed, why it matters, what was tested, material limitations and commit hashes when created. Respond in the user's language; source documentation and commit subjects in this repository use English.
