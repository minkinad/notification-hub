# Contributing

## Local workflow

Use Node.js 22 and `npm ci`. Copy `.env.example` to `.env`, replace both secret placeholders, and start PostgreSQL/Redis with `npm run dev:infra`. Run `npm run prisma:generate`, `npm run prisma:deploy`, then `npm run start:dev`. Development infrastructure is stopped with `npm run dev:infra:down`.

Do not commit `.env`, credentials, database exports, provider responses containing personal data, generated Prisma client files, `dist`, or `node_modules`. Seed data is for disposable development databases only.

Read [AGENTS.md](AGENTS.md) before changing delivery, authorization, health checks or migrations. The [architecture review](docs/ARCHITECTURE.md) records current invariants and outstanding limitations.

## Validation

Run the checks relevant to the change, then `npm run ci:verify` before preparing a code change for review. This gate includes schema validation/client generation, formatting, lint, unit tests, health HTTP tests and the build.

Delivery state, outbox, locking, queue identity or migration changes also require `npm run test:integration` against isolated PostgreSQL and Redis. Setup commands are in [README.md](README.md#verification-and-contribution). Never point tests or `prisma migrate dev` at production.

Use regression tests that reproduce the failure behavior. Concurrency and transaction guarantees need real database/queue evidence, not only mocked method-call assertions. Distinguish HTTP tests with substituted dependencies from infrastructure integration tests and process-crash tests.

New environment variables must be validated and documented in `.env.example`, README and the deployment guide. Update Compose pass-through if the variable is meant to be configurable in that deployment. New schema changes require a new migration; preserve applied migration history.

## Commits and pull requests

Use Conventional Commit prefixes with a useful scope: `fix(delivery)`, `fix(health)`, `feat(channels)`, `test(delivery)`, `ci`, `docs`, `refactor`, or `chore`. Write an imperative subject describing the behavior. Keep each commit focused and include the regression tests for its behavior. Separate infrastructure/CI and documentation changes when they are independently reviewable.

A pull request should state the problem, resulting behavior, validation performed, and material compatibility or rollout constraints. Do not claim production readiness, exactly-once delivery, test coverage or external validation that has not been demonstrated. Link the relevant architecture decision when changing an invariant.

Report security vulnerabilities using [SECURITY.md](SECURITY.md), not a public issue containing exploit details or secrets.
