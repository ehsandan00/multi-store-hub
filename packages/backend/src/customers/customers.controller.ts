import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { ListCustomersQuery } from './customers.dto';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('customers')
@ApiBearerAuth('access-token')
@Controller('customers')
@Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers for a single site (siteId required).' })
  list(@Query() q: ListCustomersQuery) {
    return this.customers.list(q);
  }

  @Get('cross-site-duplicates')
  @ApiOperation({
    summary: 'Customers with the same email or phone on multiple sites (never merged).',
  })
  crossSiteDuplicates() {
    return this.customers.crossSiteDuplicates();
  }
}
