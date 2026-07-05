import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { SitesService, type TestConnectionResult } from './sites.service';
import { CreateSiteDto, ListSitesQuery, UpdateSiteDto } from './sites.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';

@ApiTags('sites')
@ApiBearerAuth('access-token')
@Controller('sites')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  @ApiOperation({ summary: 'List sites (all roles)' })
  list(@Query() q: ListSitesQuery) {
    return this.sites.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a site (all roles)' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.sites.get(id);
  }

  @Post()
  @Roles('ADMIN')
  @Audit('SITE_CREATE')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({ summary: 'Add a site (admin only). Credentials encrypted at rest.' })
  create(@Body() dto: CreateSiteDto) {
    return this.sites.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @Audit('SITE_UPDATE')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({ summary: 'Edit site settings (admin only, audited)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSiteDto,
  ) {
    return this.sites.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @Audit('SITE_DELETE')
  @UseInterceptors(AuditInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a site (admin only, audited)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.sites.remove(id);
  }

  @Post(':id/test-connection')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @ApiOperation({
    summary:
      'Hit the site WooCommerce API via the configured network route. Returns ok/latency/route + writes a SyncLog row.',
  })
  @ApiOkResponse({ description: 'Connection test result', type: Object })
  testConnection(@Param('id', ParseUUIDPipe) id: string): Promise<TestConnectionResult> {
    return this.sites.testConnection(id);
  }
}
