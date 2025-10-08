import { Module, forwardRef } from '@nestjs/common';
import { CertificationController } from './certification.controller';
import { VerificationController } from './verification.controller';
import { CertificationService } from './certification.service';
import { BadgeService } from './badge.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { MailModule } from '../../common/mail/mail.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AuditModule,
    StorageModule,
    MailModule,
    forwardRef(() => NotificationModule),
  ],
  controllers: [CertificationController, VerificationController],
  providers: [CertificationService, BadgeService],
  exports: [CertificationService, BadgeService],
})
export class CertificationModule {}
