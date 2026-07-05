import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class PushSyncDto {
  @ApiPropertyOptional({
    description:
      'ALL = push every hub product; MAPPING = only products with an existing SiteProductMapping; PRODUCT_IDS = push the specific ids in productIds.',
    default: 'ALL',
    enum: ['ALL', 'MAPPING', 'PRODUCT_IDS'],
  })
  @IsOptional()
  @IsString()
  scope?: 'ALL' | 'MAPPING' | 'PRODUCT_IDS';

  @ApiPropertyOptional({ type: [String], description: 'Required when scope=PRODUCT_IDS' })
  @IsOptional()
  @IsString({ each: true })
  productIds?: string[];
}

export class UpdateScheduleDto {
  @ApiPropertyOptional({ description: 'Enable/disable scheduled sync for this site' })
  @IsOptional()
  syncEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Sync interval in milliseconds (60000 – 86400000)',
    example: 600000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  syncIntervalMs?: number;
}

export class ListSyncQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  siteId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
