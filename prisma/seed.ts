import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function hashApiKey(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function getApiKeyPrefix(value: string) {
  return value.slice(0, 16);
}

async function main() {
  // Clean existing data
  await prisma.workItemComment.deleteMany();
  await prisma.workItem.deleteMany();
  await prisma.workView.deleteMany();
  await prisma.workCycle.deleteMany();
  await prisma.workModule.deleteMany();
  await prisma.deliveryLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notificationChannel.deleteMany();
  await prisma.event.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  // Create seed user
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const user = await prisma.user.create({
    data: {
      email: 'admin@notification-hub.com',
      password: hashedPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
    },
  });

  console.log('Created user:', user);

  // Create seed project
  const legacyApiKey = 'test-api-key-12345';
  const project = await prisma.project.create({
    data: {
      name: 'Default Project',
      description: 'Default project for testing',
      userId: user.id,
      apiKeyHash: hashApiKey(legacyApiKey),
      apiKeyPrefix: getApiKeyPrefix(legacyApiKey),
      rateLimit: 1000,
      rateLimitWindow: 3600,
    },
  });

  console.log('Created project:', {
    ...project,
    apiKey: legacyApiKey,
  });

  const managedApiKey = 'test-managed-api-key-12345';
  const apiKey = await prisma.apiKey.create({
    data: {
      keyHash: hashApiKey(managedApiKey),
      keyPrefix: getApiKeyPrefix(managedApiKey),
      userId: user.id,
      projectId: project.id,
      name: 'Default ingest key',
      scopes: ['events:ingest'],
      rateLimit: 1000,
      rateLimitWindow: 3600,
    },
  });

  console.log('Created API key:', {
    ...apiKey,
    key: managedApiKey,
  });

  // Create notification channels
  const emailChannel = await prisma.notificationChannel.create({
    data: {
      projectId: project.id,
      type: 'EMAIL',
      name: 'Email Channel',
      config: {
        to: 'alerts@notification-hub.com',
        provider: 'smtp',
        from: 'noreply@notification-hub.com',
      },
    },
  });

  const telegramChannel = await prisma.notificationChannel.create({
    data: {
      projectId: project.id,
      type: 'TELEGRAM',
      name: 'Telegram Channel',
      config: {
        chatId: '@notification_hub_alerts',
        botToken: process.env.TELEGRAM_BOT_TOKEN || 'test-token',
      },
    },
  });

  const webhookChannel = await prisma.notificationChannel.create({
    data: {
      projectId: project.id,
      type: 'WEBHOOK',
      name: 'Webhook Channel',
      config: {
        url: 'https://example.com/webhook',
        headers: {},
      },
    },
  });

  console.log('Created channels:', {
    emailChannel,
    telegramChannel,
    webhookChannel,
  });

  const cycle = await prisma.workCycle.create({
    data: {
      projectId: project.id,
      name: 'Sprint 1',
      description: 'Initial Plane-style planning cycle',
      status: 'ACTIVE',
      startDate: new Date(),
      endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  const module = await prisma.workModule.create({
    data: {
      projectId: project.id,
      name: 'Provider integrations',
      description: 'Delivery provider roadmap',
      status: 'ACTIVE',
      targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const workItem = await prisma.workItem.create({
    data: {
      projectId: project.id,
      sequence: 1,
      title: 'Add Slack delivery provider',
      description: 'Track provider-specific implementation work in the hub.',
      status: 'TODO',
      priority: 'HIGH',
      labels: ['backend', 'provider'],
      estimate: 3,
      cycleId: cycle.id,
      moduleId: module.id,
      assigneeId: user.id,
      reporterId: user.id,
    },
  });

  await prisma.workItemComment.create({
    data: {
      workItemId: workItem.id,
      authorId: user.id,
      body: 'Seeded example comment for work item collaboration.',
    },
  });

  const view = await prisma.workView.create({
    data: {
      projectId: project.id,
      name: 'High priority backend work',
      layout: 'KANBAN',
      filters: {
        priority: ['HIGH', 'URGENT'],
        labels: ['backend'],
      },
      shared: true,
      createdById: user.id,
    },
  });

  console.log('Created work management sample:', {
    cycle,
    module,
    workItem,
    view,
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('Seed completed successfully');
  })
  .catch(async (e) => {
    console.error('Seed error:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
