import { Module } from '@nestjs/common';
import { PropertyTypesService } from './propertyTypes.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PropertyTypesController } from './propertyTypes.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PropertyTypesController],
  providers: [PropertyTypesService],
  exports: [PropertyTypesService],
})
export class PropertyTypesModule {}
