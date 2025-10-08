import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { ReviewService, ReviewDecision } from './review.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole, ApplicationStatus } from '@prisma/client';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly reviewService: ReviewService
  ) {}

  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get admin dashboard statistics' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics retrieved successfully',
  })
  getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('queue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get application review queue' })
  @ApiResponse({
    status: 200,
    description: 'Application queue retrieved successfully',
  })
  getApplicationQueue(
    @CurrentUser() user: any,
    @Query('status') status?: ApplicationStatus,
    @Query('priority') priority?: 'high' | 'medium' | 'low',
    @Query('assignedToMe') assignedToMe?: boolean
  ) {
    return this.adminService.getApplicationQueue(
      assignedToMe ? user.id : undefined,
      { status, priority, assignedToMe: assignedToMe === true }
    );
  }

  @Post('queue/:applicationId/assign')
  @HttpCode(HttpStatus.OK)
  assignApplicationToAdmin(
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: any
  ) {
    return this.adminService.assignApplicationToAdmin(
      applicationId,
      user.id,
      user.name || user.email
    );
  }

  @Get('workload')
  @HttpCode(HttpStatus.OK)
  getAdminWorkload() {
    return this.adminService.getAdminWorkload();
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  getSystemHealth() {
    return this.adminService.getSystemHealth();
  }

  // Super admin only endpoints
  @Get('system-stats')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async getSystemStats() {
    const [dashboardStats, health, workload] = await Promise.all([
      this.adminService.getDashboardStats(),
      this.adminService.getSystemHealth(),
      this.adminService.getAdminWorkload(),
    ]);

    return {
      dashboard: dashboardStats,
      health,
      workload,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('performance-metrics')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async getPerformanceMetrics() {
    // This would include more detailed metrics like response times, error rates, etc.
    // For now, return basic metrics
    const dashboard = await this.adminService.getDashboardStats();

    return {
      applicationMetrics: {
        totalProcessed:
          dashboard.applications.approved + dashboard.applications.rejected,
        approvalRate:
          dashboard.applications.total > 0
            ? (
                (dashboard.applications.approved /
                  (dashboard.applications.approved +
                    dashboard.applications.rejected)) *
                100
              ).toFixed(1)
            : '0',
        averageProcessingTime: '3.2 days', // Would need calculation
      },
      certificationMetrics: {
        activeRate:
          dashboard.certifications.total > 0
            ? (
                (dashboard.certifications.active /
                  dashboard.certifications.total) *
                100
              ).toFixed(1)
            : '0',
        renewalRate: '85.3%', // Would need calculation
      },
      userMetrics: {
        hostGrowth: '+12.5%', // Would need calculation
        adminUtilization: '78.3%', // Would need calculation
      },
    };
  }

  // Review workflow endpoints
  @Get('reviews/:applicationId')
  @HttpCode(HttpStatus.OK)
  getApplicationForReview(
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: any
  ) {
    return this.reviewService.getApplicationForReview(
      applicationId,
      user.id,
      user.role
    );
  }

  @Post('reviews/:applicationId/decide')
  @HttpCode(HttpStatus.OK)
  submitReviewDecision(
    @Param('applicationId') applicationId: string,
    @Body() decision: ReviewDecision,
    @CurrentUser() user: any
  ) {
    return this.reviewService.submitReviewDecision(
      applicationId,
      decision,
      user.id,
      user.name || user.email,
      user.role
    );
  }

  @Post('reviews/:applicationId/assign/:reviewerId')
  @HttpCode(HttpStatus.OK)
  assignReviewer(
    @Param('applicationId') applicationId: string,
    @Param('reviewerId', ParseIntPipe) reviewerId: number,
    @CurrentUser() user: any
  ) {
    return this.reviewService.assignReviewer(
      applicationId,
      reviewerId,
      user.id,
      user.name || user.email
    );
  }

  @Get('reviews/queue/stats')
  @HttpCode(HttpStatus.OK)
  getReviewQueueStats(@CurrentUser() user: any) {
    return this.reviewService.getReviewQueueStats(user.id);
  }

  // Certification management endpoints
  @Get('certifications/search')
  @HttpCode(HttpStatus.OK)
  searchCertifications(
    @CurrentUser() user: any,
    @Query('certificateNumber') certificateNumber?: string,
    @Query('hostName') hostName?: string,
    @Query('status') status?: string,
    @Query('expiryBefore') expiryBefore?: string,
    @Query('expiryAfter') expiryAfter?: string,
    @Query('skip', ParseIntPipe) skip?: number,
    @Query('take', ParseIntPipe) take?: number
  ) {
    return this.adminService.searchCertifications({
      certificateNumber,
      hostName,
      status: status as any,
      expiryBefore: expiryBefore ? new Date(expiryBefore) : undefined,
      expiryAfter: expiryAfter ? new Date(expiryAfter) : undefined,
      skip,
      take,
    });
  }

  @Post('certifications/bulk-revoke')
  @HttpCode(HttpStatus.OK)
  bulkRevokeCertifications(
    @Body() body: { certificationIds: string[]; reason: string },
    @CurrentUser() user: any
  ) {
    return this.adminService.bulkRevokeCertifications(
      body.certificationIds,
      body.reason,
      user.id,
      user.name || user.email
    );
  }

  @Post('certifications/bulk-renew')
  @HttpCode(HttpStatus.OK)
  bulkRenewCertifications(
    @Body() body: { certificationIds: string[] },
    @CurrentUser() user: any
  ) {
    return this.adminService.bulkRenewCertifications(
      body.certificationIds,
      user.id
    );
  }

  @Get('certifications/expiring-soon')
  @HttpCode(HttpStatus.OK)
  getExpiringCertifications(@Query('days') days?: string) {
    const parsedDays = days ? parseInt(days, 10) : 30;
    return this.adminService.getExpiringCertifications(parsedDays);
  }

  @Get('certifications/revoked')
  @HttpCode(HttpStatus.OK)
  getRevokedCertifications(
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(10), ParseIntPipe) take: number
  ) {
    return this.adminService.getRevokedCertifications({ skip, take });
  }

  @Get('certifications/statistics')
  @HttpCode(HttpStatus.OK)
  getCertificationStatistics(
    @Query('period') period?: 'week' | 'month' | 'quarter' | 'year'
  ) {
    return this.adminService.getCertificationStatistics(period || 'month');
  }
}
