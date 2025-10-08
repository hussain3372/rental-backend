import { Module, forwardRef } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationWorkflowService } from './notification-workflow.service';
import { NotificationDashboardService } from './notification-dashboard.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ApplicationModule } from '../application/application.module';
import { CertificationModule } from '../certification/certification.module';
import { FCMController } from '../fcm/fcm.controller';
import { FCMService } from '../fcm/fcm.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AuditModule,
    forwardRef(() => ApplicationModule),
    forwardRef(() => CertificationModule),
  ],
  controllers: [NotificationController, FCMController],
  providers: [NotificationService, FCMService, NotificationWorkflowService, NotificationDashboardService],
  exports: [NotificationService,FCMService, NotificationWorkflowService, NotificationDashboardService],
})
export class NotificationModule {}
  