import { Type } from 'class-transformer';
import { WorkItemPriority, WorkItemStatus } from '@prisma/client';
import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

export class CreateWorkItemDto {
  @ApiProperty({
    description: 'Project identifier',
    example: 'clx1234567890',
  })
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiProperty({
    description: 'Work item title',
    example: 'Add Slack delivery provider',
  })
  @IsString()
  @MaxLength(180)
  title!: string;

  @ApiProperty({
    description: 'Work item description',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiProperty({
    enum: WorkItemStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(WorkItemStatus)
  status?: WorkItemStatus;

  @ApiProperty({
    enum: WorkItemPriority,
    required: false,
  })
  @IsOptional()
  @IsEnum(WorkItemPriority)
  priority?: WorkItemPriority;

  @ApiProperty({
    description: 'Labels attached to the work item',
    example: ['backend', 'provider'],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labels?: string[];

  @ApiProperty({
    description: 'Estimate in story points',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  estimate?: number;

  @ApiProperty({
    description: 'Due date',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({
    description: 'Manual ordering value',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;

  @ApiProperty({
    description: 'Cycle identifier',
    required: false,
  })
  @IsOptional()
  @IsString()
  cycleId?: string;

  @ApiProperty({
    description: 'Module identifier',
    required: false,
  })
  @IsOptional()
  @IsString()
  moduleId?: string;

  @ApiProperty({
    description: 'Assignee user identifier',
    required: false,
  })
  @IsOptional()
  @IsString()
  assigneeId?: string;
}

export class UpdateWorkItemDto extends PartialType(
  OmitType(CreateWorkItemDto, ['projectId'] as const),
) {}

export class WorkItemListQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description: 'Project identifier',
    required: false,
  })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({
    enum: WorkItemStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(WorkItemStatus)
  status?: WorkItemStatus;

  @ApiProperty({
    enum: WorkItemPriority,
    required: false,
  })
  @IsOptional()
  @IsEnum(WorkItemPriority)
  priority?: WorkItemPriority;

  @ApiProperty({
    description: 'Cycle identifier',
    required: false,
  })
  @IsOptional()
  @IsString()
  cycleId?: string;

  @ApiProperty({
    description: 'Module identifier',
    required: false,
  })
  @IsOptional()
  @IsString()
  moduleId?: string;

  @ApiProperty({
    description: 'Assignee user identifier',
    required: false,
  })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiProperty({
    description: 'Case-insensitive title/description search',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateWorkItemCommentDto {
  @ApiProperty({
    description: 'Comment body',
    example: 'This should ship with provider-level retry metadata.',
  })
  @IsString()
  @MaxLength(5000)
  body!: string;
}
