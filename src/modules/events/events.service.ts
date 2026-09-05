import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  ChannelType,
  DeliveryOutbox,
  Event,
  EventStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '@common/audit/audit.service';
import { isPrismaUniqueConstraintError } from '@common/prisma/prisma-errors';
import { PrismaService } from '@common/prisma/prisma.service';
import { ProjectRateLimitService } from '@common/rate-limit/project-rate-limit.service';
import {
  asJsonRecord,
  readNonEmptyString,
  readStringArray,
} from '@common/utils/json';
import { normalizePagination } from '@common/utils/pagination';
import { NotificationDeliveryOutboxService } from '@modules/notifications/delivery/notification-delivery-outbox.service';
import { ProjectsService } from '@modules/projects/projects.service';
import { CreateEventDto, EventListQueryDto } from './dto/create-event.dto';
import { IngestEventDto } from './dto/ingest-event.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly outboxService: NotificationDeliveryOutboxService,
    private readonly rateLimitService: ProjectRateLimitService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async create(
    userId: string,
    createEventDto: CreateEventDto,
    idempotencyKey?: string,
  ) {
    await this.projectsService.ensureOwnedProject(
      createEventDto.projectId,
      userId,
    );

    const event = await this.createEventRecord(
      createEventDto.projectId,
      {
        type: createEventDto.type,
        data: createEventDto.data,
      },
      this.normalizeIdempotencyKey(idempotencyKey),
    );

    await this.auditService?.log({
      userId,
      projectId: createEventDto.projectId,
      action: 'event.create',
      resource: 'event',
      details: {
        eventId: event.id,
        type: event.type,
        notificationsCreated: event.notificationsCreated,
      },
    });

    return event;
  }

  async ingest(
    apiKey: string | undefined,
    ingestEventDto: IngestEventDto,
    idempotencyKey?: string,
  ) {
    if (!apiKey?.trim()) {
      throw new BadRequestException('Project API key is required');
    }

    const verification = await this.projectsService.verifyApiKey(apiKey);

    if (!verification) {
      throw new BadRequestException('Invalid or inactive project API key');
    }

    const { project, apiKey: managedApiKey } = verification;
    const scopes = readStringArray(managedApiKey?.scopes);

    if (managedApiKey && !scopes.includes('events:ingest')) {
      throw new BadRequestException('API key is not allowed to ingest events');
    }

    await this.rateLimitService.consume({
      projectId: project.id,
      apiKeyId: managedApiKey?.id,
      limit: managedApiKey?.rateLimit ?? project.rateLimit,
      windowSeconds: managedApiKey?.rateLimitWindow ?? project.rateLimitWindow,
    });

    const event = await this.createEventRecord(
      project.id,
      ingestEventDto,
      this.normalizeIdempotencyKey(idempotencyKey),
    );

    await this.auditService?.log({
      userId: project.userId,
      projectId: project.id,
      action: managedApiKey ? 'event.ingest' : 'event.ingest_legacy_api_key',
      resource: 'event',
      details: {
        eventId: event.id,
        type: event.type,
        apiKeyId: managedApiKey?.id ?? null,
        notificationsCreated: event.notificationsCreated,
      },
    });

    return event;
  }

  async findAll(userId: string, query: EventListQueryDto, skip = 0, take = 10) {
    const pagination = normalizePagination({ skip, take });
    const where: Prisma.EventWhereInput = {
      project: {
        userId,
      },
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [events, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { createdAt: 'desc' },
        include: {
          notifications: {
            select: {
              id: true,
              status: true,
              channelId: true,
              recipient: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      data: events,
      total,
      skip: pagination.skip,
      take: pagination.take,
    };
  }

  async findOne(id: string, userId: string) {
    const event = await this.prisma.event.findFirst({
      where: {
        id,
        project: {
          userId,
        },
      },
      include: {
        notifications: {
          include: {
            channel: {
              select: {
                id: true,
                type: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return event;
  }

  private async createEventRecord(
    projectId: string,
    payload: { type: string; data: Record<string, unknown> },
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const existingEvent = await this.findIdempotentEvent(
        projectId,
        idempotencyKey,
      );
      if (existingEvent) {
        return existingEvent;
      }
    }

    let result: {
      event: Event;
      notificationsCreated: number;
      outboxEntries: DeliveryOutbox[];
    };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const channels = await tx.notificationChannel.findMany({
          where: {
            projectId,
            active: true,
          },
        });

        const createdEvent = await tx.event.create({
          data: {
            projectId,
            ...(idempotencyKey ? { idempotencyKey } : {}),
            type: payload.type,
            data: payload.data as Prisma.InputJsonValue,
            status:
              channels.length > 0
                ? EventStatus.PROCESSING
                : EventStatus.PENDING,
          },
        });

        const outboxEntries: DeliveryOutbox[] = [];
        if (channels.length > 0) {
          const notifications = await Promise.all(
            channels.map((channel) =>
              tx.notification.create({
                data: {
                  projectId,
                  eventId: createdEvent.id,
                  channelId: channel.id,
                  recipient: this.resolveRecipient(
                    channel.type,
                    channel.config,
                  ),
                  subject: this.resolveSubject(channel.type, payload.type),
                  template: payload.type,
                  templateData: payload.data as Prisma.InputJsonValue,
                },
                select: {
                  id: true,
                },
              }),
            ),
          );
          for (const notification of notifications) {
            outboxEntries.push(
              await this.outboxService.schedule(tx, notification.id),
            );
          }
        }

        return {
          event: createdEvent,
          notificationsCreated: channels.length,
          outboxEntries,
        };
      });
    } catch (error) {
      if (idempotencyKey && isPrismaUniqueConstraintError(error)) {
        const existingEvent = await this.findIdempotentEvent(
          projectId,
          idempotencyKey,
        );
        if (existingEvent) {
          return existingEvent;
        }
      }
      throw error;
    }

    const dispatch = await this.outboxService.dispatch(result.outboxEntries);
    return {
      ...result.event,
      notificationsCreated: result.notificationsCreated,
      notificationsQueued: dispatch.queued,
      ...(dispatch.pending > 0
        ? { notificationsQueuePending: dispatch.pending }
        : {}),
    };
  }

  private async findIdempotentEvent(projectId: string, idempotencyKey: string) {
    const existingEvent = await this.prisma.event.findUnique({
      where: {
        projectId_idempotencyKey: {
          projectId,
          idempotencyKey,
        },
      },
      include: {
        notifications: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!existingEvent) {
      return null;
    }

    const { notifications, ...event } = existingEvent;
    return {
      ...event,
      notificationsCreated: notifications.length,
      notificationsQueued: 0,
      idempotentReplay: true,
    };
  }

  private normalizeIdempotencyKey(value?: string) {
    if (value === undefined) {
      return undefined;
    }

    const normalized = value.trim();
    if (!normalized) {
      throw new BadRequestException('Idempotency-Key cannot be empty');
    }
    if (normalized.length > 255) {
      throw new BadRequestException(
        'Idempotency-Key cannot exceed 255 characters',
      );
    }

    return normalized;
  }

  private resolveRecipient(
    channelType: ChannelType,
    config: Prisma.JsonValue,
  ): string {
    const typedConfig = asJsonRecord(config);

    if (channelType === ChannelType.EMAIL) {
      return (
        readNonEmptyString(typedConfig.to) ??
        readNonEmptyString(typedConfig.email) ??
        'unconfigured-email'
      );
    }

    if (channelType === ChannelType.TELEGRAM) {
      return (
        readNonEmptyString(typedConfig.chatId) ??
        readNonEmptyString(typedConfig.username) ??
        'unconfigured-chat'
      );
    }

    if (channelType === ChannelType.WEBHOOK) {
      return readNonEmptyString(typedConfig.url) ?? 'unconfigured-webhook';
    }

    return readNonEmptyString(typedConfig.phone) ?? 'unconfigured-recipient';
  }

  private resolveSubject(
    channelType: ChannelType,
    eventType: string,
  ): string | null {
    if (channelType === ChannelType.WEBHOOK) {
      return null;
    }

    return `Notification for ${eventType}`;
  }
}
