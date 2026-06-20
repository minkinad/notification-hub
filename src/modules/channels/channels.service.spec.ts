import { BadRequestException, ConflictException } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { ChannelsService } from './channels.service';

describe('ChannelsService', () => {
  const prisma = {
    notificationChannel: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  } as any;

  const projectsService = {
    ensureOwnedProject: jest.fn(),
  } as any;
  const configService = {
    getOrThrow: jest
      .fn()
      .mockReturnValue('unit-test-channel-config-key-with-32-characters'),
  } as any;

  let service: ChannelsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.notificationChannel.create.mockReset();
    prisma.notificationChannel.findFirst.mockReset();
    prisma.notificationChannel.update.mockReset();
    service = new ChannelsService(prisma, projectsService, configService);
  });

  it('rejects invalid webhook config before persisting', async () => {
    await expect(
      service.create('user-1', {
        projectId: 'project-1',
        type: ChannelType.WEBHOOK,
        name: 'Webhook',
        config: {
          url: 'not-a-url',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.notificationChannel.create).not.toHaveBeenCalled();
  });

  it('rejects webhook URLs with unsupported protocols or credentials', async () => {
    await expect(
      service.create('user-1', {
        projectId: 'project-1',
        type: ChannelType.WEBHOOK,
        name: 'Unsafe webhook',
        config: {
          url: 'ftp://user:password@example.com/hook',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.notificationChannel.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate channel type for a project', async () => {
    prisma.notificationChannel.findFirst.mockResolvedValue({
      id: 'existing-channel',
    });

    await expect(
      service.create('user-1', {
        projectId: 'project-1',
        type: ChannelType.EMAIL,
        name: 'Email',
        config: {
          to: 'alerts@example.com',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('translates database unique conflicts into a domain conflict', async () => {
    prisma.notificationChannel.findFirst.mockResolvedValue(null);
    prisma.notificationChannel.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.create('user-1', {
        projectId: 'project-1',
        type: ChannelType.EMAIL,
        name: 'Email',
        config: {
          to: 'alerts@example.com',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('validates merged type and config on update', async () => {
    prisma.notificationChannel.findFirst.mockResolvedValue({
      id: 'channel-1',
      projectId: 'project-1',
      type: ChannelType.EMAIL,
      name: 'Email',
      config: {
        to: 'alerts@example.com',
      },
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      service.update('channel-1', 'user-1', {
        type: ChannelType.SMS,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.notificationChannel.update).not.toHaveBeenCalled();
  });

  it('translates update unique conflicts into a domain conflict', async () => {
    prisma.notificationChannel.findFirst
      .mockResolvedValueOnce({
        id: 'channel-1',
        projectId: 'project-1',
        type: ChannelType.EMAIL,
        name: 'Email',
        config: {
          to: 'alerts@example.com',
        },
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce(null);
    prisma.notificationChannel.update.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.update('channel-1', 'user-1', {
        type: ChannelType.SMS,
        config: {
          phone: '+10000000000',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('masks sensitive config values in channel responses', async () => {
    prisma.notificationChannel.findFirst.mockResolvedValue({
      id: 'channel-1',
      projectId: 'project-1',
      type: ChannelType.TELEGRAM,
      name: 'Telegram',
      config: {
        chatId: '@alerts',
        botToken: 'very-secret-token',
      },
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.findOne('channel-1', 'user-1');

    expect(result.config).toEqual({
      chatId: '@alerts',
      botToken: 'very...oken',
    });
  });

  it('encrypts sensitive config values before persistence', async () => {
    prisma.notificationChannel.create.mockResolvedValue({
      id: 'channel-1',
      projectId: 'project-1',
      type: ChannelType.TELEGRAM,
      name: 'Telegram',
      config: {
        chatId: '@alerts',
        botToken: 'very-secret-token',
      },
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create('user-1', {
      projectId: 'project-1',
      type: ChannelType.TELEGRAM,
      name: 'Telegram',
      config: {
        chatId: '@alerts',
        botToken: 'very-secret-token',
      },
    });

    const persistedConfig =
      prisma.notificationChannel.create.mock.calls[0][0].data.config;
    expect(JSON.stringify(persistedConfig)).not.toContain('very-secret-token');
    expect(result.config).toEqual({
      chatId: '@alerts',
      botToken: 'very...oken',
    });
  });
});
