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
      findMany: jest.fn(),
    },
    notification: {
      createMany: jest.fn(),
    },
  } as any;

  const projectsService = {
    ensureOwnedProject: jest.fn(),
    verifyApiKey: jest.fn(),
  } as any;

  let service: EventsService;

  beforeEach(() => {
    jest.clearAllMocks();
    const transactionClient = {
      notificationChannel: prisma.notificationChannel,
      event: prisma.event,
      notification: prisma.notification,
    };
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof transactionClient) => unknown) =>
        Promise.resolve(callback(transactionClient)),
    );
    service = new EventsService(prisma, projectsService);
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
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          projectId: 'project-1',
          eventId: 'event-1',
          channelId: 'channel-email',
          recipient: 'alerts@example.com',
          subject: 'Notification for user.registered',
          template: 'user.registered',
          templateData: { userId: 'user-1' },
        },
        {
          projectId: 'project-1',
          eventId: 'event-1',
          channelId: 'channel-webhook',
          recipient: 'https://example.com/hook',
          subject: null,
          template: 'user.registered',
          templateData: { userId: 'user-1' },
        },
      ],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result.notificationsCreated).toBe(2);
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

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(result.notificationsCreated).toBe(0);
  });

  it('normalizes negative pagination input', async () => {
    prisma.event.findMany.mockResolvedValue([]);
    prisma.event.count.mockResolvedValue(0);

    const result = await service.findAll(
      'user-1',
      {},
      -5,
      1000,
    );

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
