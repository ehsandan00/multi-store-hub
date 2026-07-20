import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListCustomersQuery {
  @ApiProperty({ description: 'Required — customers are always scoped to one site.' })
  @IsString()
  siteId!: string;

  @ApiPropertyOptional({ description: 'Search name, email, or phone' })
  @IsOptional()
  @IsString()
  search?: string;

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

  @ApiPropertyOptional({ enum: ['name', 'totalOrdersCount', 'totalSpent', 'createdAt'] })
  @IsOptional()
  @IsIn(['name', 'totalOrdersCount', 'totalSpent', 'createdAt'])
  sortBy?: 'name' | 'totalOrdersCount' | 'totalSpent' | 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
