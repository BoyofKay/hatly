import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductCategory } from './entities/product-category.entity';
import { Product } from './entities/product.entity';
import { ProductOption } from './entities/product-option.entity';
import { ProductOptionValue } from './entities/product-option-value.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { VendorsModule } from '../vendors/vendors.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { AdminProductCategoriesController } from './admin-product-categories.controller';
import { AdminProductsController } from './admin-products.controller';
import { VendorProductsService } from './vendor-products.service';
import { VendorProductsController, VendorCategoriesController } from './vendor-products.controller';
import { ProductExcelImportService } from './product-excel-import.service';
import { OffersModule } from '../offers/offers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductCategory, Product, ProductOption, ProductOptionValue, VendorBranch]),
    VendorsModule,
    UploadsModule,
    OffersModule,
  ],
  controllers: [ProductsController, AdminProductCategoriesController, AdminProductsController, VendorProductsController, VendorCategoriesController],
  providers: [ProductsService, VendorProductsService, ProductExcelImportService],
  exports: [ProductsService, TypeOrmModule],
})
export class ProductsModule {}
