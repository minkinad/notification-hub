import { Prisma } from '@prisma/client';

// Serialize state transitions within an event before locking notifications.
// Under READ COMMITTED, the aggregate queries then see preceding commits.
// Never hold this lock while making a provider or Redis request.
export async function lockDeliveryEvent(
  tx: Prisma.TransactionClient,
  eventId: string,
) {
  await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
}
