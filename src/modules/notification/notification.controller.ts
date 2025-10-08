import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseIntPipe,
  ValidationPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { NotificationService, CreateNotificationData } from './notification.service';
import { NotificationDashboardService } from './notification-dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { NotificationType, UserRole } from '@prisma/client';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly dashboardService: NotificationDashboardService,
  ) {}

  // User notification endpoints
 @Get()
@HttpCode(HttpStatus.OK)
getUserNotifications(
  @CurrentUser() user: any,
  @Query('read') read?: string,
  @Query('type') type?: NotificationType,
  @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
) {
  const readFilter = read === undefined ? undefined : read === 'true';

  return this.notificationService.getUserNotifications(user.id, {
    read: readFilter,
    type,
    limit,
    offset,
  });
}


  @Get('stats')
  @HttpCode(HttpStatus.OK)
  getNotificationStats(@CurrentUser() user: any) {
    return this.notificationService.getNotificationStats(user.id);
  }

  @Put(':id/read')
  @HttpCode(HttpStatus.OK)
  markAsRead(
    @Param('id') notificationId: string,
    @CurrentUser() user: any,
  ) {
    return this.notificationService.markAsRead(notificationId, user.id);
  }

  @Put('read-all')
  @HttpCode(HttpStatus.OK)
  markAllAsRead(@CurrentUser() user: any) {
    return this.notificationService.markAllAsRead(user.id).then(count => ({
      message: `Marked ${count} notifications as read`,
      count,
    }));
  }

  @Put('read-multiple')
  @HttpCode(HttpStatus.OK)
  markMultipleAsRead(
    @Body('notificationIds') notificationIds: string[],
    @CurrentUser() user: any,
  ) {
    return this.notificationService.markMultipleAsRead(notificationIds, user.id).then(count => ({
      message: `Marked ${count} notifications as read`,
      count,
    }));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteNotification(
    @Param('id') notificationId: string,
    @CurrentUser() user: any,
  ) {
    return this.notificationService.deleteNotification(notificationId, user.id);
  }

  // Admin notification endpoints
  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createNotification(
    @Body(ValidationPipe) createNotificationDto: CreateNotificationDto,
    @CurrentUser() user: any,
  ) {
    const data: CreateNotificationData = {
      userId: createNotificationDto.userId,
      type: createNotificationDto.type,
      title: createNotificationDto.title,
      message: createNotificationDto.message,
      data: createNotificationDto.data,
    };

    return this.notificationService.createNotification(data);
  }

  @Post('bulk')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createBulkNotifications(
    @Body(ValidationPipe) bulkData: { notifications: CreateNotificationData[] },
    @CurrentUser() user: any,
  ) {
    return this.notificationService.createBulkNotifications(bulkData.notifications);
  }

  @Post('admin-message')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  sendAdminMessage(
    @Body() data: { userId: number; message: string },
    @CurrentUser() user: any,
  ) {
    return this.notificationService.notifyAdminMessage(
      data.userId,
      data.message,
      user.name || user.email
    );
  }

  @Post('admin-broadcast')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  broadcastToAdmins(
    @Body() data: {
      type: NotificationType;
      title: string;
      message: string;
      data?: any;
    },
    @CurrentUser() user: any,
  ) {
    return this.notificationService.sendNotificationToAdmins(
      data.type,
      data.title,
      data.message,
      data.data
    );
  }

  @Get('admin/all')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  getAdminNotifications(
    @CurrentUser() user: any,
    @Query('type') type?: NotificationType,
    @Query('limit', ParseIntPipe) limit?: number,
    @Query('offset', ParseIntPipe) offset?: number,
    @Query('includeAllUsers') includeAllUsers?: string,
  ) {
    return this.notificationService.getAdminNotifications(
      user.id,
      user.role,
      {
        type,
        limit: limit || 50,
        offset: offset || 0,
        includeAllUsers: includeAllUsers === 'true',
      }
    );
  }

  // System maintenance endpoints
  @Post('cleanup')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  cleanupOldNotifications(
    @Body() data: { daysOld?: number },
    @CurrentUser() user: any,
  ) {
    const daysOld = data.daysOld || 90;
    return this.notificationService.cleanupOldNotifications(daysOld).then(count => ({
      message: `Cleaned up ${count} notifications older than ${daysOld} days`,
      deletedCount: count,
    }));
  }

  // Template endpoints
  @Get('templates')
  @HttpCode(HttpStatus.OK)
  getNotificationTemplates() {
    return this.notificationService['templates'];
  }

  // Analytics endpoints
  @Get('analytics/overview')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async getNotificationAnalytics() {
    // This would provide analytics about notification delivery, read rates, etc.
    // For now, return basic stats
    const [totalNotifications, unreadCount, typeBreakdown] = await Promise.all([
      this.notificationService['prisma'].notification.count(),
      this.notificationService['prisma'].notification.count({ where: { read: false } }),
      this.notificationService['prisma'].notification.groupBy({
        by: ['type'],
        _count: true,
      }),
    ]);

    const readRate = totalNotifications > 0 ? ((totalNotifications - unreadCount) / totalNotifications * 100) : 0;

    return {
      totalNotifications,
      unreadCount,
      readRate: Math.round(readRate * 100) / 100,
      typeBreakdown,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('analytics/user/:userId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  getUserNotificationAnalytics(@Param('userId', ParseIntPipe) userId: number) {
    return this.notificationService.getNotificationStats(userId);
  }

  // Dashboard-specific endpoints
  @Get('dashboard/summary')
  @HttpCode(HttpStatus.OK)
  getDashboardSummary(@CurrentUser() user: any) {
    return this.dashboardService.getDashboardSummary(user.id);
  }

  @Get('dashboard/actionable')
  @HttpCode(HttpStatus.OK)
  getActionableNotifications(@CurrentUser() user: any) {
    return this.dashboardService.getActionableNotifications(user.id);
  }

  @Get('dashboard/timeline')
  @HttpCode(HttpStatus.OK)
  getNotificationTimeline(
    @CurrentUser() user: any,
    @Query('limit', ParseIntPipe) limit?: number,
    @Query('offset', ParseIntPipe) offset?: number,
    @Query('type') type?: NotificationType,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboardService.getNotificationTimeline(user.id, {
      limit: limit || 20,
      offset: offset || 0,
      type,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get('preferences')
  @HttpCode(HttpStatus.OK)
  getNotificationPreferences(@CurrentUser() user: any) {
    return this.dashboardService.getNotificationPreferences(user.id);
  }

  @Put('preferences')
  @HttpCode(HttpStatus.OK)
  updateNotificationPreferences(
    @CurrentUser() user: any,
    @Body() preferences: any, // Would use proper DTO in production
  ) {
    return this.dashboardService.updateNotificationPreferences(user.id, preferences);
  }

  @Get('dashboard/analytics')
  @HttpCode(HttpStatus.OK)
  getDashboardAnalytics(
    @CurrentUser() user: any,
    @Query('period') period?: 'week' | 'month' | 'quarter' | 'year',
  ) {
    return this.dashboardService.getNotificationAnalytics(user.id, period || 'month');
  }
}
