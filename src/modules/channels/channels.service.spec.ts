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

  let service: ChannelsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChannelsService(prisma, projectsService);
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
    jest.spyOn(service, 'findOne').mockResolvedValue({
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
    jest.spyOn(service, 'findOne').mockResolvedValue({
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
    prisma.notificationChannel.findFirst.mockResolvedValue(null);
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
});
