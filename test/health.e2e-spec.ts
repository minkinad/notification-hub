import {
  Controller,
  Get,
  INestApplication,
  Version,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '@common/interceptors/response.interceptor';
import { PrismaService } from '@common/prisma/prisma.service';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import { HealthController } from '@modules/health/health.controller';
import { HealthService } from '@modules/health/health.service';

@Controller('limited')
class LimitedController {
  @Get()
  @Version('1')
  get() {
    return { ok: true };
  }
}

describe('Health HTTP contract', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: jest.fn() };
  const redis = { ping: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 1 }])],
      controllers: [HealthController, LimitedController],
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: new ConfigService({ HEALTH_CHECK_TIMEOUT_MS: 25 }),
        },
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, prefix: 'api/v' });
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([{ value: 1 }]);
    redis.ping.mockResolvedValue('PONG');
  });
  afterAll(async () => {
    await app.close();
  });

  it('keeps probes available when the general HTTP rate limit is exhausted', async () => {
    await request(app.getHttpServer()).get('/api/v1/limited').expect(200);
    await request(app.getHttpServer()).get('/api/v1/limited').expect(429);
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const route of ['health', 'health/live', 'health/ready']) {
        await request(app.getHttpServer())
          .get(`/api/v1/${route}`)
          .expect(200)
          .expect('Cache-Control', 'no-store');
      }
    }
  });

  it('returns the application response envelope and dependency status', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { status: 'ok', dependencies: { redis: { status: 'up' } } },
    });
  });

  it('keeps liveness independent from failed dependencies', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('offline'));
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('returns readiness 503 and a safe diagnostic summary on dependency failure', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('password=secret host=internal-db'),
    );
    const ready = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503)
      .expect('Cache-Control', 'no-store');
    expect(ready.body.message).toBe('Service is not ready');
    const summary = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(summary.body.data.dependencies.database).toEqual({
      status: 'down',
      reason: 'unavailable',
    });
    expect(JSON.stringify([ready.body, summary.body])).not.toMatch(
      /password|secret|internal-db/,
    );
  });

  it('returns 503 for a hanging dependency within the HTTP request budget', async () => {
    redis.ping.mockReturnValue(new Promise(() => undefined));
    await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .timeout({ response: 2000 })
      .expect(503);
  });
});
