import { Injectable, Logger } from '@nestjs/common';
import { NotificationService } from './notification.service';
import {
  ApplicationStatus,
  CertificationStatus,
  NotificationType,
  UserRole,
  Notification,
} from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationWorkflowService {
  private readonly logger = new Logger(NotificationWorkflowService.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly prisma: PrismaService
  ) {}

  // Application status change notifications
  async notifyApplicationStatusChange(
    applicationId: string,
    hostId: number,
    oldStatus: ApplicationStatus,
    newStatus: ApplicationStatus,
    reviewerName?: string,
    notes?: string
  ): Promise<void> {
    try {
      switch (newStatus) {
        case ApplicationStatus.SUBMITTED:
          await this.notifyApplicationSubmitted(applicationId, hostId);
          break;
        case ApplicationStatus.UNDER_REVIEW:
          await this.notifyApplicationUnderReview(
            applicationId,
            hostId,
            reviewerName
          );
          break;
        case ApplicationStatus.APPROVED:
          await this.notifyApplicationApproved(applicationId, hostId);
          break;
        case ApplicationStatus.REJECTED:
          await this.notifyApplicationRejected(applicationId, hostId, notes); // ✅ Only one
          break;
        case ApplicationStatus.MORE_INFO_REQUESTED:
          await this.notifyMoreInfoRequested(applicationId, hostId, notes);
          break;
        default:
          // fallback: generic status update
          await this.notificationService.notifyApplicationStatusChange(
            applicationId,
            hostId,
            oldStatus,
            newStatus,
            notes
          );
      }

      this.logger.log(
        `Application status notification sent: ${applicationId} -> ${newStatus}`,
        'NotificationWorkflowService',
        { applicationId, hostId, oldStatus, newStatus }
      );
    } catch (error) {
      this.logger.error(
        `Failed to send application status notification: ${applicationId}`,
        error.stack,
        'NotificationWorkflowService'
      );
    }
  }

  // Certification-related notifications
  async notifyCertificationIssued(
    certificationId: string,
    certificateNumber: string,
    hostId: number,
    expiryDate: Date
  ): Promise<void> {
    try {
      await this.notificationService.notifyAdminMessage(
        hostId,
        `Congratulations! Your property certification has been issued. Certificate Number: ${certificateNumber}. Valid until: ${expiryDate.toLocaleDateString()}.`,
        'System'
      );

      this.logger.log(
        `Certification issued notification sent: ${certificateNumber}`,
        'NotificationWorkflowService',
        { certificationId, certificateNumber, hostId }
      );
    } catch (error) {
      this.logger.error(
        `Failed to send certification issued notification: ${certificateNumber}`,
        error.stack,
        'NotificationWorkflowService'
      );
    }
  }

  async notifyCertificationRevoked(
    certificationId: string,
    certificateNumber: string,
    hostId: number,
    reason: string,
    adminName: string
  ): Promise<void> {
    try {
      await this.notificationService.notifySystemAlert(
        hostId,
        'Certification Revoked',
        `Your certification ${certificateNumber} has been revoked. Reason: ${reason}. Please contact support for assistance.`,
        { certificationId, certificateNumber, reason, revokedBy: adminName }
      );

      this.logger.log(
        `Certification revoked notification sent: ${certificateNumber}`,
        'NotificationWorkflowService',
        { certificationId, certificateNumber, hostId, reason }
      );
    } catch (error) {
      this.logger.error(
        `Failed to send certification revoked notification: ${certificateNumber}`,
        error.stack,
        'NotificationWorkflowService'
      );
    }
  }

  // Payment notifications
  async notifyPaymentConfirmed(
    applicationId: string,
    hostId: number,
    amount: number
  ): Promise<void> {
    try {
      await this.notificationService.notifyPaymentConfirmation(
        applicationId,
        hostId,
        amount
      );

      this.logger.log(
        `Payment confirmation notification sent: ${applicationId}`,
        'NotificationWorkflowService',
        { applicationId, hostId, amount }
      );
    } catch (error) {
      this.logger.error(
        `Failed to send payment confirmation notification: ${applicationId}`,
        error.stack,
        'NotificationWorkflowService'
      );
    }
  }

  async notifyPaymentFailed(
    applicationId: string,
    hostId: number,
    amount: number,
    reason: string
  ): Promise<void> {
    try {
      await this.notificationService.notifySystemAlert(
        hostId,
        'Payment Failed',
        `Your payment of $${amount} for application ${applicationId} has failed. Reason: ${reason}. Please try again or contact support.`,
        { applicationId, amount, reason }
      );

      this.logger.log(
        `Payment failed notification sent: ${applicationId}`,
        'NotificationWorkflowService',
        { applicationId, hostId, amount, reason }
      );
    } catch (error) {
      this.logger.error(
        `Failed to send payment failed notification: ${applicationId}`,
        error.stack,
        'NotificationWorkflowService'
      );
    }
  }

  // Admin notifications
  async notifyAdminNewApplication(
    applicationId: string,
    hostName: string,
    hostEmail: string
  ): Promise<void> {
    try {
      await this.notificationService.sendNotificationToAdmins(
        'SYSTEM_ALERT' as any,
        'New Application Submitted',
        `New application ${applicationId} submitted by ${hostName} (${hostEmail}). Please review.`,
        { applicationId, hostName, hostEmail, actionRequired: true }
      );

      this.logger.log(
        `Admin notification sent for new application: ${applicationId}`,
        'NotificationWorkflowService',
        { applicationId, hostName, hostEmail }
      );
    } catch (error) {
      this.logger.error(
        `Failed to send admin notification for new application: ${applicationId}`,
        error.stack,
        'NotificationWorkflowService'
      );
    }
  }

  async notifyAdminUrgentReview(
    applicationId: string,
    hostName: string,
    daysWaiting: number
  ): Promise<void> {
    try {
      await this.notificationService.sendNotificationToAdmins(
        'SYSTEM_ALERT' as any,
        'Urgent: Application Review Required',
        `Application ${applicationId} from ${hostName} has been waiting for ${daysWaiting} days. Immediate review required.`,
        { applicationId, hostName, daysWaiting, priority: 'urgent' }
      );

      this.logger.log(
        `Urgent admin notification sent: ${applicationId}`,
        'NotificationWorkflowService',
        { applicationId, hostName, daysWaiting }
      );
    } catch (error) {
      this.logger.error(
        `Failed to send urgent admin notification: ${applicationId}`,
        error.stack,
        'NotificationWorkflowService'
      );
    }
  }

  // Scheduled notification jobs
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendDailyCertificationExpiryReminders(): Promise<void> {
    try {
      this.logger.log(
        'Starting daily certification expiry reminder check',
        'NotificationWorkflowService'
      );

      // This would integrate with the certification service to find expiring certifications
      // For now, we'll just log that the job ran
      const reminderCount = 0; // Would be populated by actual logic

      this.logger.log(
        `Daily certification expiry reminders sent: ${reminderCount}`,
        'NotificationWorkflowService'
      );
    } catch (error) {
      this.logger.error(
        'Failed to send daily certification expiry reminders',
        error.stack,
        'NotificationWorkflowService'
      );
    }
  }

  @Cron(CronExpression.EVERY_WEEK)
  async sendWeeklyAdminReport(): Promise<void> {
    try {
      this.logger.log(
        'Sending weekly admin report',
        'NotificationWorkflowService'
      );

      // This would generate and send a weekly summary to admins
      // For now, we'll just log that the job ran
      await this.notificationService.sendNotificationToAdmins(
        'ADMIN_MESSAGE' as any,
        'Weekly System Report',
        'Weekly system summary is now available. Check the admin dashboard for detailed metrics.',
        { reportType: 'weekly', generatedAt: new Date().toISOString() }
      );

      this.logger.log(
        'Weekly admin report sent',
        'NotificationWorkflowService'
      );
    } catch (error) {
      this.logger.error(
        'Failed to send weekly admin report',
        error.stack,
        'NotificationWorkflowService'
      );
    }
  }

  @Cron('0 0 1 * *') // First day of every month
  async sendMonthlyAnalyticsReport(): Promise<void> {
    try {
      this.logger.log(
        'Sending monthly analytics report',
        'NotificationWorkflowService'
      );

      // This would generate detailed monthly analytics
      await this.notificationService.sendNotificationToAdmins(
        'ADMIN_MESSAGE' as any,
        'Monthly Analytics Report',
        'Monthly analytics report is now available with detailed insights on certifications, applications, and user activity.',
        { reportType: 'monthly', generatedAt: new Date().toISOString() }
      );

      this.logger.log(
        'Monthly analytics report sent',
        'NotificationWorkflowService'
      );
    } catch (error) {
      this.logger.error(
        'Failed to send monthly analytics report',
        error.stack,
        'NotificationWorkflowService'
      );
    }
  }

  // Helper methods for specific notification scenarios
  private async notifyApplicationSubmitted(
    applicationId: string,
    hostId: number
  ): Promise<void> {
    // Additional logic for application submission notifications
    this.logger.debug(
      `Application submitted notification sent: ${applicationId}`
    );
  }

  private async notifyApplicationUnderReview(
    applicationId: string,
    hostId: number,
    reviewerName?: string
  ): Promise<void> {
    const message = reviewerName
      ? `Your application is now under review by ${reviewerName}.`
      : 'Your application is now under review.';

    await this.notificationService.notifyAdminMessage(
      hostId,
      message,
      reviewerName
    );
  }

  private async notifyApplicationApproved(
    applicationId: string,
    hostId: number
  ): Promise<void> {
    await this.notificationService.notifyAdminMessage(
      hostId,
      `Congratulations! Your application ${applicationId} has been approved. Please proceed with payment to complete the certification process.`,
      'System'
    );
  }

  private async notifyApplicationRejected(
    applicationId: string,
    hostId: number,
    reason?: string
  ): Promise<void> {
    const message = reason
      ? `Your application ${applicationId} has been rejected. Reason: ${reason}. You may submit a new application after addressing the issues.`
      : `Your application ${applicationId} has been rejected. Please contact support for more details.`;

    await this.notificationService.notifySystemAlert(
      hostId,
      'Application Rejected',
      message,
      { applicationId, reason, actionRequired: true }
    );
  }

  private async notifyMoreInfoRequested(
    applicationId: string,
    hostId: number,
    notes?: string
  ): Promise<void> {
    const message = notes
      ? `Additional information is required for your application ${applicationId}. Details: ${notes}. Please update your application.`
      : `Additional information is required for your application ${applicationId}. Please check your application and provide the requested details.`;

    await this.notificationService.notifyAdminMessage(
      hostId,
      message,
      'System'
    );
  }

  // Bulk notification methods
  async notifyBulkCertificationExpiry(
    certifications: Array<{
      certificationId: string;
      certificateNumber: string;
      hostId: number;
      expiryDate: Date;
      daysUntilExpiry: number;
    }>
  ): Promise<void> {
    const notifications = certifications.map(cert =>
      this.notificationService.notifyCertificationExpiry(
        cert.certificateNumber,
        cert.hostId,
        cert.expiryDate,
        cert.daysUntilExpiry
      )
    );

    await Promise.allSettled(notifications);

    this.logger.log(
      `Bulk certification expiry notifications sent: ${certifications.length}`,
      'NotificationWorkflowService',
      { count: certifications.length }
    );
  }

  async notifyBulkApplicationStatusUpdate(
    updates: Array<{
      applicationId: string;
      hostId: number;
      oldStatus: ApplicationStatus;
      newStatus: ApplicationStatus;
      reviewerName?: string;
      notes?: string;
    }>
  ): Promise<void> {
    const notifications = updates.map(update =>
      this.notifyApplicationStatusChange(
        update.applicationId,
        update.hostId,
        update.oldStatus,
        update.newStatus,
        update.reviewerName,
        update.notes
      )
    );

    await Promise.allSettled(notifications);

    this.logger.log(
      `Bulk application status notifications sent: ${updates.length}`,
      'NotificationWorkflowService',
      { count: updates.length }
    );
  }

  async sendNotificationToAdmins(
    type: NotificationType,
    title: string,
    message: string,
    data?: any
  ): Promise<Notification[]> {
    const admins = await this.prisma.user.findMany({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
      },
      select: { id: true },
    });

    const notifications = admins.map(admin => ({
      userId: admin.id,
      type,
      title,
      message,
      data,
      priority: 'high' as const,
    }));

    return this.notificationService.createBulkNotifications(notifications);
  }

  async notifyAdminMessage(
    userId: number,
    message: string,
    adminName?: string
  ): Promise<Notification> {
    return this.notificationService.createNotification({
      userId,
      type: NotificationType.ADMIN_MESSAGE,
      title: 'Message from Administrator',
      message,
      data: { adminName },
      priority: 'medium',
    });
  }
}
