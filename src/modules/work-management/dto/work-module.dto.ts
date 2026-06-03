import { WorkModuleStatus } from '@prisma/client';
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

export class CreateWorkModuleDto {
  @ApiProperty({
    description: 'Project identifier',
    example: 'clx1234567890',
  })
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiProperty({
    description: 'Module name',
    example: 'Billing revamp',
  })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    description: 'Module description',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    enum: WorkModuleStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(WorkModuleStatus)
  status?: WorkModuleStatus;

  @ApiProperty({
    description: 'Target completion date',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  targetDate?: string;
}

export class UpdateWorkModuleDto extends PartialType(
  OmitType(CreateWorkModuleDto, ['projectId'] as const),
) {}

export class WorkModuleListQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description: 'Project identifier',
    required: false,
  })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({
    enum: WorkModuleStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(WorkModuleStatus)
  status?: WorkModuleStatus;
}
