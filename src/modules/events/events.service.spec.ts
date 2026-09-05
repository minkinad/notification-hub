import { BadRequestException } from '@nestjs/common';
import { ChannelType, EventStatus } from '@prisma/client';
import { EventsService } from './events.service';

describe('EventsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    notificationChannel: {
      findMany: jest.fn(),
    },
    event: {
      create: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
  } as any;

  const projectsService = {
    ensureOwnedProject: jest.fn(),
    verifyApiKey: jest.fn(),
  } as any;

  const outboxService = {
    schedule: jest.fn(),
    dispatch: jest.fn(),
  };
  const rateLimitService = { consume: jest.fn() };
  let service: EventsService;

  beforeEach(() => {
    jest.resetAllMocks();
    outboxService.schedule.mockImplementation((_tx: unknown, id: string) => ({
      id: `schedule-${id}`,
    }));
    outboxService.dispatch.mockImplementation((entries: unknown[]) => ({
      queued: entries.length,
      pending: 0,
    }));
    prisma.notification.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: `notification-${data.channelId}`,
      }),
    );
    const transactionClient = {
      notificationChannel: prisma.notificationChannel,
      event: prisma.event,
      notification: prisma.notification,
    };
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof transactionClient) => unknown) =>
        Promise.resolve(callback(transactionClient)),
    );
    service = new EventsService(
      prisma,
      projectsService,
      outboxService as any,
      rateLimitService as any,
    );
  });

  it('creates pending notifications for active channels', async () => {
    prisma.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'channel-email',
        type: ChannelType.EMAIL,
        config: { to: 'alerts@example.com' },
      },
      {
        id: 'channel-webhook',
        type: ChannelType.WEBHOOK,
        config: { url: 'https://example.com/hook' },
      },
    ]);
    prisma.event.create.mockResolvedValue({
      id: 'event-1',
      projectId: 'project-1',
      type: 'user.registered',
      data: { userId: 'user-1' },
      status: EventStatus.PROCESSING,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create('user-1', {
      projectId: 'project-1',
      type: 'user.registered',
      data: { userId: 'user-1' },
    });

    expect(projectsService.ensureOwnedProject).toHaveBeenCalledWith(
      'project-1',
      'user-1',
    );
    expect(prisma.event.create).toHaveBeenCalledWith({
      data: {
        projectId: 'project-1',
        type: 'user.registered',
        data: { userId: 'user-1' },
        status: EventStatus.PROCESSING,
      },
    });
    expect(prisma.notification.create).toHaveBeenNthCalledWith(1, {
      data: {
        projectId: 'project-1',
        eventId: 'event-1',
        channelId: 'channel-email',
        recipient: 'alerts@example.com',
        subject: 'Notification for user.registered',
        template: 'user.registered',
        templateData: { userId: 'user-1' },
      },
      select: {
        id: true,
      },
    });
    expect(prisma.notification.create).toHaveBeenNthCalledWith(2, {
      data: {
        projectId: 'project-1',
        eventId: 'event-1',
        channelId: 'channel-webhook',
        recipient: 'https://example.com/hook',
        subject: null,
        template: 'user.registered',
        templateData: { userId: 'user-1' },
      },
      select: {
        id: true,
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result.notificationsCreated).toBe(2);
    expect(result.notificationsQueued).toBe(2);
  });

  it('queues delivery jobs when queue service is configured', async () => {
    prisma.notificationChannel.findMany.mockResolvedValue([
      {
        id: 'channel-email',
        type: ChannelType.EMAIL,
        config: { to: 'alerts@example.com' },
      },
    ]);
    prisma.event.create.mockResolvedValue({
      id: 'event-1',
      projectId: 'project-1',
      type: 'user.registered',
      data: { userId: 'user-1' },
      status: EventStatus.PROCESSING,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.notification.create.mockResolvedValue({
      id: 'notification-1',
    });

    const result = await service.create('user-1', {
      projectId: 'project-1',
      type: 'user.registered',
      data: { userId: 'user-1' },
    });

    expect(outboxService.dispatch).toHaveBeenCalledWith([
      { id: 'schedule-notification-1' },
    ]);
    expect(outboxService.schedule).toHaveBeenCalledWith(
      expect.anything(),
      'notification-1',
    );
    expect(result.notificationsQueued).toBe(1);
  });

  it('reports partial dispatch without overwriting a concurrently completed event', async () => {
    prisma.notificationChannel.findMany.mockResolvedValue([
      { id: 'one', type: ChannelType.EMAIL, config: { to: 'a@example.com' } },
      { id: 'two', type: ChannelType.SMS, config: { phone: '+123' } },
    ]);
    prisma.event.create.mockResolvedValue({
      id: 'event-1',
      status: EventStatus.PROCESSING,
    });
    outboxService.dispatch.mockResolvedValue({ queued: 1, pending: 1 });
    const result = await service.create('user-1', {
      projectId: 'project-1',
      type: 'created',
      data: {},
    });
    expect(result).toMatchObject({
      notificationsCreated: 2,
      notificationsQueued: 1,
      notificationsQueuePending: 1,
    });
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('creates a pending event when no channels are configured', async () => {
    prisma.notificationChannel.findMany.mockResolvedValue([]);
    prisma.event.create.mockResolvedValue({
      id: 'event-2',
      projectId: 'project-1',
      type: 'invoice.created',
      data: { invoiceId: 'inv-1' },
      status: EventStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create('user-1', {
      projectId: 'project-1',
      type: 'invoice.created',
      data: { invoiceId: 'inv-1' },
    });

    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(result.notificationsCreated).toBe(0);
    expect(result.notificationsQueued).toBe(0);
  });

  it('returns the original event for a repeated idempotency key', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-existing',
      projectId: 'project-1',
      idempotencyKey: 'invoice-inv-1',
      type: 'invoice.created',
      data: { invoiceId: 'inv-1' },
      status: EventStatus.PROCESSING,
      createdAt: new Date(),
      updatedAt: new Date(),
      notifications: [{ id: 'notification-1' }],
    });

    const result = await service.create(
      'user-1',
      {
        projectId: 'project-1',
        type: 'invoice.created',
        data: { invoiceId: 'inv-1' },
      },
      'invoice-inv-1',
    );

    expect(prisma.event.findUnique).toHaveBeenCalledWith({
      where: {
        projectId_idempotencyKey: {
          projectId: 'project-1',
          idempotencyKey: 'invoice-inv-1',
        },
      },
      include: {
        notifications: {
          select: {
            id: true,
          },
        },
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'event-existing',
        notificationsCreated: 1,
        notificationsQueued: 0,
        idempotentReplay: true,
      }),
    );
  });

  it('applies managed API key scope and project rate limits on ingest', async () => {
    const rateLimitService = {
      consume: jest.fn(),
    };
    service = new EventsService(
      prisma,
      projectsService,
      outboxService as any,
      rateLimitService as any,
    );
    projectsService.verifyApiKey.mockResolvedValue({
      project: {
        id: 'project-1',
        userId: 'user-1',
        rateLimit: 1000,
        rateLimitWindow: 3600,
      },
      apiKey: {
        id: 'api-key-1',
        scopes: ['events:ingest'],
        rateLimit: 25,
        rateLimitWindow: 60,
      },
    });
    prisma.notificationChannel.findMany.mockResolvedValue([]);
    prisma.event.create.mockResolvedValue({
      id: 'event-2',
      projectId: 'project-1',
      type: 'invoice.created',
      data: { invoiceId: 'inv-1' },
      status: EventStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.ingest('pk_key', {
      type: 'invoice.created',
      data: { invoiceId: 'inv-1' },
    });

    expect(rateLimitService.consume).toHaveBeenCalledWith({
      projectId: 'project-1',
      apiKeyId: 'api-key-1',
      limit: 25,
      windowSeconds: 60,
    });
  });

  it('rejects ingest when the API key header is missing', async () => {
    await expect(
      service.ingest(undefined, {
        type: 'invoice.created',
        data: { invoiceId: 'inv-1' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(projectsService.verifyApiKey).not.toHaveBeenCalled();
  });

  it('normalizes negative pagination input', async () => {
    prisma.event.findMany.mockResolvedValue([]);
    prisma.event.count.mockResolvedValue(0);

    const result = await service.findAll('user-1', {}, -5, 1000);

    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 100,
      }),
    );
    expect(result.skip).toBe(0);
    expect(result.take).toBe(100);
  });
});
