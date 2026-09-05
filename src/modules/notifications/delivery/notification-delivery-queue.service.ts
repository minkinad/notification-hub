import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  NOTIFICATION_DELIVERY_QUEUE,
  NotificationDeliveryJob,
} from './notification-delivery.constants';

@Injectable()
export class NotificationDeliveryQueueService {
  constructor(
    @InjectQueue(NOTIFICATION_DELIVERY_QUEUE)
    private readonly queue: Queue<NotificationDeliveryJob>,
  ) {}

  async enqueue(notificationId: string, scheduleId: string, delay = 0) {
    return this.queue.add(
      'deliver',
      { notificationId },
      {
        jobId: scheduleId,
        delay,
        attempts: 1,
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }
}
