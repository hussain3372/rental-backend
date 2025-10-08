import { Injectable } from '@nestjs/common';
import { NotificationService, NotificationWithUser } from './notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '@prisma/client';

export interface DashboardNotificationSummary {
  unreadCount: number;
  recentNotifications: Array<{
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    createdAt: Date;
    read: boolean;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    actionRequired?: boolean;
    actionUrl?: string;
  }>;
  notificationsByType: Record<NotificationType, number>;
  urgentNotifications: Array<{
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    createdAt: Date;
    actionRequired: boolean;
  }>;
}

export interface NotificationPreferences {
  userId: number;
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  notificationTypes: {
    [NotificationType.APPLICATION_STATUS]: boolean;
    [NotificationType.CERTIFICATION_EXPIRY]: boolean;
    [NotificationType.ADMIN_MESSAGE]: boolean;
    [NotificationType.SYSTEM_ALERT]: boolean;
    [NotificationType.PAYMENT_CONFIRMATION]: boolean;
  };
  quietHours: {
    enabled: boolean;
    startTime: string; // HH:mm format
    endTime: string;   // HH:mm format
    timezone: string;
  };
  frequency: 'immediate' | 'hourly' | 'daily' | 'weekly';
}

@Injectable()
export class NotificationDashboardService {
  constructor(
    private notificationService: NotificationService,
    private prisma: PrismaService,
  ) {}

  async getDashboardSummary(userId: number): Promise<DashboardNotificationSummary> {
    // Get notification statistics
    const stats = await this.notificationService.getNotificationStats(userId);

    // Get recent notifications with enhanced details
    const recentNotifications = await this.getEnhancedNotifications(userId, 10);

    // Get urgent notifications (unread + high priority)
    const urgentNotifications = await this.getUrgentNotifications(userId);

    return {
      unreadCount: stats.unread,
      recentNotifications,
      notificationsByType: stats.byType,
      urgentNotifications,
    };
  }

  async getNotificationPreferences(userId: number): Promise<NotificationPreferences> {
    // In a real implementation, you'd store preferences in a separate table
    // For now, return default preferences
    return {
      userId,
      emailNotifications: true,
      pushNotifications: true,
      smsNotifications: false,
      notificationTypes: {
        [NotificationType.APPLICATION_STATUS]: true,
        [NotificationType.CERTIFICATION_EXPIRY]: true,
        [NotificationType.ADMIN_MESSAGE]: true,
        [NotificationType.SYSTEM_ALERT]: true,
        [NotificationType.PAYMENT_CONFIRMATION]: true,
      },
      quietHours: {
        enabled: false,
        startTime: '22:00',
        endTime: '08:00',
        timezone: 'UTC',
      },
      frequency: 'immediate',
    };
  }

  async updateNotificationPreferences(
    userId: number,
    preferences: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> {
    // In a real implementation, you'd update preferences in database
    // For now, just return the updated preferences
    const currentPrefs = await this.getNotificationPreferences(userId);
    const updatedPrefs = { ...currentPrefs, ...preferences, userId };

    // Here you would save to database
    // await this.prisma.notificationPreferences.upsert({...});

    return updatedPrefs;
  }

  async getNotificationTimeline(
    userId: number,
    options?: {
      limit?: number;
      offset?: number;
      type?: NotificationType;
      startDate?: Date;
      endDate?: Date;
    }
  ): Promise<{
    notifications: Array<{
      id: string;
      type: NotificationType;
      title: string;
      message: string;
      createdAt: Date;
      read: boolean;
      readAt?: Date;
      data?: any;
      priority: 'low' | 'medium' | 'high' | 'urgent';
      timeAgo: string;
      category: string;
    }>;
    total: number;
    hasMore: boolean;
  }> {
    const { limit = 20, offset = 0, type, startDate, endDate } = options || {};

    const where: any = { userId };
    if (type) where.type = type;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1, // Get one extra to check if there are more
        skip: offset,
      }),
      this.prisma.notification.count({ where }),
    ]);

    const hasMore = notifications.length > limit;
    const displayNotifications = notifications.slice(0, limit);

    // Enhance notifications with additional metadata
    const enhancedNotifications = displayNotifications.map(notification => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      createdAt: notification.createdAt,
      read: notification.read,
      readAt: notification.readAt,
      data: notification.data,
      priority: this.getNotificationPriority(notification.type, notification.data),
      timeAgo: this.getTimeAgo(notification.createdAt),
      category: this.getNotificationCategory(notification.type),
    }));

    return {
      notifications: enhancedNotifications,
      total,
      hasMore,
    };
  }

  async getNotificationAnalytics(
    userId: number,
    period: 'week' | 'month' | 'quarter' | 'year' = 'month'
  ): Promise<{
    period: string;
    totalReceived: number;
    totalRead: number;
    readRate: number;
    averageResponseTime: string;
    notificationsByType: Record<NotificationType, { received: number; read: number; readRate: number }>;
    notificationsByDay: Array<{ date: string; received: number; read: number }>;
  }> {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'quarter':
        const quarterStart = Math.floor(now.getMonth() / 3) * 3;
        startDate = new Date(now.getFullYear(), quarterStart, 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
    }

    // Get notifications for the period
    const notifications = await this.prisma.notification.findMany({
      where: {
        userId,
        createdAt: { gte: startDate },
      },
      select: {
        id: true,
        type: true,
        read: true,
        createdAt: true,
        readAt: true,
      },
    });

    const totalReceived = notifications.length;
    const totalRead = notifications.filter(n => n.read).length;
    const readRate = totalReceived > 0 ? (totalRead / totalReceived) * 100 : 0;

    // Calculate notifications by type
    const notificationsByType: Record<NotificationType, { received: number; read: number; readRate: number }> = {
      [NotificationType.APPLICATION_STATUS]: { received: 0, read: 0, readRate: 0 },
      [NotificationType.CERTIFICATION_EXPIRY]: { received: 0, read: 0, readRate: 0 },
      [NotificationType.ADMIN_MESSAGE]: { received: 0, read: 0, readRate: 0 },
      [NotificationType.SYSTEM_ALERT]: { received: 0, read: 0, readRate: 0 },
      [NotificationType.PAYMENT_CONFIRMATION]: { received: 0, read: 0, readRate: 0 },
    };

    notifications.forEach(notification => {
      const typeStats = notificationsByType[notification.type];
      typeStats.received++;
      if (notification.read) {
        typeStats.read++;
      }
      typeStats.readRate = typeStats.received > 0 ? (typeStats.read / typeStats.received) * 100 : 0;
    });

    // Calculate notifications by day
    const notificationsByDayMap = new Map<string, { received: number; read: number }>();
    notifications.forEach(notification => {
      const dateKey = notification.createdAt.toISOString().split('T')[0];
      const existing = notificationsByDayMap.get(dateKey) || { received: 0, read: 0 };
      existing.received++;
      if (notification.read) existing.read++;
      notificationsByDayMap.set(dateKey, existing);
    });

    const notificationsByDay = Array.from(notificationsByDayMap.entries())
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      period,
      totalReceived,
      totalRead,
      readRate: Math.round(readRate * 100) / 100,
      averageResponseTime: '2.3 hours', // Would need to calculate based on read times
      notificationsByType,
      notificationsByDay,
    };
  }

  async getActionableNotifications(userId: number): Promise<Array<{
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    actionRequired: boolean;
    actionLabel: string;
    actionUrl: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    createdAt: Date;
  }>> {
    const notifications = await this.prisma.notification.findMany({
      where: {
        userId,
        read: false,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return notifications.map(notification => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      actionRequired: this.isActionRequired(notification.type, notification.data),
      actionLabel: this.getActionLabel(notification.type),
      actionUrl: this.getActionUrl(notification.type, notification.data),
      priority: this.getNotificationPriority(notification.type, notification.data),
      createdAt: notification.createdAt,
    })).filter(n => n.actionRequired);
  }

  private async getEnhancedNotifications(userId: number, limit: number) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return notifications.map(notification => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      createdAt: notification.createdAt,
      read: notification.read,
      priority: this.getNotificationPriority(notification.type, notification.data),
      actionRequired: this.isActionRequired(notification.type, notification.data),
      actionUrl: this.getActionUrl(notification.type, notification.data),
    }));
  }

  private async getUrgentNotifications(userId: number) {
    const urgentNotifications = await this.prisma.notification.findMany({
      where: {
        userId,
        read: false,
        type: {
          in: [NotificationType.CERTIFICATION_EXPIRY, NotificationType.SYSTEM_ALERT]
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return urgentNotifications.map(notification => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      createdAt: notification.createdAt,
      actionRequired: true,
    }));
  }

  private getNotificationPriority(type: NotificationType, data?: any): 'low' | 'medium' | 'high' | 'urgent' {
    switch (type) {
      case NotificationType.SYSTEM_ALERT:
        return 'urgent';
      case NotificationType.CERTIFICATION_EXPIRY:
        // Check if expiry is within 7 days
        if (data?.daysUntilExpiry <= 7) return 'urgent';
        if (data?.daysUntilExpiry <= 30) return 'high';
        return 'medium';
      case NotificationType.APPLICATION_STATUS:
        return 'high';
      case NotificationType.ADMIN_MESSAGE:
        return 'medium';
      case NotificationType.PAYMENT_CONFIRMATION:
        return 'low';
      default:
        return 'medium';
    }
  }

  private isActionRequired(type: NotificationType, data?: any): boolean {
    switch (type) {
      case NotificationType.CERTIFICATION_EXPIRY:
      case NotificationType.APPLICATION_STATUS:
      case NotificationType.SYSTEM_ALERT:
        return true;
      case NotificationType.ADMIN_MESSAGE:
        return data?.actionRequired || false;
      case NotificationType.PAYMENT_CONFIRMATION:
        return false;
      default:
        return false;
    }
  }

  private getActionLabel(type: NotificationType): string {
    switch (type) {
      case NotificationType.CERTIFICATION_EXPIRY:
        return 'Renew Certification';
      case NotificationType.APPLICATION_STATUS:
        return 'View Application';
      case NotificationType.SYSTEM_ALERT:
        return 'View Details';
      case NotificationType.ADMIN_MESSAGE:
        return 'Read Message';
      default:
        return 'View';
    }
  }

  private getActionUrl(type: NotificationType, data?: any): string {
    switch (type) {
      case NotificationType.CERTIFICATION_EXPIRY:
        return `/dashboard/certifications/${data?.certificateNumber}`;
      case NotificationType.APPLICATION_STATUS:
        return `/dashboard/applications/${data?.applicationId}`;
      case NotificationType.SYSTEM_ALERT:
        return '/dashboard/notifications';
      case NotificationType.ADMIN_MESSAGE:
        return '/dashboard/messages';
      default:
        return '/dashboard/notifications';
    }
  }

  private getNotificationCategory(type: NotificationType): string {
    switch (type) {
      case NotificationType.APPLICATION_STATUS:
        return 'Application';
      case NotificationType.CERTIFICATION_EXPIRY:
        return 'Certification';
      case NotificationType.ADMIN_MESSAGE:
        return 'Messages';
      case NotificationType.SYSTEM_ALERT:
        return 'System';
      case NotificationType.PAYMENT_CONFIRMATION:
        return 'Payment';
      default:
        return 'General';
    }
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;

    return date.toLocaleDateString();
  }
}
