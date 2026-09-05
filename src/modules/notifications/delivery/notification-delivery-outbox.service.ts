import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryOutbox, Prisma } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { NotificationDeliveryQueueService } from './notification-delivery-queue.service';

@Injectable()
export class NotificationDeliveryOutboxService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationDeliveryOutboxService.name);
  private interval?: NodeJS.Timeout;
  private sweep?: Promise<{
    processed: number;
    queued: number;
    pending: number;
  }>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: NotificationDeliveryQueueService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const run = () => {
      void this.enqueueDue().catch((error: unknown) => {
        this.logger.warn(`Delivery outbox sweep failed: ${String(error)}`);
      });
    };
    this.interval = setInterval(
      run,
      this.configService.get<number>('DELIVERY_OUTBOX_INTERVAL_MS', 30000),
    );
    this.interval.unref();
    run();
  }

  async onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
    await this.sweep?.catch(() => undefined);
  }

  // Each schedule has an immutable identity. Replacing it inside the same
  // transaction as the notification transition fences acknowledgements from
  // older dispatchers and gives retries/replays a fresh BullMQ job ID.
  async schedule(
    tx: Prisma.TransactionClient,
    notificationId: string,
    nextAttemptAt = new Date(),
  ) {
    await tx.deliveryOutbox.deleteMany({ where: { notificationId } });
    return tx.deliveryOutbox.create({
      data: { notificationId, nextAttemptAt },
    });
  }

  async dispatch(entries: DeliveryOutbox[]) {
    let queued = 0;
    for (const entry of entries) {
      try {
        await this.queueService.enqueue(
          entry.notificationId,
          entry.id,
          Math.max(0, entry.nextAttemptAt.getTime() - Date.now()),
        );
        // Never acknowledge by notificationId: a worker may already have
        // replaced this entry with the next retry before Queue.add returns.
        await this.prisma.deliveryOutbox.deleteMany({
          where: { id: entry.id },
        });
        queued += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          await this.prisma.deliveryOutbox.updateMany({
            where: { id: entry.id, attempts: entry.attempts },
            data: {
              attempts: { increment: 1 },
              lastError: message,
              nextAttemptAt: new Date(
                Math.max(
                  entry.nextAttemptAt.getTime(),
                  Date.now() + this.calculateBackoffMs(entry.attempts + 1),
                ),
              ),
            },
          });
        } catch (storeError) {
          this.logger.warn(
            `Could not record outbox failure: ${String(storeError)}`,
          );
        }
        this.logger.warn(
          `Delivery schedule ${entry.id} remains unconfirmed: ${message}`,
        );
      }
    }
    return { queued, pending: entries.length - queued };
  }

  enqueueDue(limit = 100) {
    // Replicas can sweep concurrently; within one process reuse an ongoing
    // sweep so a slow Redis connection cannot accumulate timer callbacks.
    if (!this.sweep) {
      this.sweep = this.sweepDue(limit).finally(() => {
        this.sweep = undefined;
      });
    }
    return this.sweep;
  }

  private async sweepDue(limit: number) {
    const entries = await this.prisma.deliveryOutbox.findMany({
      where: { nextAttemptAt: { lte: new Date() } },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return { processed: entries.length, ...(await this.dispatch(entries)) };
  }

  private calculateBackoffMs(attempts: number) {
    return Math.min(300_000, 10_000 * 2 ** Math.max(0, attempts - 1));
  }
}
