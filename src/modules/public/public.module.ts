import { Module } from '@nestjs/common';
import { RegistryController } from './registry.controller';
import { SearchController } from './search.controller';
import { RegistryService } from './registry.service';
import { SearchService } from './search.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RegistryController, SearchController],
  providers: [RegistryService, SearchService],
  exports: [RegistryService, SearchService],
})
export class PublicModule {}
