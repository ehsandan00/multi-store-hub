import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const LOGISTICS_STATUSES = ['SENT', 'NEED_PRODUCT', 'CANCELED'] as const;
export type LogisticsStatus = (typeof LOGISTICS_STATUSES)[number];

export class LogisticsOrderItemDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 1, maximum: 9999 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  quantity!: number;
}

export class CreateLogisticsOrderDto {
  @ApiProperty({ description: 'Hub user assigned to this logistics order' })
  @IsUUID()
  employeeId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  receiverName!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ enum: LOGISTICS_STATUSES })
  @IsIn(LOGISTICS_STATUSES)
  status!: LogisticsStatus;

  @ApiProperty({ type: [LogisticsOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LogisticsOrderItemDto)
  items!: LogisticsOrderItemDto[];
}

export class UpdateLogisticsOrderStatusDto {
  @ApiProperty({ enum: LOGISTICS_STATUSES })
  @IsIn(LOGISTICS_STATUSES)
  status!: LogisticsStatus;
}

export class ListLogisticsOrdersQuery {
  @ApiPropertyOptional({ enum: LOGISTICS_STATUSES })
  @IsOptional()
  @IsIn(LOGISTICS_STATUSES)
  status?: LogisticsStatus;

  @ApiPropertyOptional({ description: 'Receiver, phone, city, order number, product, or SKU' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
