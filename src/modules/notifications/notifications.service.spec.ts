import { BadRequestException, ConflictException } from '@nestjs/common';
import { NotificationStatus } from '@prisma/client';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    notification: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    deliveryOutbox: {
      upsert: jest.fn(),
    },
    event: {
      update: jest.fn(),
    },
  } as any;

  const outboxService = {
    schedule: jest.fn(),
    dispatch: jest.fn(),
  };

  let service: NotificationsService;

  beforeEach(() => {
    jest.resetAllMocks();
    outboxService.schedule.mockResolvedValue({ id: 'schedule-1' });
    outboxService.dispatch.mockResolvedValue({ queued: 1, pending: 0 });
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((callback: any) =>
      Promise.resolve(callback(prisma)),
    );
    service = new NotificationsService(prisma, outboxService as any);
  });

  it('rejects retry for delivered notifications', async () => {
    prisma.notification.findFirst.mockResolvedValue({
      id: 'notification-1',
      status: NotificationStatus.SENT,
    });

    await expect(
      service.retry('notification-1', 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('schedules retry through the delivery queue', async () => {
    prisma.notification.findFirst.mockResolvedValue({
      id: 'notification-1',
      projectId: 'project-1',
      eventId: 'event-1',
      status: NotificationStatus.FAILED,
      retryCount: 0,
      maxRetries: 3,
      channel: {
        id: 'channel-1',
        type: 'WEBHOOK',
        name: 'Webhook',
      },
      event: {
        id: 'event-1',
        type: 'invoice.created',
        status: 'FAILED',
      },
      deliveryLogs: [],
    });
    prisma.notification.findUnique.mockResolvedValue({
      id: 'notification-1',
      projectId: 'project-1',
      status: NotificationStatus.RETRYING,
      retryCount: 1,
      maxRetries: 3,
      nextRetryAt: new Date(),
      channel: {
        id: 'channel-1',
        type: 'WEBHOOK',
        name: 'Webhook',
      },
      event: {
        id: 'event-1',
        type: 'invoice.created',
        status: 'FAILED',
      },
    });

    const result = await service.retry('notification-1', 'user-1');

    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'notification-1',
          status: NotificationStatus.FAILED,
          retryCount: 0,
        },
        data: expect.objectContaining({
          status: NotificationStatus.RETRYING,
          retryCount: {
            increment: 1,
          },
        }),
      }),
    );
    expect(outboxService.dispatch).toHaveBeenCalledWith([{ id: 'schedule-1' }]);
    expect(result.status).toBe(NotificationStatus.RETRYING);
  });

  it('keeps a durable outbox entry when retry queueing fails', async () => {
    prisma.notification.findFirst.mockResolvedValue({
      id: 'notification-1',
      projectId: 'project-1',
      eventId: 'event-1',
      status: NotificationStatus.FAILED,
      retryCount: 0,
      maxRetries: 3,
      channel: {
        id: 'channel-1',
        type: 'WEBHOOK',
        name: 'Webhook',
      },
      event: {
        id: 'event-1',
        type: 'invoice.created',
        status: 'FAILED',
      },
      deliveryLogs: [],
    });
    prisma.notification.findUnique.mockResolvedValue({
      id: 'notification-1',
      projectId: 'project-1',
      status: NotificationStatus.RETRYING,
      retryCount: 1,
      maxRetries: 3,
      nextRetryAt: new Date(),
    });
    outboxService.dispatch.mockResolvedValue({ queued: 0, pending: 1 });

    const result = await service.retry('notification-1', 'user-1');

    expect(outboxService.schedule).toHaveBeenCalledWith(
      prisma,
      'notification-1',
      expect.any(Date),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: NotificationStatus.RETRYING,
        queuePending: true,
      }),
    );
  });

  it('lists failed notifications as dead letters', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);

    await service.findDeadLetters('user-1', { projectId: 'project-1' }, 0, 25);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          project: { userId: 'user-1' },
          projectId: 'project-1',
          status: NotificationStatus.FAILED,
        },
        skip: 0,
        take: 25,
      }),
    );
  });

  it('rejects retry when another request changed the notification', async () => {
    prisma.notification.findFirst.mockResolvedValue({
      id: 'notification-1',
      projectId: 'project-1',
      eventId: 'event-1',
      status: NotificationStatus.FAILED,
      retryCount: 0,
      maxRetries: 3,
      channel: { id: 'channel-1', type: 'WEBHOOK', name: 'Webhook' },
      event: { id: 'event-1', type: 'invoice.created', status: 'FAILED' },
      deliveryLogs: [],
    });
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.retry('notification-1', 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.event.update).not.toHaveBeenCalled();
    expect(outboxService.dispatch).not.toHaveBeenCalled();
  });

  it('rejects a retry that is already scheduled', async () => {
    prisma.notification.findFirst.mockResolvedValue({
      id: 'notification-1',
      status: NotificationStatus.RETRYING,
      retryCount: 1,
      maxRetries: 3,
    });

    await expect(
      service.retry('notification-1', 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replays a dead-letter notification with a fresh retry budget', async () => {
    prisma.notification.findFirst.mockResolvedValue({
      id: 'notification-1',
      projectId: 'project-1',
      eventId: 'event-1',
      status: NotificationStatus.FAILED,
      retryCount: 3,
      maxRetries: 3,
      channel: { id: 'channel-1', type: 'WEBHOOK', name: 'Webhook' },
      event: { id: 'event-1', type: 'invoice.created', status: 'FAILED' },
      deliveryLogs: [],
    });
    prisma.notification.findUnique.mockResolvedValue({
      id: 'notification-1',
      projectId: 'project-1',
      eventId: 'event-1',
      status: NotificationStatus.RETRYING,
      retryCount: 0,
    });

    const result = await service.replay('notification-1', 'user-1');

    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'notification-1',
          status: NotificationStatus.FAILED,
          retryCount: 3,
        },
        data: expect.objectContaining({
          status: NotificationStatus.RETRYING,
          retryCount: 0,
          lastError: null,
        }),
      }),
    );
    expect(prisma.event.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { status: 'PROCESSING' },
    });
    expect(outboxService.dispatch).toHaveBeenCalledWith([{ id: 'schedule-1' }]);
    expect(result.retryCount).toBe(0);
  });
});
