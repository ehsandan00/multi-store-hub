import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ProductsService, type PaginatedProducts, type ProductRow } from './products.service';
import { CreateProductDto, ListProductsQuery, UpdateProductDto } from './products.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import type { AuthenticatedUser } from '../auth/auth.types';

@ApiTags('products')
@ApiBearerAuth('access-token')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List products (paginated, filterable)' })
  list(@Query() q: ListProductsQuery): Promise<PaginatedProducts> {
    return this.products.list(q);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Distinct product categories' })
  categories(): Promise<string[]> {
    return this.products.categories();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by id' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductRow> {
    return this.products.get(id);
  }

  @Get(':id/inventory-history')
  @ApiOperation({ summary: 'Inventory change history for a product' })
  inventoryHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.inventoryHistory(id);
  }

  @Post()
  @Roles('ADMIN')
  @Audit('PRODUCT_CREATE')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({ summary: 'Create a product (admin only)' })
  create(
    @Body() dto: CreateProductDto,
    @Req() req: { user: AuthenticatedUser },
  ): Promise<ProductRow> {
    return this.products.create(dto, req.user);
  }

  @Patch(':id')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @Audit('PRODUCT_UPDATE')
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({ summary: 'Update a product (admin + warehouse)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @Req() req: { user: AuthenticatedUser },
  ): Promise<ProductRow> {
    return this.products.update(id, dto, req.user);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @Audit('PRODUCT_DELETE')
  @UseInterceptors(AuditInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a product (admin only, audited)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.products.remove(id);
  }
}
