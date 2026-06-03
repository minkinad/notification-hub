import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
  CreateWorkCycleDto,
  UpdateWorkCycleDto,
  WorkCycleListQueryDto,
} from './dto/work-cycle.dto';
import {
  CreateWorkItemCommentDto,
  CreateWorkItemDto,
  UpdateWorkItemDto,
  WorkItemListQueryDto,
} from './dto/work-item.dto';
import {
  CreateWorkModuleDto,
  UpdateWorkModuleDto,
  WorkModuleListQueryDto,
} from './dto/work-module.dto';
import {
  CreateWorkViewDto,
  UpdateWorkViewDto,
  WorkViewListQueryDto,
} from './dto/work-view.dto';
import { WorkManagementService } from './work-management.service';

@ApiTags('work-management')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('work')
export class WorkManagementController {
  constructor(private readonly workManagementService: WorkManagementService) {}

  @Post('cycles')
  @Version('1')
  @ApiOperation({ summary: 'Create work cycle' })
  @ApiResponse({ status: 201, description: 'Work cycle created' })
  async createCycle(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateWorkCycleDto,
  ) {
    return this.workManagementService.createCycle(user.id, dto);
  }

  @Get('cycles')
  @Version('1')
  @ApiOperation({ summary: 'List work cycles' })
  @ApiResponse({ status: 200, description: 'Work cycles retrieved' })
  async listCycles(
    @CurrentUser() user: JwtUser,
    @Query() query: WorkCycleListQueryDto,
  ) {
    return this.workManagementService.listCycles(user.id, query);
  }

  @Get('cycles/:id')
  @Version('1')
  @ApiOperation({ summary: 'Get work cycle details' })
  @ApiResponse({ status: 200, description: 'Work cycle retrieved' })
  async findCycle(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.workManagementService.findCycle(id, user.id);
  }

  @Patch('cycles/:id')
  @Version('1')
  @ApiOperation({ summary: 'Update work cycle' })
  @ApiResponse({ status: 200, description: 'Work cycle updated' })
  async updateCycle(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateWorkCycleDto,
  ) {
    return this.workManagementService.updateCycle(id, user.id, dto);
  }

  @Delete('cycles/:id')
  @Version('1')
  @ApiOperation({ summary: 'Delete work cycle' })
  @ApiResponse({ status: 200, description: 'Work cycle deleted' })
  async deleteCycle(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.workManagementService.deleteCycle(id, user.id);
  }

  @Post('modules')
  @Version('1')
  @ApiOperation({ summary: 'Create work module' })
  @ApiResponse({ status: 201, description: 'Work module created' })
  async createModule(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateWorkModuleDto,
  ) {
    return this.workManagementService.createModule(user.id, dto);
  }

  @Get('modules')
  @Version('1')
  @ApiOperation({ summary: 'List work modules' })
  @ApiResponse({ status: 200, description: 'Work modules retrieved' })
  async listModules(
    @CurrentUser() user: JwtUser,
    @Query() query: WorkModuleListQueryDto,
  ) {
    return this.workManagementService.listModules(user.id, query);
  }

  @Get('modules/:id')
  @Version('1')
  @ApiOperation({ summary: 'Get work module details' })
  @ApiResponse({ status: 200, description: 'Work module retrieved' })
  async findModule(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.workManagementService.findModule(id, user.id);
  }

  @Patch('modules/:id')
  @Version('1')
  @ApiOperation({ summary: 'Update work module' })
  @ApiResponse({ status: 200, description: 'Work module updated' })
  async updateModule(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateWorkModuleDto,
  ) {
    return this.workManagementService.updateModule(id, user.id, dto);
  }

  @Delete('modules/:id')
  @Version('1')
  @ApiOperation({ summary: 'Delete work module' })
  @ApiResponse({ status: 200, description: 'Work module deleted' })
  async deleteModule(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.workManagementService.deleteModule(id, user.id);
  }

  @Post('items')
  @Version('1')
  @ApiOperation({ summary: 'Create work item' })
  @ApiResponse({ status: 201, description: 'Work item created' })
  async createItem(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateWorkItemDto,
  ) {
    return this.workManagementService.createItem(user.id, dto);
  }

  @Get('items')
  @Version('1')
  @ApiOperation({ summary: 'List work items' })
  @ApiResponse({ status: 200, description: 'Work items retrieved' })
  async listItems(
    @CurrentUser() user: JwtUser,
    @Query() query: WorkItemListQueryDto,
  ) {
    return this.workManagementService.listItems(user.id, query);
  }

  @Get('items/:id')
  @Version('1')
  @ApiOperation({ summary: 'Get work item details' })
  @ApiResponse({ status: 200, description: 'Work item retrieved' })
  async findItem(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.workManagementService.findItem(id, user.id);
  }

  @Patch('items/:id')
  @Version('1')
  @ApiOperation({ summary: 'Update work item' })
  @ApiResponse({ status: 200, description: 'Work item updated' })
  async updateItem(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateWorkItemDto,
  ) {
    return this.workManagementService.updateItem(id, user.id, dto);
  }

  @Delete('items/:id')
  @Version('1')
  @ApiOperation({ summary: 'Delete work item' })
  @ApiResponse({ status: 200, description: 'Work item deleted' })
  async deleteItem(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.workManagementService.deleteItem(id, user.id);
  }

  @Post('items/:id/comments')
  @Version('1')
  @ApiOperation({ summary: 'Add work item comment' })
  @ApiResponse({ status: 201, description: 'Work item comment created' })
  async addComment(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateWorkItemCommentDto,
  ) {
    return this.workManagementService.addComment(id, user.id, dto);
  }

  @Get('items/:id/comments')
  @Version('1')
  @ApiOperation({ summary: 'List work item comments' })
  @ApiResponse({ status: 200, description: 'Work item comments retrieved' })
  async listComments(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.workManagementService.listComments(id, user.id);
  }

  @Delete('items/:id/comments/:commentId')
  @Version('1')
  @ApiOperation({ summary: 'Delete work item comment' })
  @ApiResponse({ status: 200, description: 'Work item comment deleted' })
  async deleteComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.workManagementService.deleteComment(id, commentId, user.id);
  }

  @Post('views')
  @Version('1')
  @ApiOperation({ summary: 'Create saved work view' })
  @ApiResponse({ status: 201, description: 'Saved work view created' })
  async createView(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateWorkViewDto,
  ) {
    return this.workManagementService.createView(user.id, dto);
  }

  @Get('views')
  @Version('1')
  @ApiOperation({ summary: 'List saved work views' })
  @ApiResponse({ status: 200, description: 'Saved work views retrieved' })
  async listViews(
    @CurrentUser() user: JwtUser,
    @Query() query: WorkViewListQueryDto,
  ) {
    return this.workManagementService.listViews(user.id, query);
  }

  @Get('views/:id')
  @Version('1')
  @ApiOperation({ summary: 'Get saved work view details' })
  @ApiResponse({ status: 200, description: 'Saved work view retrieved' })
  async findView(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.workManagementService.findView(id, user.id);
  }

  @Patch('views/:id')
  @Version('1')
  @ApiOperation({ summary: 'Update saved work view' })
  @ApiResponse({ status: 200, description: 'Saved work view updated' })
  async updateView(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateWorkViewDto,
  ) {
    return this.workManagementService.updateView(id, user.id, dto);
  }

  @Delete('views/:id')
  @Version('1')
  @ApiOperation({ summary: 'Delete saved work view' })
  @ApiResponse({ status: 200, description: 'Saved work view deleted' })
  async deleteView(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.workManagementService.deleteView(id, user.id);
  }
}
