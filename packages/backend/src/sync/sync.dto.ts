import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class PushSyncDto {
  @ApiPropertyOptional({
    description:
      'ALL = push every hub product; MAPPING = mapped products; PRODUCT_IDS = selected ids; PRICE_STOCK = all products but only price/stock (required for ASP.NET).',
    default: 'ALL',
    enum: ['ALL', 'MAPPING', 'PRODUCT_IDS', 'PRICE_STOCK'],
  })
  @IsOptional()
  @IsString()
  scope?: 'ALL' | 'MAPPING' | 'PRODUCT_IDS' | 'PRICE_STOCK';

  @ApiPropertyOptional({ type: [String], description: 'Required when scope=PRODUCT_IDS' })
  @IsOptional()
  @IsString({ each: true })
  productIds?: string[];
}

export class AspNetMappingRowDto {
  @IsInt()
  @Type(() => Number)
  sourceProductId!: number;

  @IsOptional()
  @IsIn(['PRODUCT', 'COMBINATION'])
  sourceKind?: 'PRODUCT' | 'COMBINATION';

  @IsString()
  sku!: string;
}

export class ImportAspNetMappingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AspNetMappingRowDto)
  rows!: AspNetMappingRowDto[];
}

export class UpdateScheduleDto {
  @ApiPropertyOptional({ description: 'Enable/disable scheduled product push sync for this site' })
  @IsOptional()
  syncEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Sync interval in milliseconds (60000 – 86400000). Applies to both push and order pull.',
    example: 600000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  syncIntervalMs?: number;

  @ApiPropertyOptional({
    description: 'Enable/disable scheduled order pull (site → hub) for this site',
  })
  @IsOptional()
  orderPullEnabled?: boolean;
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
