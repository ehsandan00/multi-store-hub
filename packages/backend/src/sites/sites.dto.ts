import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import { NetworkRoute } from '@prisma/client';

export class CreateSiteDto {
  @ApiProperty({ example: 'IR-hosted store' })
  @IsString()
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({ example: 'https://store.example.ir' })
  @IsString()
  @IsNotEmpty()
  baseUrl!: string;

  @ApiProperty({ example: 'ck_consumer_key' })
  @IsString()
  @IsNotEmpty()
  consumerKey!: string;

  @ApiProperty({ example: 'cs_consumer_secret' })
  @IsString()
  @IsNotEmpty()
  consumerSecret!: string;

  @ApiProperty({ enum: NetworkRoute, default: NetworkRoute.DIRECT })
  @IsEnum(NetworkRoute)
  @IsOptional()
  networkRoute?: NetworkRoute;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateSiteDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  baseUrl?: string;

  @ApiPropertyOptional({ description: 'Omit to keep existing value' })
  @IsString()
  @IsOptional()
  consumerKey?: string;

  @ApiPropertyOptional({ description: 'Omit to keep existing value' })
  @IsString()
  @IsOptional()
  consumerSecret?: string;

  @ApiPropertyOptional({ enum: NetworkRoute })
  @IsEnum(NetworkRoute)
  @IsOptional()
  networkRoute?: NetworkRoute;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Phase 3: enable scheduled sync (admin also via /sync/sites/:id/schedule).' })
  @IsBoolean()
  @IsOptional()
  syncEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Sync interval in ms (60000 – 86400000).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  syncIntervalMs?: number;
}

export class ListSitesQuery {
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

export interface SafeSite {
  id: string;
  name: string;
  baseUrl: string;
  consumerKeyMasked: string;
  consumerSecretMasked: string;
  networkRoute: NetworkRoute;
  isActive: boolean;
  syncEnabled: boolean;
  syncIntervalMs: number;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
