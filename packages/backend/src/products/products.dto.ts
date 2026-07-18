import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsIn,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ExpiryBatchInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-12-31' })
  @IsString()
  @IsNotEmpty()
  expiryDate!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;
}

export class CreateProductDto {
  @ApiProperty({ example: 'SKU-0001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  skuMaster!: string;

  @ApiProperty({ example: 'Organic Almond 500g' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'Snacks' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  category?: string;

  @ApiProperty({ example: 12.5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basePrice!: number;

  @ApiPropertyOptional({ enum: ProductType, default: ProductType.SIMPLE })
  @IsEnum(ProductType)
  @IsOptional()
  productType?: ProductType;

  @ApiPropertyOptional({ description: 'Required when productType is VARIATION' })
  @IsUUID()
  @IsOptional()
  parentId?: string;

  @ApiPropertyOptional({
    description: 'Variation attributes, e.g. { Color: "Red", Size: "L" }',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  variationAttributes?: Record<string, string>;

  /** @deprecated Use expiryBatches. Kept for import/backward compatibility. */
  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'ISO 8601' })
  @IsOptional()
  @IsString()
  expiryDate?: string | null;

  @ApiPropertyOptional({ type: [ExpiryBatchInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpiryBatchInputDto)
  expiryBatches?: ExpiryBatchInputDto[];

  @ApiPropertyOptional({ default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  totalStock?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  lowStockThreshold?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  barcode?: string;
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  category?: string | null;

  @ApiPropertyOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Min(0)
  basePrice?: number;

  /** @deprecated Use expiryBatches. */
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsString()
  expiryDate?: string | null;

  @ApiPropertyOptional({ type: [ExpiryBatchInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpiryBatchInputDto)
  expiryBatches?: ExpiryBatchInputDto[];

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  totalStock?: number;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  lowStockThreshold?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  imageUrl?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  barcode?: string | null;

  @ApiPropertyOptional({ enum: ProductType })
  @IsEnum(ProductType)
  @IsOptional()
  productType?: ProductType;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  parentId?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  variationAttributes?: Record<string, string> | null;
}

export class ListProductsQuery {
  @ApiPropertyOptional({ description: 'Full-text search on name, SKU, or barcode' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Only products with totalStock ≤ lowStockThreshold' })
  @IsOptional()
  @IsBoolean()
  lowStock?: boolean;

  @ApiPropertyOptional({ enum: ProductType })
  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;

  @ApiPropertyOptional({
    enum: ['hub', 'site', 'all'],
    default: 'hub',
    description: 'hub = central catalog only; site = hub + site-only for siteId; all = hub + site-only from all stores',
  })
  @IsOptional()
  @IsIn(['hub', 'site', 'all'])
  view?: 'hub' | 'site' | 'all';

  @ApiPropertyOptional({ description: 'Required when view=site' })
  @IsOptional()
  @IsUUID()
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

export class LookupProductQuery {
  @ApiProperty({ description: 'Barcode or SKU to look up' })
  @IsString()
  @IsNotEmpty()
  code!: string;
}
