import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import {
  CustomersReportQuery,
  ExpiryReportQuery,
  InventoryReportQuery,
  SalesReportQuery,
  SyncReportQuery,
} from './reports.dto';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('reports')
@ApiBearerAuth('access-token')
@Controller('reports')
@Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('inventory')
  @ApiOperation({ summary: 'Inventory report — stock levels, low-stock filter, category/site filters.' })
  inventory(@Query() q: InventoryReportQuery) {
    return this.reports.inventory(q);
  }

  @Get('inventory.xlsx')
  @ApiOperation({ summary: 'Export inventory report as Excel.' })
  async inventoryXlsx(@Query() q: InventoryReportQuery, @Res() res: Response): Promise<void> {
    const buf = await this.reports.inventoryXlsx(q);
    sendXlsx(res, buf, 'inventory-report');
  }

  @Get('expiry')
  @ApiOperation({ summary: 'Expiry report — products expiring within a date range (default next 30 days).' })
  expiry(@Query() q: ExpiryReportQuery) {
    return this.reports.expiry(q);
  }

  @Get('expiry.xlsx')
  @ApiOperation({ summary: 'Export expiry report as Excel.' })
  async expiryXlsx(@Query() q: ExpiryReportQuery, @Res() res: Response): Promise<void> {
    const buf = await this.reports.expiryXlsx(q);
    sendXlsx(res, buf, 'expiry-report');
  }

  @Get('sales')
  @ApiOperation({ summary: 'Sales report — revenue and order counts grouped by site, product, or day.' })
  sales(@Query() q: SalesReportQuery) {
    return this.reports.sales(q);
  }

  @Get('sales.xlsx')
  @ApiOperation({ summary: 'Export sales report as Excel.' })
  async salesXlsx(@Query() q: SalesReportQuery, @Res() res: Response): Promise<void> {
    const buf = await this.reports.salesXlsx(q);
    sendXlsx(res, buf, 'sales-report');
  }

  @Get('sync')
  @ApiOperation({ summary: 'Sync history report — successes/failures per site for troubleshooting.' })
  sync(@Query() q: SyncReportQuery) {
    return this.reports.syncHistory(q);
  }

  @Get('sync.xlsx')
  @ApiOperation({ summary: 'Export sync history as Excel.' })
  async syncXlsx(@Query() q: SyncReportQuery, @Res() res: Response): Promise<void> {
    const buf = await this.reports.syncHistoryXlsx(q);
    sendXlsx(res, buf, 'sync-report');
  }

  @Get('customers')
  @ApiOperation({ summary: 'Customer report — order count and total spend, sortable/filterable.' })
  customers(@Query() q: CustomersReportQuery) {
    return this.reports.customers(q);
  }

  @Get('customers.xlsx')
  @ApiOperation({ summary: 'Export customer report as Excel.' })
  async customersXlsx(@Query() q: CustomersReportQuery, @Res() res: Response): Promise<void> {
    const buf = await this.reports.customersXlsx(q);
    sendXlsx(res, buf, 'customers-report');
  }
}

function sendXlsx(res: Response, buf: Buffer, baseName: string): void {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}-${stamp}.xlsx"`);
  res.send(buf);
}
