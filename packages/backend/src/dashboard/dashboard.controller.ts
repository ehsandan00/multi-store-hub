import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
@Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'Aggregated KPIs: revenue series, order status, top products, inventory value, today orders, latest syncs, alerts.',
  })
  async summary() {
    return this.dashboard.getSummary();
  }
}
