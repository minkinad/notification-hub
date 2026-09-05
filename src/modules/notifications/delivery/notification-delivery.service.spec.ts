import {
  ChannelType,
  DeliveryStatus,
  EventStatus,
  NotificationStatus,
} from '@prisma/client';
import { NotificationDeliveryService } from './notification-delivery.service';

function notification(overrides = {}) {
  return {
    id: 'notification-1',
    projectId: 'project-1',
    eventId: 'event-1',
    status: NotificationStatus.PENDING,
    retryCount: 0,
    maxRetries: 3,
    recipient: 'alerts@example.com',
    subject: 'Invoice',
    template: 'invoice.created',
    templateData: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    nextRetryAt: null,
    channel: { type: ChannelType.EMAIL, config: { to: 'alerts@example.com' } },
    event: { id: 'event-1' },
    ...overrides,
  };
}

describe('NotificationDeliveryService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    notification: { update: jest.fn(), count: jest.fn() },
    deliveryLog: { create: jest.fn() },
    event: { update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
    notification: { findUnique: jest.fn(), updateMany: jest.fn() },
  };
  const outbox = { schedule: jest.fn(), dispatch: jest.fn() };
  const config = {
    get: (_key: string, fallback: unknown) => fallback,
    getOrThrow: () => 'unit-test-channel-config-key-with-32-characters',
  };
  let service: NotificationDeliveryService;

  beforeEach(() => {
    jest.resetAllMocks();
    tx.notification.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation((callback: any) =>
      Promise.resolve(callback(tx)),
    );
    prisma.notification.findUnique.mockResolvedValue(notification());
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    outbox.schedule.mockResolvedValue({ id: 'retry-schedule' });
    outbox.dispatch.mockResolvedValue({ queued: 1, pending: 0 });
    service = new NotificationDeliveryService(
      prisma as any,
      outbox as any,
      config as any,
    );
  });

  it('commits delivery and event status under the event lock', async () => {
    await expect(service.deliver('notification-1')).resolves.toEqual({
      delivered: true,
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.notification.update.mock.invocationCallOrder[0],
    );
    expect(tx.notification.update).toHaveBeenCalledWith({
      where: { id: 'notification-1' },
      data: expect.objectContaining({ status: NotificationStatus.SENT }),
    });
    expect(tx.deliveryLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: DeliveryStatus.SUCCESS }),
    });
    expect(tx.event.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { status: EventStatus.COMPLETED },
    });
  });

  it('keeps failed automatic retries in the outbox when queueing fails', async () => {
    prisma.notification.findUnique.mockResolvedValue(
      notification({
        channel: { type: ChannelType.WEBHOOK, config: { url: 'not-a-url' } },
      }),
    );
    outbox.dispatch.mockResolvedValue({ queued: 0, pending: 1 });
    await expect(service.deliver('notification-1')).resolves.toMatchObject({
      delivered: false,
      retryScheduled: true,
      queuePending: true,
    });
    expect(outbox.schedule).toHaveBeenCalledWith(
      tx,
      'notification-1',
      expect.any(Date),
    );
    expect(outbox.dispatch).toHaveBeenCalledWith([{ id: 'retry-schedule' }]);
  });

  it('does not deliver an old job before a scheduled retry is due', async () => {
    prisma.notification.findUnique.mockResolvedValue(
      notification({
        status: NotificationStatus.RETRYING,
        nextRetryAt: new Date(Date.now() + 60000),
      }),
    );
    await expect(service.deliver('notification-1')).resolves.toEqual({
      skipped: true,
      reason: 'retry_not_due',
    });
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it('claims only the snapshot it read and rechecks retry time atomically', async () => {
    const snapshot = notification();
    prisma.notification.findUnique.mockResolvedValue(snapshot);
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.deliver('notification-1')).resolves.toEqual({
      skipped: true,
      reason: 'not_claimed',
    });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: snapshot.id,
          status: snapshot.status,
          retryCount: snapshot.retryCount,
          updatedAt: snapshot.updatedAt,
          OR: [
            { nextRetryAt: null },
            { nextRetryAt: { lte: expect.any(Date) } },
          ],
        },
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not turn a database failure after provider success into an automatic resend', async () => {
    prisma.$transaction.mockRejectedValue(new Error('Database unavailable'));
    await expect(service.deliver('notification-1')).rejects.toThrow(
      'Database unavailable',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(outbox.schedule).not.toHaveBeenCalled();
    expect(outbox.dispatch).not.toHaveBeenCalled();
  });

  it('marks the event failed only when all channels are terminal', async () => {
    tx.notification.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await service.deliver('notification-1');
    expect(tx.event.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { status: EventStatus.FAILED },
    });
  });

  it('keeps the event processing while another channel is open', async () => {
    tx.notification.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    await service.deliver('notification-1');
    expect(tx.event.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { status: EventStatus.PROCESSING },
    });
  });

  it('exhausts the retry budget without creating another schedule', async () => {
    prisma.notification.findUnique.mockResolvedValue(
      notification({
        retryCount: 3,
        channel: { type: ChannelType.WEBHOOK, config: {} },
      }),
    );
    await expect(service.deliver('notification-1')).resolves.toMatchObject({
      delivered: false,
      retryScheduled: false,
    });
    expect(outbox.schedule).not.toHaveBeenCalled();
    expect(tx.notification.update).toHaveBeenCalledWith({
      where: { id: 'notification-1' },
      data: expect.objectContaining({ status: NotificationStatus.FAILED }),
    });
  });
});
