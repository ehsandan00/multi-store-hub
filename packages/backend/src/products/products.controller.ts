import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ProductsService, type PaginatedProducts, type ProductRow, type UploadedPhoto } from './products.service';
import { CreateProductDto, ListProductsQuery, LookupProductQuery, UpdateProductDto } from './products.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import type { AuthenticatedUser } from '../auth/auth.types';

const HUB_PHOTO_MAX_BYTES = 512 * 1024;

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

  @Get('lookup')
  @Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Find a product by exact barcode or SKU (for scanner)' })
  async lookup(@Query() q: LookupProductQuery): Promise<ProductRow> {
    const product = await this.products.lookupByCode(q.code);
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  @Get(':id/hub-photo')
  @Roles('ADMIN', 'WAREHOUSE_STAFF', 'VIEWER')
  @ApiOperation({ summary: 'Get hub-only product photo (never synced to stores)' })
  async hubPhoto(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const { buffer, mimeType } = await this.products.getHubPhoto(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buffer);
  }

  @Get(':id/inventory-history')
  @ApiOperation({ summary: 'Inventory change history for a product' })
  inventoryHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.inventoryHistory(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by id' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductRow> {
    return this.products.get(id);
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

  @Post(':id/hub-photo')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @Audit('PRODUCT_HUB_PHOTO_UPLOAD')
  @UseInterceptors(
    AuditInterceptor,
    FileInterceptor('photo', { limits: { fileSize: HUB_PHOTO_MAX_BYTES } }),
  )
  @ApiOperation({ summary: 'Upload hub-only product photo (camera/file)' })
  uploadHubPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedPhoto,
  ): Promise<ProductRow> {
    return this.products.saveHubPhoto(id, file);
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

  @Delete(':id/hub-photo')
  @Roles('ADMIN', 'WAREHOUSE_STAFF')
  @Audit('PRODUCT_HUB_PHOTO_DELETE')
  @UseInterceptors(AuditInterceptor)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove hub-only product photo' })
  removeHubPhoto(@Param('id', ParseUUIDPipe) id: string): Promise<ProductRow> {
    return this.products.removeHubPhoto(id);
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
