import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const prisma = { $queryRaw: jest.fn() };
  const redis = { ping: jest.fn() };
  const config = new ConfigService({
    NODE_ENV: 'test',
    HEALTH_CHECK_TIMEOUT_MS: 50,
  });
  let service: HealthService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([{ value: 1 }]);
    redis.ping.mockResolvedValue('PONG');
    service = new HealthService(config, prisma as any, redis as any);
  });
  afterEach(() => jest.useRealTimers());

  it('reports ok when both dependencies respond', async () => {
    expect(await service.getStatus()).toMatchObject({
      status: 'ok',
      dependencies: { database: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it('reports liveness without checking dependencies', () => {
    expect(service.getLiveStatus().status).toBe('ok');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('does not expose internal connection errors', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('postgres://admin:secret@private-host/db'),
    );
    const result = await service.getStatus();
    expect(result).toMatchObject({
      status: 'degraded',
      dependencies: { database: { status: 'down', reason: 'unavailable' } },
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|private-host/);
  });

  it('rejects an unexpected Redis response', async () => {
    redis.ping.mockResolvedValue('NOT_PONG');
    expect((await service.getStatus()).dependencies.redis).toEqual({
      status: 'down',
      reason: 'unavailable',
    });
  });

  it('bounds both hanging probes by one deadline and reuses underlying operations', async () => {
    jest.useFakeTimers();
    prisma.$queryRaw.mockReturnValue(new Promise(() => undefined));
    redis.ping.mockReturnValue(new Promise(() => undefined));
    const requests = [service.getReadyStatus(), service.getReadyStatus()];
    await jest.advanceTimersByTimeAsync(50);
    for (const result of await Promise.all(requests)) {
      expect(result).toMatchObject({
        status: 'degraded',
        dependencies: {
          database: { status: 'down', reason: 'timeout' },
          redis: { status: 'down', reason: 'timeout' },
        },
      });
    }
    const next = service.getReadyStatus();
    await jest.advanceTimersByTimeAsync(50);
    await next;
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(redis.ping).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('handles late rejection and checks again after the driver recovers', async () => {
    jest.useFakeTimers();
    let reject!: (error: Error) => void;
    redis.ping.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const request = service.getStatus();
    await jest.advanceTimersByTimeAsync(50);
    expect((await request).dependencies.redis).toMatchObject({
      reason: 'timeout',
    });
    reject(new Error('Late driver failure'));
    await jest.advanceTimersByTimeAsync(0);
    expect((await service.getStatus()).status).toBe('ok');
    expect(redis.ping).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears deadline timers after healthy checks', async () => {
    jest.useFakeTimers();
    await service.getReadyStatus();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports unready during shutdown without querying dependencies', async () => {
    service.onModuleDestroy();
    expect(await service.getReadyStatus()).toMatchObject({
      status: 'degraded',
      dependencies: {
        database: { reason: 'shutting_down' },
        redis: { reason: 'shutting_down' },
      },
    });
    expect(service.getLiveStatus().status).toBe('ok');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('does not become ready when a pending probe resolves during shutdown', async () => {
    let resolve!: (value: string) => void;
    redis.ping.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const request = service.getReadyStatus();
    service.onModuleDestroy();
    resolve('PONG');
    expect((await request).status).toBe('degraded');
  });
});
