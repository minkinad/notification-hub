ALTER TABLE "events" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "events_projectId_idempotencyKey_key"
ON "events"("projectId", "idempotencyKey");
