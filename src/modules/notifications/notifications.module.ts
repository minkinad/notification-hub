import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '@common/audit/audit.module';
import { PrismaModule } from '@common/prisma/prisma.module';
import { QueueModule } from '@common/queue/queue.module';
import { NOTIFICATION_DELIVERY_QUEUE } from './delivery/notification-delivery.constants';
import { NotificationDeliveryOutboxService } from './delivery/notification-delivery-outbox.service';
import { NotificationDeliveryProcessor } from './delivery/notification-delivery.processor';
import { NotificationDeliveryQueueService } from './delivery/notification-delivery-queue.service';
import { NotificationDeliveryService } from './delivery/notification-delivery.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    QueueModule,
    BullModule.registerQueue({
      name: NOTIFICATION_DELIVERY_QUEUE,
    }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationDeliveryOutboxService,
    NotificationDeliveryProcessor,
    NotificationDeliveryQueueService,
    NotificationDeliveryService,
  ],
  exports: [NotificationsService, NotificationDeliveryOutboxService],
})
export class NotificationsModule {}
