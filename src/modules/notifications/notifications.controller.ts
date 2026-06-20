import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtGuard } from '@common/guards/jwt.guard';
import { JwtUser } from '@common/types/jwt-user.interface';
import {
  DeadLetterListQueryDto,
  NotificationListQueryDto,
} from './dto/notification-list.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Version('1')
  @ApiOperation({ summary: 'List notifications for owned projects' })
  @ApiResponse({ status: 200, description: 'Notifications list retrieved' })
  async findAll(
    @CurrentUser() user: JwtUser,
    @Query() query: NotificationListQueryDto,
  ) {
    return this.notificationsService.findAll(
      user.id,
      query,
      query.skip ?? 0,
      query.take ?? 10,
    );
  }

  @Get('dead-letter')
  @Version('1')
  @ApiOperation({ summary: 'List permanently failed notifications' })
  @ApiResponse({ status: 200, description: 'Dead-letter list retrieved' })
  async findDeadLetters(
    @CurrentUser() user: JwtUser,
    @Query() query: DeadLetterListQueryDto,
  ) {
    return this.notificationsService.findDeadLetters(
      user.id,
      query,
      query.skip ?? 0,
      query.take ?? 10,
    );
  }

  @Get(':id')
  @Version('1')
  @ApiOperation({ summary: 'Get notification details' })
  @ApiResponse({ status: 200, description: 'Notification details retrieved' })
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.notificationsService.findOne(id, user.id);
  }

  @Post(':id/retry')
  @Version('1')
  @ApiOperation({ summary: 'Schedule notification retry' })
  @ApiResponse({ status: 200, description: 'Notification retry scheduled' })
  async retry(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.notificationsService.retry(id, user.id);
  }

  @Post(':id/replay')
  @Version('1')
  @ApiOperation({ summary: 'Replay a dead-letter notification' })
  @ApiResponse({ status: 200, description: 'Notification replay scheduled' })
  async replay(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.notificationsService.replay(id, user.id);
  }
}
