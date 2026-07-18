import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { UsersService, type SafeUser } from './users.service';
import { ChangePasswordDto, CreateUserDto, UpdateUserDto } from './users.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';

@ApiTags('users')
@ApiBearerAuth('access-token')
@Controller('users')
@Roles('ADMIN')
@UseInterceptors(AuditInterceptor)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all users (admin only)' })
  list(): Promise<SafeUser[]> {
    return this.users.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by id (admin only)' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SafeUser> {
    return this.users.get(id);
  }

  @Post()
  @Audit('USER_CREATE')
  @ApiOperation({ summary: 'Create a user (admin only)' })
  create(@Body() dto: CreateUserDto): Promise<SafeUser> {
    return this.users.create(dto);
  }

  @Patch(':id')
  @Audit('USER_UPDATE')
  @ApiOperation({ summary: 'Update user name/role/active (admin only). Role changes are audited.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<SafeUser> {
    return this.users.update(id, dto);
  }

  @Patch(':id/password')
  @Audit('USER_PASSWORD_CHANGE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change a user password (admin only)' })
  @ApiBody({ type: ChangePasswordDto })
  changePassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.users.changePassword(id, dto.newPassword);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'User deletion is disabled' })
  remove(): never {
    throw new ForbiddenException('User deletion is disabled');
  }
}
