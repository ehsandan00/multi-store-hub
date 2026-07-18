import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'admin@hub.local' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value.toLowerCase().trim())
  email!: string;

  @ApiProperty({ example: 'Admin@123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'Hub Admin' })
  @IsString()
  @MinLength(1)
  fullName!: string;

  @ApiProperty({ enum: Role, default: Role.VIEWER })
  @IsEnum(Role)
  @IsOptional()
  role?: Role;
}

export class UpdateUserDto {
  @ApiProperty({ required: false })
  @IsString()
  @MinLength(1)
  @IsOptional()
  fullName?: string;

  @ApiProperty({ required: false, enum: Role })
  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ChangePasswordDto {
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
