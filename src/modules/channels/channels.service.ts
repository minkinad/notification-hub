import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelType, Prisma } from '@prisma/client';
import { AuditService } from '@common/audit/audit.service';
import { isPrismaUniqueConstraintError } from '@common/prisma/prisma-errors';
import { PrismaService } from '@common/prisma/prisma.service';
import { asJsonRecord, readNonEmptyString } from '@common/utils/json';
import {
  decryptSensitiveJson,
  encryptSensitiveJson,
  maskSensitiveJson,
} from '@common/utils/secrets';
import { ProjectsService } from '@modules/projects/projects.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async create(userId: string, createChannelDto: CreateChannelDto) {
    await this.projectsService.ensureOwnedProject(
      createChannelDto.projectId,
      userId,
    );
    this.assertChannelConfig(createChannelDto.type, createChannelDto.config);
    await this.ensureChannelTypeAvailable(
      createChannelDto.projectId,
      createChannelDto.type,
    );

    try {
      const channel = await this.prisma.notificationChannel.create({
        data: {
          ...createChannelDto,
          config: encryptSensitiveJson(
            createChannelDto.config,
            this.encryptionKey,
          ) as Prisma.InputJsonValue,
        },
        select: this.channelSelect,
      });
      await this.auditService?.log({
        userId,
        projectId: channel.projectId,
        action: 'channel.create',
        resource: 'notification_channel',
        details: {
          channelId: channel.id,
          type: channel.type,
          name: channel.name,
        },
      });

      return this.maskChannel(channel);
    } catch (error) {
      this.rethrowUniqueChannelConstraint(error, createChannelDto.type);
      throw error;
    }
  }

  async findAll(userId: string, projectId: string) {
    await this.projectsService.ensureOwnedProject(projectId, userId);

    const channels = await this.prisma.notificationChannel.findMany({
      where: { projectId },
      select: this.channelSelect,
      orderBy: { createdAt: 'desc' },
    });

    return channels.map((channel) => this.maskChannel(channel));
  }

  async findOne(id: string, userId: string) {
    const channel = await this.findOwnedChannelRaw(id, userId);

    return this.maskChannel(channel);
  }

  async update(id: string, userId: string, updateChannelDto: UpdateChannelDto) {
    const existingChannel = await this.findOwnedChannelRaw(id, userId);
    const shouldValidateConfig =
      updateChannelDto.type !== undefined ||
      updateChannelDto.config !== undefined;

    const data: Prisma.NotificationChannelUpdateInput = {};

    if (shouldValidateConfig) {
      const nextType = updateChannelDto.type ?? existingChannel.type;
      const nextConfig = asJsonRecord(
        updateChannelDto.config ??
          decryptSensitiveJson(existingChannel.config, this.encryptionKey),
      );
      this.assertChannelConfig(nextType, nextConfig);
    }

    if (
      updateChannelDto.type &&
      updateChannelDto.type !== existingChannel.type
    ) {
      await this.ensureChannelTypeAvailable(
        existingChannel.projectId,
        updateChannelDto.type,
        existingChannel.id,
      );
    }

    if (updateChannelDto.type) {
      data.type = updateChannelDto.type;
    }

    if (updateChannelDto.name !== undefined) {
      data.name = updateChannelDto.name;
    }

    if (updateChannelDto.active !== undefined) {
      data.active = updateChannelDto.active;
    }

    if (updateChannelDto.config !== undefined) {
      data.config = encryptSensitiveJson(
        updateChannelDto.config,
        this.encryptionKey,
      ) as Prisma.InputJsonValue;
    }

    try {
      const channel = await this.prisma.notificationChannel.update({
        where: { id },
        data,
        select: this.channelSelect,
      });
      await this.auditService?.log({
        userId,
        projectId: channel.projectId,
        action: 'channel.update',
        resource: 'notification_channel',
        changes: {
          before: this.maskChannel(existingChannel),
          after: this.maskChannel(channel),
        },
      });

      return this.maskChannel(channel);
    } catch (error) {
      this.rethrowUniqueChannelConstraint(
        error,
        updateChannelDto.type ?? existingChannel.type,
      );
      throw error;
    }
  }

  async delete(id: string, userId: string) {
    const channel = await this.findOne(id, userId);

    await this.auditService?.log({
      userId,
      projectId: channel.projectId,
      action: 'channel.delete',
      resource: 'notification_channel',
      details: {
        channelId: channel.id,
        type: channel.type,
        name: channel.name,
      },
    });

    await this.prisma.notificationChannel.delete({
      where: { id },
    });

    return {
      message: 'Channel deleted successfully',
    };
  }

  private readonly channelSelect = {
    id: true,
    projectId: true,
    type: true,
    name: true,
    config: true,
    active: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  private async findOwnedChannelRaw(id: string, userId: string) {
    const channel = await this.prisma.notificationChannel.findFirst({
      where: {
        id,
        project: {
          userId,
        },
      },
      select: this.channelSelect,
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return channel;
  }

  private maskChannel<T extends { config: unknown }>(channel: T): T {
    return {
      ...channel,
      config: maskSensitiveJson(
        decryptSensitiveJson(channel.config, this.encryptionKey),
      ),
    };
  }

  private get encryptionKey() {
    return this.configService.getOrThrow<string>(
      'CHANNEL_CONFIG_ENCRYPTION_KEY',
    );
  }

  private async ensureChannelTypeAvailable(
    projectId: string,
    type: ChannelType,
    excludeId?: string,
  ) {
    const existingChannel = await this.prisma.notificationChannel.findFirst({
      where: {
        projectId,
        type,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: {
        id: true,
      },
    });

    if (existingChannel) {
      throw new ConflictException(
        `Channel type ${type} already exists for this project`,
      );
    }
  }

  private assertChannelConfig(
    type: ChannelType,
    config: Record<string, unknown>,
  ) {
    if (type === ChannelType.EMAIL) {
      this.assertStringField(
        config,
        ['to', 'email'],
        'EMAIL channel config requires `to` or `email`',
      );
      return;
    }

    if (type === ChannelType.TELEGRAM) {
      this.assertStringField(
        config,
        ['chatId', 'username'],
        'TELEGRAM channel config requires `chatId` or `username`',
      );
      return;
    }

    if (type === ChannelType.WEBHOOK) {
      const url = this.assertStringField(
        config,
        ['url'],
        'WEBHOOK channel config requires `url`',
      );

      try {
        const parsedUrl = new URL(url);
        if (
          !['http:', 'https:'].includes(parsedUrl.protocol) ||
          parsedUrl.username ||
          parsedUrl.password
        ) {
          throw new Error('Unsupported webhook URL');
        }
      } catch {
        throw new BadRequestException(
          'WEBHOOK channel config field `url` must be an HTTP(S) URL without credentials',
        );
      }
      return;
    }

    this.assertStringField(
      config,
      ['phone'],
      'SMS channel config requires `phone`',
    );
  }

  private assertStringField(
    config: Record<string, unknown>,
    fieldNames: string[],
    errorMessage: string,
  ) {
    for (const fieldName of fieldNames) {
      const value = config[fieldName];
      const stringValue = readNonEmptyString(value);
      if (stringValue) {
        return stringValue;
      }
    }

    throw new BadRequestException(errorMessage);
  }

  private rethrowUniqueChannelConstraint(error: unknown, type: ChannelType) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new ConflictException(
        `Channel type ${type} already exists for this project`,
      );
    }
  }
}
