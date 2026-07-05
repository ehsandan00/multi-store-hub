import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { ListOrdersQuery } from './orders.dto';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('orders')
@ApiBearerAuth('access-token')
@Controller('orders')
@Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List orders across all stores (paginated, filterable by site/status/date/search).' })
  async list(@Query() q: ListOrdersQuery) {
    return this.orders.list({
      siteId: q.siteId,
      status: q.status,
      search: q.search,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 25,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single order with line items, site, and customer.' })
  async get(@Param('id') id: string) {
    return this.orders.get(id);
  }
}
