import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtGuard } from '@common/guards/jwt.guard';
import { JwtUser } from '@common/types/jwt-user.interface';
import { CreateEventDto, EventListQueryDto } from './dto/create-event.dto';
import { IngestEventDto } from './dto/ingest-event.dto';
import { EventsService } from './events.service';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @Version('1')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Optional project-scoped key that prevents duplicate events',
    required: false,
  })
  @ApiOperation({ summary: 'Create event for owned project' })
  @ApiResponse({ status: 201, description: 'Event created successfully' })
  async create(
    @CurrentUser() user: JwtUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() createEventDto: CreateEventDto,
  ) {
    return this.eventsService.create(user.id, createEventDto, idempotencyKey);
  }

  @Post('ingest')
  @Version('1')
  @ApiHeader({
    name: 'x-api-key',
    description: 'Project API key',
    required: true,
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Optional project-scoped key that prevents duplicate events',
    required: false,
  })
  @ApiOperation({ summary: 'Ingest event using project API key' })
  @ApiResponse({ status: 201, description: 'Event ingested successfully' })
  async ingest(
    @Headers('x-api-key') apiKey: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() ingestEventDto: IngestEventDto,
  ) {
    return this.eventsService.ingest(apiKey, ingestEventDto, idempotencyKey);
  }

  @Get()
  @Version('1')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List events for owned projects' })
  @ApiResponse({ status: 200, description: 'Events list retrieved' })
  async findAll(
    @CurrentUser() user: JwtUser,
    @Query() query: EventListQueryDto,
  ) {
    return this.eventsService.findAll(
      user.id,
      query,
      query.skip ?? 0,
      query.take ?? 10,
    );
  }

  @Get(':id')
  @Version('1')
  @UseGuards(JwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get event details' })
  @ApiResponse({ status: 200, description: 'Event details retrieved' })
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.eventsService.findOne(id, user.id);
  }
}
