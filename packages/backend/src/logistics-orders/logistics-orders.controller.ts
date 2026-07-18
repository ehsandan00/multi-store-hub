import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Audit } from '../common/decorators/audit.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import {
  CreateLogisticsOrderDto,
  ListLogisticsOrdersQuery,
  UpdateLogisticsOrderStatusDto,
} from './logistics-orders.dto';
import { LogisticsOrdersService } from './logistics-orders.service';

@ApiTags('logistics-orders')
@ApiBearerAuth('access-token')
@Controller('logistics-orders')
export class LogisticsOrdersController {
  constructor(private readonly logisticsOrders: LogisticsOrdersService) {}

  @Get('employees')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @ApiOperation({ summary: 'List active hub users assignable to logistics orders' })
  listEmployees() {
    return this.logisticsOrders.listEmployees();
  }

  @Get()
  @Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
  @ApiOperation({ summary: 'List manual logistics orders' })
  list(@Query() query: ListLogisticsOrdersQuery) {
    return this.logisticsOrders.list(query);
  }

  @Post()
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @Audit('LOGISTICS_ORDER_CREATE')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({ summary: 'Create a manual logistics order without changing stock' })
  create(
    @Body() dto: CreateLogisticsOrderDto,
    @Req() req: { user: AuthenticatedUser },
  ) {
    return this.logisticsOrders.create(dto, req.user);
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @Audit('LOGISTICS_ORDER_STATUS_UPDATE')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({ summary: 'Quickly update a logistics order status' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLogisticsOrderStatusDto,
  ) {
    return this.logisticsOrders.updateStatus(id, dto.status);
  }
}
