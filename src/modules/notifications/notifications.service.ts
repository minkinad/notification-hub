import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventStatus, NotificationStatus, Prisma } from '@prisma/client';
import { AuditService } from '@common/audit/audit.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { normalizePagination } from '@common/utils/pagination';
import { NotificationDeliveryOutboxService } from './delivery/notification-delivery-outbox.service';
import { NotificationDeliveryQueueService } from './delivery/notification-delivery-queue.service';
import {
  DeadLetterListQueryDto,
  NotificationListQueryDto,
} from './dto/notification-list.dto';

const notificationDetailsInclude = {
  channel: {
    select: {
      id: true,
      type: true,
      name: true,
    },
  },
  event: {
    select: {
      id: true,
      type: true,
      status: true,
    },
  },
  deliveryLogs: {
    orderBy: {
      attemptedAt: 'desc',
    },
  },
} satisfies Prisma.NotificationInclude;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly queueService?: NotificationDeliveryQueueService,
    @Optional()
    private readonly outboxService?: NotificationDeliveryOutboxService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async findAll(
    userId: string,
    query: NotificationListQueryDto,
    skip = 0,
    take = 10,
  ) {
    const pagination = normalizePagination({ skip, take });
    const where: Prisma.NotificationWhereInput = {
      project: {
        userId,
      },
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { createdAt: 'desc' },
        include: {
          channel: {
            select: {
              id: true,
              type: true,
              name: true,
            },
          },
          event: {
            select: {
              id: true,
              type: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      data: notifications,
      total,
      skip: pagination.skip,
      take: pagination.take,
    };
  }

  async findOne(id: string, userId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id,
        project: {
          userId,
        },
      },
      include: notificationDetailsInclude,
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return notification;
  }

  async findDeadLetters(
    userId: string,
    query: DeadLetterListQueryDto,
    skip = 0,
    take = 10,
  ) {
    return this.findAll(
      userId,
      {
        projectId: query.projectId,
        status: NotificationStatus.FAILED,
      },
      skip,
      take,
    );
  }

  async retry(id: string, userId: string) {
    const notification = await this.findOne(id, userId);

    if (notification.status === NotificationStatus.SENT) {
      throw new BadRequestException(
        'Delivered notifications cannot be retried',
      );
    }

    if (notification.status === NotificationStatus.PROCESSING) {
      throw new BadRequestException(
        'Processing notifications cannot be retried',
      );
    }

    if (notification.status === NotificationStatus.RETRYING) {
      throw new BadRequestException('Notification retry is already scheduled');
    }

    if (notification.retryCount >= notification.maxRetries) {
      throw new BadRequestException('Maximum retry count has been reached');
    }

    const nextRetryAt = new Date(Date.now() + 60_000);
    const updatedNotification = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.notification.updateMany({
        where: {
          id,
          status: notification.status,
          retryCount: notification.retryCount,
        },
        data: {
          status: NotificationStatus.RETRYING,
          retryCount: {
            increment: 1,
          },
          nextRetryAt,
          lastError: null,
        },
      });

      if (claimed.count !== 1) {
        throw new ConflictException(
          'Notification state changed while scheduling retry',
        );
      }

      await tx.event.update({
        where: { id: notification.eventId },
        data: { status: EventStatus.PROCESSING },
      });

      if (this.outboxService) {
        await tx.deliveryOutbox.upsert({
          where: { notificationId: id },
          create: {
            notificationId: id,
            nextAttemptAt: nextRetryAt,
          },
          update: {
            attempts: 0,
            lastError: null,
            nextAttemptAt: nextRetryAt,
          },
        });
      }

      const updated = await tx.notification.findUnique({
        where: { id },
        include: notificationDetailsInclude,
      });
      if (!updated) {
        throw new NotFoundException('Notification not found');
      }
      return updated;
    });

    let queuePending = false;
    if (this.queueService) {
      try {
        await this.queueService.enqueue(id, 60_000);
        await this.outboxService?.markEnqueued([id]);
      } catch {
        queuePending = true;
      }
    } else {
      queuePending = Boolean(this.outboxService);
    }

    await this.auditService?.log({
      userId,
      projectId: updatedNotification.projectId,
      action: 'notification.retry',
      resource: 'notification',
      details: {
        notificationId: id,
        retryCount: updatedNotification.retryCount,
        nextRetryAt: nextRetryAt.toISOString(),
      },
    });

    return queuePending
      ? {
          ...updatedNotification,
          queuePending: true,
        }
      : updatedNotification;
  }

  async replay(id: string, userId: string) {
    const notification = await this.findOne(id, userId);

    if (notification.status !== NotificationStatus.FAILED) {
      throw new BadRequestException(
        'Only dead-letter notifications can be replayed',
      );
    }

    const nextRetryAt = new Date();
    const updatedNotification = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.notification.updateMany({
        where: {
          id,
          status: NotificationStatus.FAILED,
          retryCount: notification.retryCount,
        },
        data: {
          status: NotificationStatus.RETRYING,
          retryCount: 0,
          nextRetryAt,
          lastError: null,
          sentAt: null,
        },
      });

      if (claimed.count !== 1) {
        throw new ConflictException(
          'Notification state changed while scheduling replay',
        );
      }

      await tx.event.update({
        where: { id: notification.eventId },
        data: { status: EventStatus.PROCESSING },
      });
      const updated = await tx.notification.findUnique({
        where: { id },
        include: notificationDetailsInclude,
      });
      if (!updated) {
        throw new NotFoundException('Notification not found');
      }
      await tx.deliveryOutbox.upsert({
        where: { notificationId: id },
        create: {
          notificationId: id,
          nextAttemptAt: nextRetryAt,
        },
        update: {
          attempts: 0,
          lastError: null,
          nextAttemptAt: nextRetryAt,
        },
      });
      return updated;
    });

    let queuePending = false;
    if (this.queueService) {
      try {
        await this.queueService.enqueue(id);
        await this.outboxService?.markEnqueued([id]);
      } catch {
        queuePending = true;
      }
    } else {
      queuePending = true;
    }

    await this.auditService?.log({
      userId,
      projectId: updatedNotification.projectId,
      action: 'notification.replay',
      resource: 'notification',
      details: {
        notificationId: id,
        nextRetryAt: nextRetryAt.toISOString(),
      },
    });

    return queuePending
      ? { ...updatedNotification, queuePending: true }
      : updatedNotification;
  }
}
