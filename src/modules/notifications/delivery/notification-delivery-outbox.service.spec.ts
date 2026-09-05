import { Logger } from '@nestjs/common';
import { DeliveryOutbox } from '@prisma/client';
import { NotificationDeliveryOutboxService } from './notification-delivery-outbox.service';

const entry = (id = 'schedule-1', nextAttemptAt = new Date()) =>
  ({
    id,
    notificationId: 'notification-1',
    attempts: 0,
    lastError: null,
    nextAttemptAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) satisfies DeliveryOutbox;

describe('NotificationDeliveryOutboxService', () => {
  const store = {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  };
  const queue = { enqueue: jest.fn() };
  const config = { get: (_key: string, fallback: number) => fallback };
  let service: NotificationDeliveryOutboxService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new NotificationDeliveryOutboxService(
      { deliveryOutbox: store } as any,
      queue as any,
      config as any,
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('acknowledges only the dispatched schedule, never a newer retry', async () => {
    const old = entry();
    let current: DeliveryOutbox | undefined = old;
    queue.enqueue.mockImplementation(() => {
      current = entry('new-retry');
    });
    store.deleteMany.mockImplementation(({ where }: any) => {
      if (current?.id === where.id) current = undefined;
    });
    await expect(service.dispatch([old])).resolves.toEqual({
      queued: 1,
      pending: 0,
    });
    expect(current?.id).toBe('new-retry');
    expect(queue.enqueue).toHaveBeenCalledWith('notification-1', old.id, 0);
  });

  it('preserves the notification retry deadline when dispatch fails', async () => {
    jest.useFakeTimers();
    const nextAttemptAt = new Date(Date.now() + 60000);
    queue.enqueue.mockRejectedValue(new Error('Redis unavailable'));
    await expect(
      service.dispatch([entry('delayed', nextAttemptAt)]),
    ).resolves.toEqual({ queued: 0, pending: 1 });
    expect(store.updateMany).toHaveBeenCalledWith({
      where: { id: 'delayed', attempts: 0 },
      data: {
        attempts: { increment: 1 },
        lastError: 'Redis unavailable',
        nextAttemptAt,
      },
    });
  });

  it('continues the batch when an entry is deleted or error persistence fails', async () => {
    queue.enqueue
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValueOnce({});
    store.updateMany.mockRejectedValue(new Error('Database unavailable'));
    await expect(
      service.dispatch([entry('one'), entry('two')]),
    ).resolves.toEqual({ queued: 1, pending: 1 });
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it('reuses the same job identity after an acknowledgement failure', async () => {
    store.deleteMany
      .mockRejectedValueOnce(new Error('Database unavailable'))
      .mockResolvedValueOnce({ count: 1 });
    const schedule = entry();
    await service.dispatch([schedule]);
    await service.dispatch([schedule]);
    expect(queue.enqueue.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      schedule.id,
      schedule.id,
    ]);
  });

  it('coalesces overlapping sweeps and waits for the sweep during shutdown', async () => {
    let resolveRead!: (entries: DeliveryOutbox[]) => void;
    store.findMany.mockReturnValue(
      new Promise<DeliveryOutbox[]>((resolve) => {
        resolveRead = resolve;
      }),
    );
    const first = service.enqueueDue();
    const second = service.enqueueDue();
    expect(first).toBe(second);
    const shutdown = service.onModuleDestroy();
    resolveRead([]);
    await shutdown;
    expect(store.findMany).toHaveBeenCalledTimes(1);
    store.findMany.mockResolvedValue([]);
    await service.enqueueDue();
    expect(store.findMany).toHaveBeenCalledTimes(2);
  });

  it('recovers immediately at startup and clears its periodic sweep at shutdown', async () => {
    jest.useFakeTimers();
    store.findMany.mockResolvedValue([]);
    service.onModuleInit();
    await service.enqueueDue();
    expect(store.findMany).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
    jest.advanceTimersByTime(60000);
    expect(store.findMany).toHaveBeenCalledTimes(1);
  });
});
