import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceArea } from './entities/service-area.entity';
import { AdminServiceAreasService } from './admin-service-areas.service';
import { AdminServiceAreasController } from './admin-service-areas.controller';
import { ServiceAreaResolverService } from './service-area-resolver.service';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceArea])],
  controllers: [AdminServiceAreasController],
  providers: [AdminServiceAreasService, ServiceAreaResolverService],
  exports: [ServiceAreaResolverService, TypeOrmModule],
})
export class ServiceAreasModule {}
