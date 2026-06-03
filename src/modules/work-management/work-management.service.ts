import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, WorkItemStatus } from '@prisma/client';
import { AuditService } from '@common/audit/audit.service';
import { isPrismaUniqueConstraintError } from '@common/prisma/prisma-errors';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  NormalizedPagination,
  normalizePagination,
} from '@common/utils/pagination';
import { ProjectsService } from '@modules/projects/projects.service';
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

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  skip: number;
  take: number;
}

interface WorkItemRelationInput {
  cycleId?: string;
  moduleId?: string;
  assigneeId?: string;
}

@Injectable()
export class WorkManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async createCycle(userId: string, dto: CreateWorkCycleDto) {
    await this.projectsService.ensureOwnedProject(dto.projectId, userId);
    this.assertDateRange(dto.startDate, dto.endDate);

    try {
      const cycle = await this.prisma.workCycle.create({
        data: {
          projectId: dto.projectId,
          name: dto.name,
          description: dto.description,
          status: dto.status,
          startDate: this.toDate(dto.startDate),
          endDate: this.toDate(dto.endDate),
        },
        select: this.cycleSelect,
      });

      await this.auditService?.log({
        userId,
        projectId: cycle.projectId,
        action: 'work_cycle.create',
        resource: 'work_cycle',
        details: { cycleId: cycle.id, name: cycle.name },
      });

      return cycle;
    } catch (error) {
      this.rethrowUniqueName(error, 'Cycle', dto.name);
      throw error;
    }
  }

  async listCycles(userId: string, query: WorkCycleListQueryDto) {
    await this.ensureProjectFilterAccess(userId, query.projectId);

    const pagination = normalizePagination(query);
    const where: Prisma.WorkCycleWhereInput = {
      ...this.projectScopedWhere(userId, query.projectId),
      ...(query.status ? { status: query.status } : {}),
    };

    const [cycles, total] = await Promise.all([
      this.prisma.workCycle.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: [
          { status: 'asc' },
          { startDate: 'asc' },
          { createdAt: 'desc' },
        ],
        select: this.cycleSelect,
      }),
      this.prisma.workCycle.count({ where }),
    ]);

    return this.paginated(cycles, total, pagination);
  }

  async findCycle(id: string, userId: string) {
    return this.findOwnedCycle(id, userId);
  }

  async updateCycle(id: string, userId: string, dto: UpdateWorkCycleDto) {
    const existing = await this.findOwnedCycle(id, userId);
    this.assertDateRange(
      dto.startDate ?? existing.startDate?.toISOString(),
      dto.endDate ?? existing.endDate?.toISOString(),
    );

    try {
      const cycle = await this.prisma.workCycle.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          status: dto.status,
          startDate:
            dto.startDate !== undefined
              ? this.toDate(dto.startDate)
              : undefined,
          endDate:
            dto.endDate !== undefined ? this.toDate(dto.endDate) : undefined,
        },
        select: this.cycleSelect,
      });

      await this.auditService?.log({
        userId,
        projectId: cycle.projectId,
        action: 'work_cycle.update',
        resource: 'work_cycle',
        changes: { before: existing, after: cycle },
      });

      return cycle;
    } catch (error) {
      this.rethrowUniqueName(error, 'Cycle', dto.name ?? existing.name);
      throw error;
    }
  }

  async deleteCycle(id: string, userId: string) {
    const cycle = await this.findOwnedCycle(id, userId);
    await this.prisma.workCycle.delete({ where: { id } });

    await this.auditService?.log({
      userId,
      projectId: cycle.projectId,
      action: 'work_cycle.delete',
      resource: 'work_cycle',
      details: { cycleId: cycle.id, name: cycle.name },
    });

    return { message: 'Cycle deleted successfully' };
  }

  async createModule(userId: string, dto: CreateWorkModuleDto) {
    await this.projectsService.ensureOwnedProject(dto.projectId, userId);

    try {
      const module = await this.prisma.workModule.create({
        data: {
          projectId: dto.projectId,
          name: dto.name,
          description: dto.description,
          status: dto.status,
          targetDate: this.toDate(dto.targetDate),
        },
        select: this.moduleSelect,
      });

      await this.auditService?.log({
        userId,
        projectId: module.projectId,
        action: 'work_module.create',
        resource: 'work_module',
        details: { moduleId: module.id, name: module.name },
      });

      return module;
    } catch (error) {
      this.rethrowUniqueName(error, 'Module', dto.name);
      throw error;
    }
  }

  async listModules(userId: string, query: WorkModuleListQueryDto) {
    await this.ensureProjectFilterAccess(userId, query.projectId);

    const pagination = normalizePagination(query);
    const where: Prisma.WorkModuleWhereInput = {
      ...this.projectScopedWhere(userId, query.projectId),
      ...(query.status ? { status: query.status } : {}),
    };

    const [modules, total] = await Promise.all([
      this.prisma.workModule.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: [
          { status: 'asc' },
          { targetDate: 'asc' },
          { createdAt: 'desc' },
        ],
        select: this.moduleSelect,
      }),
      this.prisma.workModule.count({ where }),
    ]);

    return this.paginated(modules, total, pagination);
  }

  async findModule(id: string, userId: string) {
    return this.findOwnedModule(id, userId);
  }

  async updateModule(id: string, userId: string, dto: UpdateWorkModuleDto) {
    const existing = await this.findOwnedModule(id, userId);

    try {
      const module = await this.prisma.workModule.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          status: dto.status,
          targetDate:
            dto.targetDate !== undefined
              ? this.toDate(dto.targetDate)
              : undefined,
        },
        select: this.moduleSelect,
      });

      await this.auditService?.log({
        userId,
        projectId: module.projectId,
        action: 'work_module.update',
        resource: 'work_module',
        changes: { before: existing, after: module },
      });

      return module;
    } catch (error) {
      this.rethrowUniqueName(error, 'Module', dto.name ?? existing.name);
      throw error;
    }
  }

  async deleteModule(id: string, userId: string) {
    const module = await this.findOwnedModule(id, userId);
    await this.prisma.workModule.delete({ where: { id } });

    await this.auditService?.log({
      userId,
      projectId: module.projectId,
      action: 'work_module.delete',
      resource: 'work_module',
      details: { moduleId: module.id, name: module.name },
    });

    return { message: 'Module deleted successfully' };
  }

  async createItem(userId: string, dto: CreateWorkItemDto) {
    await this.projectsService.ensureOwnedProject(dto.projectId, userId);
    await this.assertWorkItemRelations(dto.projectId, userId, dto);

    const item = await this.prisma.$transaction(async (tx) => {
      const lastItem = await tx.workItem.findFirst({
        where: { projectId: dto.projectId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });

      return tx.workItem.create({
        data: {
          projectId: dto.projectId,
          sequence: (lastItem?.sequence ?? 0) + 1,
          title: dto.title,
          description: dto.description,
          status: dto.status,
          priority: dto.priority,
          labels: (dto.labels ?? []) as Prisma.InputJsonValue,
          estimate: dto.estimate,
          dueDate: this.toDate(dto.dueDate),
          sortOrder: dto.sortOrder,
          cycleId: dto.cycleId,
          moduleId: dto.moduleId,
          assigneeId: dto.assigneeId,
          reporterId: userId,
          completedAt: this.completedAtFor(dto.status),
        },
        select: this.itemSelect,
      });
    });

    await this.auditService?.log({
      userId,
      projectId: item.projectId,
      action: 'work_item.create',
      resource: 'work_item',
      details: { workItemId: item.id, sequence: item.sequence },
    });

    return item;
  }

  async listItems(userId: string, query: WorkItemListQueryDto) {
    await this.ensureProjectFilterAccess(userId, query.projectId);

    const pagination = normalizePagination(query);
    const where: Prisma.WorkItemWhereInput = {
      ...this.projectScopedWhere(userId, query.projectId),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.cycleId ? { cycleId: query.cycleId } : {}),
      ...(query.moduleId ? { moduleId: query.moduleId } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.workItem.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: [
          { sortOrder: 'asc' },
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
        select: this.itemSelect,
      }),
      this.prisma.workItem.count({ where }),
    ]);

    return this.paginated(items, total, pagination);
  }

  async findItem(id: string, userId: string) {
    return this.findOwnedItem(id, userId);
  }

  async updateItem(id: string, userId: string, dto: UpdateWorkItemDto) {
    const existing = await this.findOwnedItem(id, userId);
    await this.assertWorkItemRelations(existing.projectId, userId, dto);

    const item = await this.prisma.workItem.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        priority: dto.priority,
        labels:
          dto.labels !== undefined
            ? (dto.labels as Prisma.InputJsonValue)
            : undefined,
        estimate: dto.estimate,
        dueDate:
          dto.dueDate !== undefined ? this.toDate(dto.dueDate) : undefined,
        sortOrder: dto.sortOrder,
        cycleId: dto.cycleId,
        moduleId: dto.moduleId,
        assigneeId: dto.assigneeId,
        completedAt:
          dto.status !== undefined
            ? this.completedAtFor(dto.status, existing.completedAt)
            : undefined,
      },
      select: this.itemSelect,
    });

    await this.auditService?.log({
      userId,
      projectId: item.projectId,
      action: 'work_item.update',
      resource: 'work_item',
      changes: { before: existing, after: item },
    });

    return item;
  }

  async deleteItem(id: string, userId: string) {
    const item = await this.findOwnedItem(id, userId);
    await this.prisma.workItem.delete({ where: { id } });

    await this.auditService?.log({
      userId,
      projectId: item.projectId,
      action: 'work_item.delete',
      resource: 'work_item',
      details: { workItemId: item.id, sequence: item.sequence },
    });

    return { message: 'Work item deleted successfully' };
  }

  async addComment(
    workItemId: string,
    userId: string,
    dto: CreateWorkItemCommentDto,
  ) {
    const item = await this.findOwnedItem(workItemId, userId);

    const comment = await this.prisma.workItemComment.create({
      data: {
        workItemId,
        authorId: userId,
        body: dto.body,
      },
      select: this.commentSelect,
    });

    await this.auditService?.log({
      userId,
      projectId: item.projectId,
      action: 'work_item_comment.create',
      resource: 'work_item_comment',
      details: { workItemId, commentId: comment.id },
    });

    return comment;
  }

  async listComments(workItemId: string, userId: string) {
    await this.findOwnedItem(workItemId, userId);

    return this.prisma.workItemComment.findMany({
      where: { workItemId },
      orderBy: { createdAt: 'asc' },
      select: this.commentSelect,
    });
  }

  async deleteComment(workItemId: string, commentId: string, userId: string) {
    const item = await this.findOwnedItem(workItemId, userId);
    const comment = await this.prisma.workItemComment.findFirst({
      where: {
        id: commentId,
        workItemId,
      },
      select: this.commentSelect,
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    await this.prisma.workItemComment.delete({ where: { id: commentId } });

    await this.auditService?.log({
      userId,
      projectId: item.projectId,
      action: 'work_item_comment.delete',
      resource: 'work_item_comment',
      details: { workItemId, commentId },
    });

    return { message: 'Comment deleted successfully' };
  }

  async createView(userId: string, dto: CreateWorkViewDto) {
    await this.projectsService.ensureOwnedProject(dto.projectId, userId);

    try {
      const view = await this.prisma.workView.create({
        data: {
          projectId: dto.projectId,
          name: dto.name,
          description: dto.description,
          layout: dto.layout,
          filters: (dto.filters ?? {}) as Prisma.InputJsonValue,
          shared: dto.shared,
          createdById: userId,
        },
        select: this.viewSelect,
      });

      await this.auditService?.log({
        userId,
        projectId: view.projectId,
        action: 'work_view.create',
        resource: 'work_view',
        details: { viewId: view.id, name: view.name },
      });

      return view;
    } catch (error) {
      this.rethrowUniqueName(error, 'View', dto.name);
      throw error;
    }
  }

  async listViews(userId: string, query: WorkViewListQueryDto) {
    await this.ensureProjectFilterAccess(userId, query.projectId);

    const pagination = normalizePagination(query);
    const where: Prisma.WorkViewWhereInput = {
      ...this.projectScopedWhere(userId, query.projectId),
    };

    const [views, total] = await Promise.all([
      this.prisma.workView.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { createdAt: 'desc' },
        select: this.viewSelect,
      }),
      this.prisma.workView.count({ where }),
    ]);

    return this.paginated(views, total, pagination);
  }

  async findView(id: string, userId: string) {
    return this.findOwnedView(id, userId);
  }

  async updateView(id: string, userId: string, dto: UpdateWorkViewDto) {
    const existing = await this.findOwnedView(id, userId);

    try {
      const view = await this.prisma.workView.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          layout: dto.layout,
          filters:
            dto.filters !== undefined
              ? (dto.filters as Prisma.InputJsonValue)
              : undefined,
          shared: dto.shared,
        },
        select: this.viewSelect,
      });

      await this.auditService?.log({
        userId,
        projectId: view.projectId,
        action: 'work_view.update',
        resource: 'work_view',
        changes: { before: existing, after: view },
      });

      return view;
    } catch (error) {
      this.rethrowUniqueName(error, 'View', dto.name ?? existing.name);
      throw error;
    }
  }

  async deleteView(id: string, userId: string) {
    const view = await this.findOwnedView(id, userId);
    await this.prisma.workView.delete({ where: { id } });

    await this.auditService?.log({
      userId,
      projectId: view.projectId,
      action: 'work_view.delete',
      resource: 'work_view',
      details: { viewId: view.id, name: view.name },
    });

    return { message: 'View deleted successfully' };
  }

  private async ensureProjectFilterAccess(userId: string, projectId?: string) {
    if (projectId) {
      await this.projectsService.ensureOwnedProject(projectId, userId);
    }
  }

  private projectScopedWhere(userId: string, projectId?: string) {
    return {
      project: {
        userId,
      },
      ...(projectId ? { projectId } : {}),
    };
  }

  private paginated<T>(
    data: T[],
    total: number,
    pagination: NormalizedPagination,
  ): PaginatedResult<T> {
    return {
      data,
      total,
      skip: pagination.skip,
      take: pagination.take,
    };
  }

  private readonly cycleSelect = {
    id: true,
    projectId: true,
    name: true,
    description: true,
    status: true,
    startDate: true,
    endDate: true,
    createdAt: true,
    updatedAt: true,
    _count: {
      select: {
        workItems: true,
      },
    },
  } as const;

  private readonly moduleSelect = {
    id: true,
    projectId: true,
    name: true,
    description: true,
    status: true,
    targetDate: true,
    createdAt: true,
    updatedAt: true,
    _count: {
      select: {
        workItems: true,
      },
    },
  } as const;

  private readonly itemSelect = {
    id: true,
    projectId: true,
    sequence: true,
    title: true,
    description: true,
    status: true,
    priority: true,
    labels: true,
    estimate: true,
    dueDate: true,
    sortOrder: true,
    cycleId: true,
    moduleId: true,
    assigneeId: true,
    reporterId: true,
    completedAt: true,
    createdAt: true,
    updatedAt: true,
    cycle: {
      select: {
        id: true,
        name: true,
        status: true,
      },
    },
    module: {
      select: {
        id: true,
        name: true,
        status: true,
      },
    },
    assignee: {
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    },
    reporter: {
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    },
    _count: {
      select: {
        comments: true,
      },
    },
  } as const;

  private readonly commentSelect = {
    id: true,
    workItemId: true,
    body: true,
    createdAt: true,
    updatedAt: true,
    author: {
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    },
  } as const;

  private readonly viewSelect = {
    id: true,
    projectId: true,
    name: true,
    description: true,
    layout: true,
    filters: true,
    shared: true,
    createdAt: true,
    updatedAt: true,
    createdBy: {
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    },
  } as const;

  private async findOwnedCycle(id: string, userId: string) {
    const cycle = await this.prisma.workCycle.findFirst({
      where: {
        id,
        project: {
          userId,
        },
      },
      select: this.cycleSelect,
    });

    if (!cycle) {
      throw new NotFoundException('Cycle not found');
    }

    return cycle;
  }

  private async findOwnedModule(id: string, userId: string) {
    const module = await this.prisma.workModule.findFirst({
      where: {
        id,
        project: {
          userId,
        },
      },
      select: this.moduleSelect,
    });

    if (!module) {
      throw new NotFoundException('Module not found');
    }

    return module;
  }

  private async findOwnedItem(id: string, userId: string) {
    const item = await this.prisma.workItem.findFirst({
      where: {
        id,
        project: {
          userId,
        },
      },
      select: this.itemSelect,
    });

    if (!item) {
      throw new NotFoundException('Work item not found');
    }

    return item;
  }

  private async findOwnedView(id: string, userId: string) {
    const view = await this.prisma.workView.findFirst({
      where: {
        id,
        project: {
          userId,
        },
      },
      select: this.viewSelect,
    });

    if (!view) {
      throw new NotFoundException('View not found');
    }

    return view;
  }

  private async assertWorkItemRelations(
    projectId: string,
    userId: string,
    dto: WorkItemRelationInput,
  ) {
    if (dto.assigneeId && dto.assigneeId !== userId) {
      throw new BadRequestException(
        'Assignee must be the project owner until project membership is enabled',
      );
    }

    await Promise.all([
      dto.cycleId
        ? this.ensureCycleBelongsToProject(dto.cycleId, projectId)
        : undefined,
      dto.moduleId
        ? this.ensureModuleBelongsToProject(dto.moduleId, projectId)
        : undefined,
    ]);
  }

  private async ensureCycleBelongsToProject(
    cycleId: string,
    projectId: string,
  ) {
    const cycle = await this.prisma.workCycle.findFirst({
      where: {
        id: cycleId,
        projectId,
      },
      select: {
        id: true,
      },
    });

    if (!cycle) {
      throw new BadRequestException('Cycle does not belong to this project');
    }
  }

  private async ensureModuleBelongsToProject(
    moduleId: string,
    projectId: string,
  ) {
    const module = await this.prisma.workModule.findFirst({
      where: {
        id: moduleId,
        projectId,
      },
      select: {
        id: true,
      },
    });

    if (!module) {
      throw new BadRequestException('Module does not belong to this project');
    }
  }

  private assertDateRange(startDate?: string, endDate?: string) {
    if (!startDate || !endDate) {
      return;
    }

    if (new Date(startDate).getTime() > new Date(endDate).getTime()) {
      throw new BadRequestException('Cycle start date must be before end date');
    }
  }

  private toDate(value?: string) {
    return value ? new Date(value) : undefined;
  }

  private completedAtFor(status?: WorkItemStatus, existing?: Date | null) {
    if (!status) {
      return undefined;
    }

    if (status === WorkItemStatus.DONE) {
      return existing ?? new Date();
    }

    return null;
  }

  private rethrowUniqueName(error: unknown, resource: string, name: string) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new ConflictException(
        `${resource} named ${name} already exists for this project`,
      );
    }
  }
}
