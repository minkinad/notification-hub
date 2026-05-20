import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChannelType, Prisma } from '@prisma/client';
import { isPrismaUniqueConstraintError } from '@common/prisma/prisma-errors';
import { PrismaService } from '@common/prisma/prisma.service';
import { ProjectsService } from '@modules/projects/projects.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
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
      return await this.prisma.notificationChannel.create({
        data: {
          ...createChannelDto,
          config: createChannelDto.config as Prisma.InputJsonValue,
        },
        select: this.channelSelect,
      });
    } catch (error) {
      this.rethrowUniqueChannelConstraint(error, createChannelDto.type);
      throw error;
    }
  }

  async findAll(userId: string, projectId: string) {
    await this.projectsService.ensureOwnedProject(projectId, userId);

    return this.prisma.notificationChannel.findMany({
      where: { projectId },
      select: this.channelSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
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

  async update(id: string, userId: string, updateChannelDto: UpdateChannelDto) {
    const existingChannel = await this.findOne(id, userId);
    const shouldValidateConfig =
      updateChannelDto.type !== undefined ||
      updateChannelDto.config !== undefined;

    const data: Prisma.NotificationChannelUpdateInput = {};

    if (shouldValidateConfig) {
      const nextType = updateChannelDto.type ?? existingChannel.type;
      const nextConfig = this.asRecord(
        updateChannelDto.config ?? existingChannel.config,
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
      data.config = updateChannelDto.config as Prisma.InputJsonValue;
    }

    try {
      return await this.prisma.notificationChannel.update({
        where: { id },
        data,
        select: this.channelSelect,
      });
    } catch (error) {
      this.rethrowUniqueChannelConstraint(
        error,
        updateChannelDto.type ?? existingChannel.type,
      );
      throw error;
    }
  }

  async delete(id: string, userId: string) {
    await this.findOne(id, userId);

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
        new URL(url);
      } catch {
        throw new BadRequestException(
          'WEBHOOK channel config field `url` must be a valid URL',
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
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    throw new BadRequestException(errorMessage);
  }

  private asRecord(value: Prisma.JsonValue | Record<string, unknown>) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private rethrowUniqueChannelConstraint(
    error: unknown,
    type: ChannelType,
  ) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new ConflictException(
        `Channel type ${type} already exists for this project`,
      );
    }
  }
}
