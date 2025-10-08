import { Module, forwardRef } from '@nestjs/common';
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';
import { ApplicationValidationService } from './application-validation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentModule } from '../document/document.module';
import { NotificationModule } from '../notification/notification.module';
import { S3Module } from '../s3module/s3.module';
import { PropertyTypesModule } from '../propertyTypes/propertyTypes.module';
import { CertificationModule } from '../certification/certification.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    S3Module,
    forwardRef(() => DocumentModule),
    forwardRef(() => NotificationModule),
    PropertyTypesModule,
    forwardRef(() => CertificationModule),
  ],
  controllers: [ApplicationController],
  providers: [ApplicationService, ApplicationValidationService],
  exports: [ApplicationService, ApplicationValidationService],
})
export class ApplicationModule {}
