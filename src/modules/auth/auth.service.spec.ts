import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  } as any;

  const jwtService = {
    sign: jest.fn().mockReturnValue('jwt-token'),
  } as any;

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(prisma, jwtService);
  });

  it('normalizes email during registration', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      firstName: 'Owner',
      lastName: 'User',
      role: Role.USER,
    });

    await service.register({
      email: '  OWNER@Example.com  ',
      password: 'password123',
      firstName: 'Owner',
      lastName: 'User',
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'owner@example.com' },
    });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'owner@example.com',
        }),
      }),
    );
  });

  it('translates unique constraint collisions into a bad request', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.register({
        email: 'owner@example.com',
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes email during login', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      password: await bcrypt.hash('password123', 1),
      role: Role.USER,
      active: true,
    });

    await service.login({
      email: '  OWNER@Example.com ',
      password: 'password123',
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'owner@example.com' },
    });
  });

  it('rejects invalid credentials', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'owner@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
