import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Max,
} from 'class-validator';

export class ExportProductsQuery {
  @ApiPropertyOptional({ description: 'Filter by exact category (case-insensitive)' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter to products mapped to a specific site' })
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @ApiPropertyOptional({ description: 'Minimum totalStock (inclusive)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minStock?: number;

  @ApiPropertyOptional({ description: 'Maximum totalStock (inclusive)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxStock?: number;

  @ApiPropertyOptional({
    description: 'If set, produce a WooCommerce-import-ready CSV for this site instead of the full hub export.',
  })
  @IsOptional()
  @IsUUID()
  wooCommerceForSiteId?: string;
}

export class ListImportJobsQuery {
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
  @Max(100)
  pageSize?: number;
}
