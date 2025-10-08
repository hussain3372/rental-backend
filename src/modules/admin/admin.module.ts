import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ReviewService } from './review.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ApplicationModule } from '../application/application.module';
import { CertificationModule } from '../certification/certification.module';
import { DocumentModule } from '../document/document.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, AuthModule, ApplicationModule, CertificationModule, DocumentModule, AuditModule],
  controllers: [AdminController],
  providers: [AdminService, ReviewService],
  exports: [AdminService, ReviewService],
})
export class AdminModule {}
