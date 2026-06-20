import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { envValidationSchema } from '@common/config/env.validation';
import { PrismaModule } from '@common/prisma/prisma.module';
import { RedisModule } from '@common/redis/redis.module';
import { QueueModule } from '@common/queue/queue.module';
import { AuthModule } from '@modules/auth/auth.module';
import { UsersModule } from '@modules/users/users.module';
import { ProjectsModule } from '@modules/projects/projects.module';
import { EventsModule } from '@modules/events/events.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { ChannelsModule } from '@modules/channels/channels.module';
import { HealthModule } from '@modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: envValidationSchema,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.get<number>('RATE_LIMIT_WINDOW_MS', 60000),
          limit: configService.get<number>('RATE_LIMIT_MAX_REQUESTS', 100),
        },
      ],
    }),
    PrismaModule,
    RedisModule,
    QueueModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    EventsModule,
    NotificationsModule,
    ChannelsModule,
    HealthModule,
  ],
})
export class AppModule {}
