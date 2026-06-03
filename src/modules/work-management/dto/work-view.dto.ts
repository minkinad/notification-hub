import { WorkViewLayout } from '@prisma/client';
import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';

export class CreateWorkViewDto {
  @ApiProperty({
    description: 'Project identifier',
    example: 'clx1234567890',
  })
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiProperty({
    description: 'Saved view name',
    example: 'Urgent provider work',
  })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    description: 'Saved view description',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    enum: WorkViewLayout,
    required: false,
  })
  @IsOptional()
  @IsEnum(WorkViewLayout)
  layout?: WorkViewLayout;

  @ApiProperty({
    description: 'Filter payload used by clients to restore the view',
    example: {
      status: ['TODO', 'IN_PROGRESS'],
      priority: ['HIGH', 'URGENT'],
    },
    required: false,
  })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @ApiProperty({
    description: 'Whether this view is visible to other project users',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

export class UpdateWorkViewDto extends PartialType(
  OmitType(CreateWorkViewDto, ['projectId'] as const),
) {}

export class WorkViewListQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description: 'Project identifier',
    required: false,
  })
  @IsOptional()
  @IsString()
  projectId?: string;
}
