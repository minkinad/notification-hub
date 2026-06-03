import { WorkCycleStatus } from '@prisma/client';
import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

export class CreateWorkCycleDto {
  @ApiProperty({
    description: 'Project identifier',
    example: 'clx1234567890',
  })
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiProperty({
    description: 'Cycle name',
    example: 'Sprint 24',
  })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    description: 'Cycle description',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    enum: WorkCycleStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(WorkCycleStatus)
  status?: WorkCycleStatus;

  @ApiProperty({
    description: 'Cycle start date',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({
    description: 'Cycle end date',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateWorkCycleDto extends PartialType(
  OmitType(CreateWorkCycleDto, ['projectId'] as const),
) {}

export class WorkCycleListQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description: 'Project identifier',
    required: false,
  })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({
    enum: WorkCycleStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(WorkCycleStatus)
  status?: WorkCycleStatus;
}
