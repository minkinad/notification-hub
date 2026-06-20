import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChannelType,
  DeliveryStatus,
  EventStatus,
  NotificationStatus,
  Prisma,
} from '@prisma/client';
import { safePostJson } from '@common/http/safe-http';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  asJsonRecord,
  readNonEmptyString,
  readNumberField,
  readStringRecord,
} from '@common/utils/json';
import { decryptSensitiveJson } from '@common/utils/secrets';
import { NotificationDeliveryOutboxService } from './notification-delivery-outbox.service';
import { NotificationDeliveryQueueService } from './notification-delivery-queue.service';

type NotificationForDelivery = Prisma.NotificationGetPayload<{
  include: {
    channel: true;
    event: true;
  };
}>;

@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: NotificationDeliveryQueueService,
    private readonly configService: ConfigService,
    @Optional()
    private readonly outboxService?: NotificationDeliveryOutboxService,
  ) {}

  async deliver(notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: {
        channel: true,
        event: true,
      },
    });

    if (!notification) {
      this.logger.warn(`Notification ${notificationId} was not found`);
      return { skipped: true, reason: 'not_found' };
    }

    if (
      notification.status !== NotificationStatus.PENDING &&
      notification.status !== NotificationStatus.RETRYING
    ) {
      return { skipped: true, reason: `status_${notification.status}` };
    }

    const claimed = await this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        status: {
          in: [NotificationStatus.PENDING, NotificationStatus.RETRYING],
        },
      },
      data: {
        status: NotificationStatus.PROCESSING,
        nextRetryAt: null,
      },
    });

    if (claimed.count !== 1) {
      return { skipped: true, reason: 'not_claimed' };
    }

    try {
      const providerResponse = await this.deliverToChannel(notification);

      await this.prisma.$transaction(async (tx) => {
        await tx.notification.update({
          where: { id: notification.id },
          data: {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
            lastError: null,
          },
        });
        await tx.deliveryLog.create({
          data: {
            notificationId: notification.id,
            status: DeliveryStatus.SUCCESS,
            statusCode: this.getStatusCode(providerResponse),
            response: providerResponse,
          },
        });
        await this.refreshEventStatus(tx, notification.eventId);
      });

      return { delivered: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextRetryCount = notification.retryCount + 1;
      const shouldRetry = nextRetryCount <= notification.maxRetries;
      const retryDelayMs = shouldRetry
        ? this.calculateRetryDelayMs(nextRetryCount)
        : 0;
      const nextRetryAt = shouldRetry
        ? new Date(Date.now() + retryDelayMs)
        : null;

      await this.prisma.$transaction(async (tx) => {
        await tx.notification.update({
          where: { id: notification.id },
          data: {
            status: shouldRetry
              ? NotificationStatus.RETRYING
              : NotificationStatus.FAILED,
            retryCount: nextRetryCount,
            nextRetryAt,
            lastError: message,
          },
        });
        await tx.deliveryLog.create({
          data: {
            notificationId: notification.id,
            status: shouldRetry
              ? DeliveryStatus.RETRYING
              : DeliveryStatus.FAILED,
            error: message,
            response: {
              channelType: notification.channel.type,
              retryScheduled: shouldRetry,
              nextRetryAt: nextRetryAt?.toISOString() ?? null,
            },
          },
        });
        if (shouldRetry && this.outboxService && nextRetryAt) {
          await tx.deliveryOutbox.upsert({
            where: {
              notificationId: notification.id,
            },
            create: {
              notificationId: notification.id,
              nextAttemptAt: nextRetryAt,
            },
            update: {
              attempts: 0,
              lastError: null,
              nextAttemptAt: nextRetryAt,
            },
          });
        }
        await this.refreshEventStatus(tx, notification.eventId);
      });

      let queuePending = false;
      if (shouldRetry) {
        try {
          await this.queueService.enqueue(notification.id, retryDelayMs);
          await this.outboxService?.markEnqueued([notification.id]);
        } catch (queueError) {
          queuePending = true;
          const queueMessage =
            queueError instanceof Error
              ? queueError.message
              : String(queueError);
          this.logger.warn(
            `Retry for notification ${notification.id} remains in outbox: ${queueMessage}`,
          );
        }
      }

      return {
        delivered: false,
        retryScheduled: shouldRetry,
        queuePending,
        error: message,
      };
    }
  }

  private async deliverToChannel(notification: NotificationForDelivery) {
    const config = asJsonRecord(
      decryptSensitiveJson(notification.channel.config, this.encryptionKey),
    );

    if (notification.channel.type === ChannelType.WEBHOOK) {
      return this.deliverWebhook(notification, config);
    }

    if (notification.channel.type === ChannelType.TELEGRAM) {
      return this.deliverTelegram(notification, config);
    }

    if (
      (notification.channel.type === ChannelType.EMAIL ||
        notification.channel.type === ChannelType.SMS) &&
      config.provider === 'http'
    ) {
      const deliveryUrl = readNonEmptyString(config.deliveryUrl ?? config.url);
      if (deliveryUrl) {
        return this.postJson(deliveryUrl, this.buildPayload(notification), {});
      }
    }

    return {
      mode: 'mock',
      channelType: notification.channel.type,
      recipient: notification.recipient,
    } satisfies Prisma.InputJsonObject;
  }

  private async deliverWebhook(
    notification: NotificationForDelivery,
    config: Record<string, unknown>,
  ) {
    const url = readNonEmptyString(config.url);
    if (!url) {
      throw new Error('Webhook URL is not configured');
    }

    const headers = readStringRecord(config.headers);
    return this.postJson(url, this.buildPayload(notification), headers);
  }

  private async deliverTelegram(
    notification: NotificationForDelivery,
    config: Record<string, unknown>,
  ) {
    const botToken = readNonEmptyString(config.botToken);
    const chatId = readNonEmptyString(config.chatId ?? config.username);

    if (!botToken || !chatId || botToken.startsWith('test-')) {
      return {
        mode: 'mock',
        channelType: ChannelType.TELEGRAM,
        recipient: notification.recipient,
      } satisfies Prisma.InputJsonObject;
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    return this.postJson(
      url,
      {
        chat_id: chatId,
        text: this.renderText(notification),
      },
      {},
    );
  }

  private async postJson(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ) {
    const response = await safePostJson(url, body, headers, {
      timeoutMs:
        this.configService?.get<number>('DELIVERY_HTTP_TIMEOUT_MS', 5000) ??
        5000,
      maxResponseBytes:
        this.configService?.get<number>(
          'DELIVERY_HTTP_MAX_RESPONSE_BYTES',
          32768,
        ) ?? 32768,
      blockPrivateNetworks:
        this.configService?.get<boolean>(
          'DELIVERY_HTTP_BLOCK_PRIVATE_NETWORKS',
          true,
        ) ?? true,
    });

    return {
      statusCode: response.statusCode,
      body: response.body,
    } satisfies Prisma.InputJsonObject;
  }

  private buildPayload(notification: NotificationForDelivery) {
    return {
      notificationId: notification.id,
      eventId: notification.eventId,
      projectId: notification.projectId,
      type: notification.template,
      recipient: notification.recipient,
      subject: notification.subject,
      data: notification.templateData,
      createdAt: notification.createdAt.toISOString(),
    };
  }

  private renderText(notification: NotificationForDelivery) {
    const subject = notification.subject ?? notification.template;
    return `${subject}\n${JSON.stringify(notification.templateData)}`;
  }

  private calculateRetryDelayMs(retryCount: number) {
    return Math.min(300_000, 60_000 * 2 ** Math.max(0, retryCount - 1));
  }

  private async refreshEventStatus(
    tx: Prisma.TransactionClient,
    eventId: string,
  ) {
    const [openCount, failedCount] = await Promise.all([
      tx.notification.count({
        where: {
          eventId,
          status: {
            in: [
              NotificationStatus.PENDING,
              NotificationStatus.PROCESSING,
              NotificationStatus.RETRYING,
            ],
          },
        },
      }),
      tx.notification.count({
        where: {
          eventId,
          status: NotificationStatus.FAILED,
        },
      }),
    ]);

    if (openCount > 0) {
      return;
    }

    await tx.event.update({
      where: { id: eventId },
      data: {
        status: failedCount > 0 ? EventStatus.FAILED : EventStatus.COMPLETED,
      },
    });
  }

  private getStatusCode(value: Prisma.InputJsonValue) {
    return readNumberField(value, 'statusCode');
  }

  private get encryptionKey() {
    return this.configService.getOrThrow<string>(
      'CHANNEL_CONFIG_ENCRYPTION_KEY',
    );
  }
}
