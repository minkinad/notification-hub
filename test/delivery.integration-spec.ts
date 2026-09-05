import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import {
  ChannelType,
  EventStatus,
  NotificationStatus,
  Prisma,
} from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '@common/prisma/prisma.service';
import { NotificationDeliveryOutboxService } from '@modules/notifications/delivery/notification-delivery-outbox.service';
import { NotificationDeliveryQueueService } from '@modules/notifications/delivery/notification-delivery-queue.service';
import { NotificationDeliveryService } from '@modules/notifications/delivery/notification-delivery.service';
import { NotificationDeliveryJob } from '@modules/notifications/delivery/notification-delivery.constants';
import { NotificationsService } from '@modules/notifications/notifications.service';

// Require explicit test infrastructure; never fall back to the application's .env.
const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) {
  throw new Error(
    'Set TEST_DATABASE_URL and TEST_REDIS_URL to isolated test services (see docs/ARCHITECTURE.md).',
  );
}

describe('Delivery reliability with PostgreSQL and Redis', () => {
  const prisma = new PrismaService({
    datasources: { db: { url: databaseUrl } },
  });
  const config = new ConfigService({
    CHANNEL_CONFIG_ENCRYPTION_KEY:
      'integration-test-encryption-key-at-least-32-characters',
  });
  let queue: Queue<NotificationDeliveryJob>;
  let queueService: NotificationDeliveryQueueService;
  let outbox: NotificationDeliveryOutboxService;
  let delivery: NotificationDeliveryService;
  let worker: Worker<NotificationDeliveryJob>;
  let userId: string;
  let projectId: string;
  let channelId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });
  beforeEach(async () => {
    const suffix = randomUUID();
    queue = new Queue<NotificationDeliveryJob>(`delivery-test-${suffix}`, {
      connection: { url: redisUrl },
    });
    worker = new Worker<NotificationDeliveryJob>(
      queue.name,
      () => Promise.resolve(undefined),
      {
        connection: { url: redisUrl },
        autorun: false,
      },
    );
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
    queueService = new NotificationDeliveryQueueService(queue);
    outbox = new NotificationDeliveryOutboxService(
      prisma,
      queueService,
      config,
    );
    delivery = new NotificationDeliveryService(prisma, outbox, config);
    const user = await prisma.user.create({
      data: { email: `${suffix}@test.invalid`, password: 'unused' },
    });
    userId = user.id;
    const project = await prisma.project.create({
      data: {
        name: 'Integration test',
        userId,
        apiKeyHash: suffix,
        apiKeyPrefix: 'test',
      },
    });
    projectId = project.id;
    const channel = await prisma.notificationChannel.create({
      data: {
        projectId,
        type: ChannelType.EMAIL,
        name: 'Mock email',
        config: { to: 'test@example.com' },
      },
    });
    channelId = channel.id;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await worker?.close();
    if (queue) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createNotification(
    status: NotificationStatus = NotificationStatus.PENDING,
  ) {
    const event = await prisma.event.create({
      data: {
        projectId,
        type: 'test',
        data: {},
        status: EventStatus.PROCESSING,
      },
    });
    return prisma.notification.create({
      data: {
        projectId,
        eventId: event.id,
        channelId,
        recipient: 'test@example.com',
        template: 'test',
        status,
      },
    });
  }
  async function schedule(notificationId: string, date?: Date) {
    return prisma.$transaction((tx) =>
      outbox.schedule(tx, notificationId, date),
    );
  }
  async function finishNext() {
    const token = randomUUID();
    const job = await worker.getNextJob(token);
    if (!job) throw new Error('Expected a queued delivery job');
    const result = await delivery.deliver(job.data.notificationId);
    await job.moveToCompleted(result, token, false);
    return job;
  }

  it('deduplicates concurrent dispatchers while allowing replay past retained completed jobs', async () => {
    const notification = await createNotification();
    const first = await schedule(notification.id);
    await Promise.all([outbox.dispatch([first]), outbox.dispatch([first])]);
    expect(await queue.getWaitingCount()).toBe(1);
    const completed = await finishNext();
    expect(await completed.getState()).toBe('completed');
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: NotificationStatus.FAILED, retryCount: 4 },
    });
    const notifications = new NotificationsService(prisma, outbox);
    await notifications.replay(notification.id, userId);
    expect(await queue.getWaitingCount()).toBe(1);
    const replayed = await finishNext();
    expect(replayed.id).not.toBe(first.id);
    expect(await completed.getState()).toBe('completed');
    expect(
      (
        await prisma.notification.findUniqueOrThrow({
          where: { id: notification.id },
        })
      ).status,
    ).toBe(NotificationStatus.SENT);
  });

  it('does not delete a new retry created before the old dispatcher acknowledges', async () => {
    const notification = await createNotification();
    const first = await schedule(notification.id);
    let nextId: string | undefined;
    const enqueue = queueService.enqueue.bind(queueService);
    jest
      .spyOn(queueService, 'enqueue')
      .mockImplementationOnce(async (...args) => {
        const job = await enqueue(...args);
        nextId = (await schedule(notification.id, new Date(Date.now() + 60000)))
          .id;
        return job;
      });
    await outbox.dispatch([first]);
    const pending = await prisma.deliveryOutbox.findUniqueOrThrow({
      where: { notificationId: notification.id },
    });
    expect(pending.id).toBe(nextId);
    expect(pending.id).not.toBe(first.id);
  });

  it('recovers a failed dispatch and preserves the original schedule identity', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const notification = await createNotification();
    const first = await schedule(notification.id);
    jest
      .spyOn(queueService, 'enqueue')
      .mockRejectedValueOnce(new Error('Injected Redis outage'));
    expect(await outbox.dispatch([first])).toEqual({ queued: 0, pending: 1 });
    expect(
      (
        await prisma.deliveryOutbox.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).attempts,
    ).toBe(1);
    await prisma.deliveryOutbox.update({
      where: { id: first.id },
      data: { nextAttemptAt: new Date(0) },
    });
    expect(await outbox.enqueueDue()).toMatchObject({ queued: 1, pending: 0 });
    expect((await finishNext()).id).toBe(first.id);
    expect(
      await prisma.deliveryOutbox.count({
        where: { notificationId: notification.id },
      }),
    ).toBe(0);
  });

  it('rolls back notification and outbox changes together', async () => {
    const notification = await createNotification();
    const first = await schedule(notification.id);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.notification.update({
          where: { id: notification.id },
          data: { status: NotificationStatus.RETRYING },
        });
        await outbox.schedule(tx, notification.id);
        throw new Error('Injected transaction failure');
      }),
    ).rejects.toThrow('Injected transaction failure');
    expect(
      (
        await prisma.notification.findUniqueOrThrow({
          where: { id: notification.id },
        })
      ).status,
    ).toBe(NotificationStatus.PENDING);
    expect(
      (
        await prisma.deliveryOutbox.findUniqueOrThrow({
          where: { notificationId: notification.id },
        })
      ).id,
    ).toBe(first.id);
  });

  it('rejects stale early jobs and atomically claims a due notification once', async () => {
    const notification = await createNotification(NotificationStatus.RETRYING);
    await prisma.notification.update({
      where: { id: notification.id },
      data: { nextRetryAt: new Date(Date.now() + 60000) },
    });
    expect(await delivery.deliver(notification.id)).toEqual({
      skipped: true,
      reason: 'retry_not_due',
    });
    await prisma.notification.update({
      where: { id: notification.id },
      data: { nextRetryAt: new Date(0) },
    });
    const results = await Promise.all([
      delivery.deliver(notification.id),
      delivery.deliver(notification.id),
    ]);
    expect(
      results.filter((result) => 'delivered' in result && result.delivered),
    ).toHaveLength(1);
    expect(
      await prisma.deliveryLog.count({
        where: { notificationId: notification.id },
      }),
    ).toBe(1);
  });

  it.each([false, true])(
    'finishes concurrent channels with an accurate aggregate (failed sibling: %s)',
    async (hasFailure) => {
      const first = await createNotification();
      const siblings = await Promise.all(
        Array.from({ length: 3 }, () =>
          prisma.notification.create({
            data: {
              projectId,
              eventId: first.eventId,
              channelId,
              recipient: 'test@example.com',
              template: 'test',
            },
          }),
        ),
      );
      if (hasFailure) {
        await prisma.notification.create({
          data: {
            projectId,
            eventId: first.eventId,
            channelId,
            recipient: 'test@example.com',
            template: 'test',
            status: NotificationStatus.FAILED,
          },
        });
      }
      const results = await Promise.all(
        [first, ...siblings].map((item) => delivery.deliver(item.id)),
      );
      expect(
        results.every((result) => 'delivered' in result && result.delivered),
      ).toBe(true);
      const event = await prisma.event.findUniqueOrThrow({
        where: { id: first.eventId },
      });
      expect(event.status).toBe(
        hasFailure ? EventStatus.FAILED : EventStatus.COMPLETED,
      );
    },
  );

  it('holds the event lock before changing a delivery result', async () => {
    const notification = await createNotification();
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT id FROM events WHERE id = ${notification.eventId} FOR UPDATE`;
        locked();
        await gate;
      },
    );
    await held;
    const inFlight = delivery.deliver(notification.id);
    try {
      // Observe the claim while the event lock is held. Provider completion
      // must not commit until the competing aggregate transaction releases it.
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = await prisma.notification.findUniqueOrThrow({
          where: { id: notification.id },
        });
        if (current.status === NotificationStatus.PROCESSING) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(
        await prisma.deliveryLog.count({
          where: { notificationId: notification.id },
        }),
      ).toBe(0);
    } finally {
      release();
      await blocker;
    }
    await expect(inFlight).resolves.toEqual({ delivered: true });
  });
});
