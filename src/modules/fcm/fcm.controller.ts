// src/modules/notification/fcm.controller.ts
import {
  Controller,
  Post,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FCMService } from './fcm.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { IsString } from 'class-validator';

class SaveFCMTokenDto {
  @IsString()
  fcmToken: string;
}

class TestNotificationDto {
  userId?: number;
}

@Controller('fcm')
@UseGuards(JwtAuthGuard)
export class FCMController {
  constructor(
    private readonly fcmService: FCMService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Save or update user's FCM token
   */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  async saveToken(@CurrentUser() user: any, @Body() dto: SaveFCMTokenDto) {
    console.log('[FCMController] Incoming saveToken request');
    console.log('[FCMController] CurrentUser:', user);
    console.log('[FCMController] Request Body DTO:', dto);

    if (!user?.id) {
      console.error(
        '[FCMController] ❌ User ID is missing from CurrentUser payload'
      );
    }

    const token = dto?.fcmToken;

    if (!token) {
      throw new BadRequestException('fcmToken is required');
    }

    await this.fcmService.saveUserToken(user.id, dto.fcmToken);

    console.log(
      '[FCMController] ✅ FCM token saved successfully',
      dto.fcmToken
    );

    return {
      message: 'FCM token saved successfully',
      success: true,
    };
  }

  /**
   * Remove user's FCM token (logout)
   */
  @Delete('token')
  @HttpCode(HttpStatus.OK)
  async removeToken(@CurrentUser() user: any) {
    await this.fcmService.removeUserToken(user.id);

    return {
      message: 'FCM token removed successfully',
      success: true,
    };
  }

  /**
   * Send test notification to current user
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  async sendTestNotification(@CurrentUser() user: any) {
    const result = await this.fcmService.sendTestNotification(user.id);

    if (result.success) {
      return {
        message: 'Test notification sent successfully',
        messageId: result.messageId,
      };
    } else {
      return {
        message: 'Failed to send test notification',
        error: result.error,
      };
    }
  }

  /**
   * Update notification preferences
   */
  @Post('preferences')
  @HttpCode(HttpStatus.OK)
  async updatePreferences(
    @CurrentUser() user: any,
    @Body() dto: { isNotification: boolean; isEmail?: boolean }
  ) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isNotification: dto.isNotification,
        ...(dto.isEmail !== undefined && { isEmail: dto.isEmail }),
      },
    });

    return {
      message: 'Notification preferences updated successfully',
      preferences: {
        isNotification: dto.isNotification,
        isEmail: dto.isEmail,
      },
    };
  }

  /**
   * Get notification preferences
   */
  @Post('preferences/get')
  @HttpCode(HttpStatus.OK)
  async getPreferences(@CurrentUser() user: any) {
    const userPrefs = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        isNotification: true,
        isEmail: true,
        fcmToken: true,
      },
    });

    return {
      isNotification: userPrefs.isNotification,
      isEmail: userPrefs.isEmail,
      hasToken: !!userPrefs.fcmToken,
    };
  }

  /**
   * Send test notification to specific user (for testing)
   */
  @Post('test-notification')
  @HttpCode(HttpStatus.OK)
  async sendTestNotificationToUser(
    @CurrentUser() user: any,
    @Body() dto: { userId?: number; message?: string }
  ) {
    const targetUserId = dto.userId || user.id;
    const message =
      dto.message || 'This is a test notification from Rental Host Backend';

    const result = await this.fcmService.sendToUser(targetUserId, {
      title: 'Test Notification',
      body: message,
      data: {
        type: 'test',
        timestamp: new Date().toISOString(),
        from: 'backend-test',
      },
    });

    return {
      success: result.success,
      message: result.success
        ? 'Test notification sent successfully'
        : 'Failed to send test notification',
      error: result.error,
      messageId: result.messageId,
    };
  }
}
