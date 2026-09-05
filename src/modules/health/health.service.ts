import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { PrismaService } from '@common/prisma/prisma.service';
import { REDIS_CLIENT } from '@common/redis/redis.module';

type Dependency = 'database' | 'redis';
type DependencyStatus =
  | { status: 'up' }
  | { status: 'down'; reason: 'timeout' | 'unavailable' | 'shutting_down' };

@Injectable()
export class HealthService implements OnModuleDestroy {
  private shuttingDown = false;
  private readonly inFlight = new Map<Dependency, Promise<DependencyStatus>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleDestroy() {
    this.shuttingDown = true;
  }

  getLiveStatus() {
    return this.getBaseStatus('ok');
  }

  async getStatus() {
    if (this.shuttingDown) {
      return this.shutdownStatus();
    }

    const [database, redis] = await Promise.all([
      this.checkDependency('database', async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      this.checkDependency('redis', async () => {
        if ((await this.redis.ping()) !== 'PONG') {
          throw new Error('Unexpected Redis ping response');
        }
      }),
    ]);

    // Shutdown may begin while dependency probes are still in flight.
    if (this.shuttingDown) return this.shutdownStatus();
    return {
      ...this.getBaseStatus(
        database.status === 'up' && redis.status === 'up' ? 'ok' : 'degraded',
      ),
      dependencies: { database, redis },
    };
  }

  getReadyStatus() {
    return this.getStatus();
  }

  private shutdownStatus() {
    const down: DependencyStatus = { status: 'down', reason: 'shutting_down' };
    return {
      ...this.getBaseStatus('degraded'),
      dependencies: { database: down, redis: down },
    };
  }

  private getBaseStatus(status: 'ok' | 'degraded') {
    return {
      status,
      service: this.configService.get<string>('APP_NAME', 'NotificationHub'),
      version: this.configService.get<string>('APP_VERSION', '1.0.0'),
      environment: this.configService.get<string>('NODE_ENV', 'development'),
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  private async checkDependency(name: Dependency, check: () => Promise<void>) {
    let operation = this.inFlight.get(name);
    if (!operation) {
      operation = Promise.resolve()
        .then(check)
        .then<DependencyStatus, DependencyStatus>(
          () => ({ status: 'up' }),
          () => ({ status: 'down', reason: 'unavailable' }),
        )
        .finally(() => this.inFlight.delete(name));
      this.inFlight.set(name, operation);
    }

    // A deadline bounds the response, not the underlying driver operation.
    // Retain that operation until it settles to avoid accumulating queries or
    // offline Redis commands during an outage. Its rejection is always handled.
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<DependencyStatus>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: 'down', reason: 'timeout' }),
        this.configService.get<number>('HEALTH_CHECK_TIMEOUT_MS', 2000),
      );
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
