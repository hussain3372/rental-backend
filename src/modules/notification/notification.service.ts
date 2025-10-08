// src/modules/notification/notification.service.ts (Updated)
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Notification, NotificationType, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { EnhancedLoggerService } from '../../common/logger/enhanced-logger.service';
import { FCMService } from '../fcm/fcm.service';

export interface CreateNotificationData {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  data?: any;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  sendPush?: boolean; // New field to control push notification
}

export interface NotificationWithUser extends Notification {
  user: {
    id: number;
    name: string;
    email: string;
  };
}

export interface NotificationTemplate {
  type: NotificationType;
  titleTemplate: string;
  messageTemplate: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  requiresAction?: boolean;
  actionUrl?: string;
  sendPushByDefault?: boolean;
}

@Injectable()
export class NotificationService {
  private readonly templates: Record<NotificationType, NotificationTemplate> = {
    [NotificationType.APPLICATION_STATUS]: {
      type: NotificationType.APPLICATION_STATUS,
      titleTemplate: 'Application Status Update',
      messageTemplate:
        'Your application "{{applicationId}}" status has been updated to {{status}}.',
      priority: 'high',
      requiresAction: true,
      sendPushByDefault: true,
    },
    [NotificationType.CERTIFICATION_EXPIRY]: {
      type: NotificationType.CERTIFICATION_EXPIRY,
      titleTemplate: 'Certification Expiring Soon',
      messageTemplate:
        'Your certification "{{certificateNumber}}" will expire on {{expiryDate}}.',
      priority: 'high',
      requiresAction: true,
      actionUrl: '/dashboard/certifications',
      sendPushByDefault: true,
    },
    [NotificationType.ADMIN_MESSAGE]: {
      type: NotificationType.ADMIN_MESSAGE,
      titleTemplate: 'Message from Administrator',
      messageTemplate: '{{message}}',
      priority: 'medium',
      sendPushByDefault: true,
    },
    [NotificationType.SYSTEM_ALERT]: {
      type: NotificationType.SYSTEM_ALERT,
      titleTemplate: 'System Alert',
      messageTemplate: '{{message}}',
      priority: 'high',
      sendPushByDefault: true,
    },
    [NotificationType.PAYMENT_CONFIRMATION]: {
      type: NotificationType.PAYMENT_CONFIRMATION,
      titleTemplate: 'Payment Confirmed',
      messageTemplate:
        'Your payment of ${{amount}} for application "{{applicationId}}" has been confirmed.',
      priority: 'medium',
      sendPushByDefault: true,
    },
  };

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private logger: EnhancedLoggerService,
    private fcmService: FCMService // Inject FCM service
  ) {}

  async createNotification(
    data: CreateNotificationData
  ): Promise<Notification> {
    const {
      userId,
      type,
      title,
      message,
      data: notificationData,
      priority = 'medium',
      sendPush = true,
    } = data;

    // Verify user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        isNotification: true,
        fcmToken: true,
      },
    });

    if (!user) {
      this.logger.error(
        `❌ User with ID ${userId} not found`,
        '',
        'NotificationService',
        { userId }
      );
      throw new Error(`User with ID ${userId} not found`);
    }

    // Create in-app notification
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        data: notificationData,
      },
    });

    this.logger.log(
      `✅ Notification created: ${notification.id}`,
      'NotificationService',
      {
        userId,
        type,
        title,
        notificationId: notification.id,
      }
    );

    // Debugging info
    console.log(`\n📌 Debug Notification Flow for user ${userId}`);
    console.log(`User Info:`, {
      id: user.id,
      name: user.name,
      email: user.email,
      isNotification: user.isNotification,
      fcmToken: user.fcmToken,
    });
    console.log(`Notification Data:`, {
      sendPush,
      type,
      title,
      message,
      priority,
      notificationData,
    });

    // Conditions before sending push
    if (!sendPush) {
      console.log(`⚠️ sendPush=false → Push not sent for user ${userId}`);
    }
    if (!user.isNotification) {
      console.log(
        `⚠️ User ${userId} has disabled notifications (isNotification=false)`
      );
    }
    if (!user.fcmToken) {
      console.log(`⚠️ User ${userId} has no FCM token → Push cannot be sent`);
    }

    // Send push notification if enabled
    if (sendPush && user.isNotification && user.fcmToken) {
      console.log(`🚀 Attempting push notification for user ${userId}`);
      const result = await this.sendPushNotification(
        userId,
        title,
        message,
        type,
        notificationData
      );
      console.log(`📨 Push Notification result:`, result);
    }

    console.log(`✅ Notification flow complete for user ${userId}\n`);
    return notification;
  }

  /**
   * Send push notification via FCM
   */
  private async sendPushNotification(
    userId: number,
    title: string,
    body: string,
    type: NotificationType,
    data?: any
  ): Promise<any> {
    try {
      const pushData: Record<string, string> = {
        type,
        timestamp: new Date().toISOString(),
      };

      // Convert data object to string key-value pairs for FCM
      if (data) {
        Object.keys(data).forEach(key => {
          pushData[key] = String(data[key]);
        });
      }

      console.log(`\n📦 Preparing Push Payload for user ${userId}`);
      console.log(`Payload:`, {
        title,
        body,
        data: pushData,
        priority: this.getPushPriority(type),
      });

      const result = await this.fcmService.sendToUser(userId, {
        title,
        body,
        data: pushData,
        priority: this.getPushPriority(type),
      });

      console.log(`📨 FCM Response for user ${userId}:`, result);

      if (!result.success) {
        this.logger.warn(
          `⚠️ Failed to send push notification: ${result.error}`,
          'NotificationService',
          { userId, type }
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        `❌ Error sending push notification`,
        error.stack,
        'NotificationService',
        { userId, type }
      );
      console.error(`Stack Trace:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get push priority based on notification type
   */
  private getPushPriority(type: NotificationType): 'high' | 'normal' {
    const highPriorityTypes: NotificationType[] = [
      NotificationType.APPLICATION_STATUS,
      NotificationType.CERTIFICATION_EXPIRY,
      NotificationType.SYSTEM_ALERT,
    ];

    return highPriorityTypes.includes(type) ? 'high' : 'normal';
  }

  async createNotificationFromTemplate(
    userId: number,
    type: NotificationType,
    templateData: Record<string, any>,
    sendPush = true
  ): Promise<Notification> {
    const template = this.templates[type];
    if (!template) {
      throw new Error(`No template found for notification type: ${type}`);
    }

    const title = this.interpolateTemplate(
      template.titleTemplate,
      templateData
    );
    const message = this.interpolateTemplate(
      template.messageTemplate,
      templateData
    );

    return this.createNotification({
      userId,
      type,
      title,
      message,
      data: templateData,
      priority: template.priority,
      sendPush: sendPush && template.sendPushByDefault,
    });
  }

  async getUserNotifications(
    userId: number,
    options?: {
      read?: boolean;
      type?: NotificationType;
      limit?: number;
      offset?: number;
    }
  ): Promise<{
    notifications: Notification[];
    total: number;
    unreadCount: number;
  }> {
    const { read, type, limit = 20, offset = 0 } = options || {};

    const where: any = { userId };
    if (read !== undefined) where.read = read;
    if (type) where.type = type;

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({ where }),
    ]);

    const unreadCount = await this.prisma.notification.count({
      where: { userId, read: false },
    });

    return { notifications, total, unreadCount };
  }

  async markAsRead(
    notificationId: string,
    userId: number
  ): Promise<Notification> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new Error('Notification not found or access denied');
    }

    if (notification.read) {
      return notification;
    }

    const updatedNotification = await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        read: true,
        readAt: new Date(),
      },
    });

    this.logger.log(
      `Notification marked as read: ${notificationId}`,
      'NotificationService',
      { userId, notificationId }
    );

    return updatedNotification;
  }

  async markMultipleAsRead(
    notificationIds: string[],
    userId: number
  ): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        userId,
        read: false,
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    });

    this.logger.log(
      `Marked ${result.count} notifications as read`,
      'NotificationService',
      { userId, notificationIds: notificationIds.length }
    );

    return result.count;
  }

  async markAllAsRead(userId: number): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    });

    this.logger.log(
      `Marked all ${result.count} notifications as read for user ${userId}`,
      'NotificationService',
      { userId, count: result.count }
    );

    return result.count;
  }

  async deleteNotification(
    notificationId: string,
    userId: number
  ): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new Error('Notification not found or access denied');
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    this.logger.log(
      `Notification deleted: ${notificationId}`,
      'NotificationService',
      { userId, notificationId }
    );
  }

  async getNotificationStats(userId: number): Promise<{
    total: number;
    unread: number;
    byType: Record<NotificationType, number>;
    recent: Notification[];
  }> {
    const [total, unread, notifications, byTypeResult] = await Promise.all([
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, read: false } }),
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.notification.groupBy({
        by: ['type'],
        where: { userId },
        _count: true,
      }),
    ]);

    const byType: Record<NotificationType, number> = {
      [NotificationType.APPLICATION_STATUS]: 0,
      [NotificationType.CERTIFICATION_EXPIRY]: 0,
      [NotificationType.ADMIN_MESSAGE]: 0,
      [NotificationType.SYSTEM_ALERT]: 0,
      [NotificationType.PAYMENT_CONFIRMATION]: 0,
    };

    byTypeResult.forEach(group => {
      byType[group.type] = group._count;
    });

    return {
      total,
      unread,
      byType,
      recent: notifications,
    };
  }

  async getAdminNotifications(
    adminId: number,
    adminRole: UserRole,
    options?: {
      type?: NotificationType;
      limit?: number;
      offset?: number;
      includeAllUsers?: boolean;
    }
  ): Promise<{ notifications: NotificationWithUser[]; total: number }> {
    const {
      type,
      limit = 50,
      offset = 0,
      includeAllUsers = false,
    } = options || {};

    let where: any = {};

    if (type) where.type = type;

    if (adminRole !== UserRole.SUPER_ADMIN && !includeAllUsers) {
      where.type = {
        in: [NotificationType.SYSTEM_ALERT, NotificationType.ADMIN_MESSAGE],
      };
    }

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { notifications: notifications as NotificationWithUser[], total };
  }

  async createBulkNotifications(
    notifications: CreateNotificationData[]
  ): Promise<Notification[]> {
    const createdNotifications: Notification[] = [];

    for (const notificationData of notifications) {
      try {
        const notification = await this.createNotification(notificationData);
        createdNotifications.push(notification);
      } catch (error) {
        this.logger.error(
          `Failed to create notification for user ${notificationData.userId}`,
          error.stack,
          'NotificationService'
        );
      }
    }

    this.logger.log(
      `Bulk notifications created: ${createdNotifications.length}/${notifications.length}`,
      'NotificationService',
      {
        totalRequested: notifications.length,
        totalCreated: createdNotifications.length,
      }
    );

    return createdNotifications;
  }

  async cleanupOldNotifications(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.prisma.notification.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        read: true,
      },
    });

    this.logger.log(
      `Cleaned up ${result.count} old notifications`,
      'NotificationService',
      { daysOld, deletedCount: result.count }
    );

    return result.count;
  }

  async sendNotificationToAdmins(
    type: NotificationType,
    title: string,
    message: string,
    data?: any,
    sendPush = true
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
      sendPush,
    }));

    return this.createBulkNotifications(notifications);
  }

  private interpolateTemplate(
    template: string,
    data: Record<string, any>
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return data[key] !== undefined ? String(data[key]) : match;
    });
  }

  // Application-specific notification methods with push
  async notifyApplicationStatusChange(
    applicationId: string,
    hostId: number,
    oldStatus: string,
    newStatus: string,
    notes?: string
  ): Promise<Notification> {
    return this.createNotificationFromTemplate(
      hostId,
      NotificationType.APPLICATION_STATUS,
      {
        applicationId,
        oldStatus,
        newStatus: newStatus.toLowerCase(),
        notes,
      },
      true // Send push notification
    );
  }

  async notifyCertificationExpiry(
    certificateNumber: string,
    hostId: number,
    expiryDate: Date,
    daysUntilExpiry: number
  ): Promise<Notification> {
    return this.createNotificationFromTemplate(
      hostId,
      NotificationType.CERTIFICATION_EXPIRY,
      {
        certificateNumber,
        expiryDate: expiryDate.toLocaleDateString(),
        daysUntilExpiry,
      },
      true
    );
  }

  async notifyPaymentConfirmation(
    applicationId: string,
    hostId: number,
    amount: number
  ): Promise<Notification> {
    return this.createNotificationFromTemplate(
      hostId,
      NotificationType.PAYMENT_CONFIRMATION,
      {
        applicationId,
        amount: amount.toFixed(2),
      },
      true
    );
  }

  async notifyAdminMessage(
    userId: number,
    message: string,
    adminName?: string
  ): Promise<Notification> {
    return this.createNotification({
      userId,
      type: NotificationType.ADMIN_MESSAGE,
      title: 'Message from Administrator',
      message,
      data: { adminName },
      priority: 'medium',
      sendPush: true,
    });
  }

  async notifySystemAlert(
    userId: number,
    alertType: string,
    message: string,
    data?: any
  ): Promise<Notification> {
    return this.createNotification({
      userId,
      type: NotificationType.SYSTEM_ALERT,
      title: `System Alert: ${alertType}`,
      message,
      data,
      priority: 'high',
      sendPush: true,
    });
  }
}
