// src/modules/notification/fcm.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EnhancedLoggerService } from '../../common/logger/enhanced-logger.service';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  priority?: 'high' | 'normal';
  sound?: string;
  badge?: number;
}

export interface SendNotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
  invalidToken?: boolean;
}

@Injectable()
export class FCMService implements OnModuleInit {
  private readonly logger = new Logger(FCMService.name);
  private firebaseApp: admin.app.App;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private enhancedLogger: EnhancedLoggerService
  ) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    try {
      // Check if already initialized
      if (admin.apps.length > 0) {
        this.firebaseApp = admin.app();
        this.logger.log('[FCMService] Firebase Admin SDK already initialized');
        return;
      }

      const serviceAccountPath = this.configService.get<string>(
        'FIREBASE_SERVICE_ACCOUNT_PATH'
      );
      const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');

      this.logger.debug(
        `[FCMService] FIREBASE_SERVICE_ACCOUNT_PATH: ${serviceAccountPath}`
      );
      this.logger.debug(`[FCMService] FIREBASE_PROJECT_ID: ${projectId}`);

      if (!serviceAccountPath || !projectId) {
        this.logger.warn(
          '[FCMService] Firebase configuration not found. Push notifications will be disabled.'
        );
        return;
      }

      // Try to load service account
      let serviceAccount;
      try {
        this.logger.debug(
          `[FCMService] Attempting to load service account file from: ${serviceAccountPath}`
        );
        serviceAccount = require(serviceAccountPath);
        this.logger.debug(
          '[FCMService] Service account file loaded successfully'
        );
      } catch (requireError) {
        this.logger.error(
          '[FCMService] ❌ Could not load Firebase service account file.',
          requireError.stack
        );
        return;
      }

      // Initialize Firebase Admin SDK
      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: projectId,
      });

      this.logger.log(
        '[FCMService] ✅ Firebase Admin SDK initialized successfully'
      );
    } catch (error) {
      this.logger.error(
        '[FCMService] ❌ Failed to initialize Firebase Admin SDK',
        error.stack
      );
    }
  }

  /**
   * Send push notification to a single device
   */
  async sendToDevice(
    fcmToken: string,
    payload: PushNotificationPayload,
    userId?: number
  ): Promise<SendNotificationResult> {
    try {
      if (!this.firebaseApp) {
        this.logger.warn(
          'Firebase not initialized. Push notification skipped.'
        );
        return { success: false, error: 'Firebase not initialized' };
      }

      if (!fcmToken || fcmToken.trim() === '') {
        this.logger.warn('Empty FCM token provided');
        return { success: false, error: 'Empty FCM token' };
      }

      const message: admin.messaging.Message = {
        token: fcmToken,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.imageUrl && { imageUrl: payload.imageUrl }),
        },
        data: payload.data || {},
        android: {
          priority: payload.priority || 'high',
          notification: {
            sound: payload.sound || 'default',
            channelId: 'default',
            priority: payload.priority === 'high' ? 'high' : 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: payload.title,
                body: payload.body,
              },
              sound: payload.sound || 'default',
              badge: payload.badge,
            },
          },
        },
        webpush: {
          notification: {
            title: payload.title,
            body: payload.body,
            icon: payload.imageUrl,
          },
        },
      };

      const response = await admin.messaging().send(message);

      this.enhancedLogger.log(
        `Push notification sent successfully: ${response}`,
        'FCMService',
        { userId, fcmResponse: response }
      );

      return {
        success: true,
        messageId: response,
      };
    } catch (error) {
      this.handleSendError(error, fcmToken, userId);

      return {
        success: false,
        error: error.message,
        invalidToken: this.isInvalidTokenError(error),
      };
    }
  }

  /**
   * Send push notification to multiple devices
   */
  async sendToMultipleDevices(
    fcmTokens: string[],
    payload: PushNotificationPayload
  ): Promise<{
    successCount: number;
    failureCount: number;
    invalidTokens: string[];
  }> {
    const validTokens = fcmTokens.filter(token => token && token.trim() !== '');

    if (validTokens.length === 0) {
      this.logger.warn('No valid FCM tokens provided');
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const message: admin.messaging.MulticastMessage = {
      tokens: validTokens,
      notification: {
        title: payload.title,
        body: payload.body,
        ...(payload.imageUrl && { imageUrl: payload.imageUrl }),
      },
      data: payload.data || {},
      android: {
        priority: payload.priority || 'high',
        notification: {
          sound: payload.sound || 'default',
          channelId: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: payload.title,
              body: payload.body,
            },
            sound: payload.sound || 'default',
            badge: payload.badge,
          },
        },
      },
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);

      const invalidTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && this.isInvalidTokenError(resp.error)) {
          invalidTokens.push(validTokens[idx]);
        }
      });

      // Clean up invalid tokens
      if (invalidTokens.length > 0) {
        await this.removeInvalidTokens(invalidTokens);
      }

      this.enhancedLogger.log(
        `Multicast notification sent: ${response.successCount} success, ${response.failureCount} failed`,
        'FCMService',
        {
          multicastSuccessCount: response.successCount,
          multicastFailureCount: response.failureCount,
          invalidTokensCount: invalidTokens.length,
        }
      );

      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        invalidTokens,
      };
    } catch (error) {
      this.logger.error('Failed to send multicast notification', error.stack);
      throw error;
    }
  }

  /**
   * Send notification to a user by userId
   */
  async sendToUser(
    userId: number,
    payload: PushNotificationPayload
  ): Promise<SendNotificationResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true, isNotification: true },
    });

    if (!user) {
      this.logger.warn(`User not found: ${userId}`);
      return { success: false, error: 'User not found' };
    }

    if (!user.isNotification) {
      this.logger.log(`User ${userId} has notifications disabled`);
      return { success: false, error: 'Notifications disabled by user' };
    }

    if (!user.fcmToken) {
      this.logger.warn(`No FCM token for user: ${userId}`);
      return { success: false, error: 'No FCM token' };
    }

    return this.sendToDevice(user.fcmToken, payload, userId);
  }

  /**
   * Send notification to multiple users
   */
  async sendToUsers(
    userIds: number[],
    payload: PushNotificationPayload
  ): Promise<{
    successCount: number;
    failureCount: number;
  }> {
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        isNotification: true,
        fcmToken: { not: null },
      },
      select: { fcmToken: true },
    });

    const tokens = users.map(user => user.fcmToken).filter(Boolean);

    if (tokens.length === 0) {
      this.logger.warn('No valid users with FCM tokens found');
      return { successCount: 0, failureCount: 0 };
    }

    const result = await this.sendToMultipleDevices(tokens, payload);

    return {
      successCount: result.successCount,
      failureCount: result.failureCount,
    };
  }

  /**
   * Send notification to all admins
   */
  async sendToAdmins(payload: PushNotificationPayload): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: {
        role: { in: ['ADMIN', 'SUPER_ADMIN'] },
        isNotification: true,
        fcmToken: { not: null },
      },
      select: { fcmToken: true },
    });

    const tokens = admins.map(admin => admin.fcmToken).filter(Boolean);

    if (tokens.length > 0) {
      await this.sendToMultipleDevices(tokens, payload);
    }
  }

  /**
   * Subscribe token to a topic
   */
  async subscribeToTopic(
    tokens: string | string[],
    topic: string
  ): Promise<void> {
    try {
      const tokenArray = Array.isArray(tokens) ? tokens : [tokens];
      const response = await admin
        .messaging()
        .subscribeToTopic(tokenArray, topic);

      this.logger.log(
        `Subscribed to topic ${topic}: ${response.successCount} success, ${response.failureCount} failed`
      );
    } catch (error) {
      this.logger.error(`Failed to subscribe to topic ${topic}`, error.stack);
      throw error;
    }
  }

  /**
   * Unsubscribe token from a topic
   */
  async unsubscribeFromTopic(
    tokens: string | string[],
    topic: string
  ): Promise<void> {
    try {
      const tokenArray = Array.isArray(tokens) ? tokens : [tokens];
      const response = await admin
        .messaging()
        .unsubscribeFromTopic(tokenArray, topic);

      this.logger.log(
        `Unsubscribed from topic ${topic}: ${response.successCount} success, ${response.failureCount} failed`
      );
    } catch (error) {
      this.logger.error(
        `Failed to unsubscribe from topic ${topic}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Send notification to a topic
   */
  async sendToTopic(
    topic: string,
    payload: PushNotificationPayload
  ): Promise<string> {
    try {
      const message: admin.messaging.Message = {
        topic,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.imageUrl && { imageUrl: payload.imageUrl }),
        },
        data: payload.data || {},
      };

      const messageId = await admin.messaging().send(message);
      this.logger.log(`Topic notification sent: ${messageId}`);
      return messageId;
    } catch (error) {
      this.logger.error(`Failed to send to topic ${topic}`, error.stack);
      throw error;
    }
  }

  /**
   * Save or update user's FCM token
   */
  async saveUserToken(userId: number, fcmToken: string): Promise<void> {
    try {
      this.logger.debug(
        `[FCMService] Saving FCM token. userId=${userId}, token=${fcmToken}`
      );

      await this.prisma.user.update({
        where: { id: userId },
        data: { fcmToken },
      });

      this.logger.log(`[FCMService] ✅ FCM token saved for user ${userId}`);
    } catch (error) {
      this.logger.error(
        `[FCMService] ❌ Failed to save FCM token for user ${userId}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Remove user's FCM token
   */
  async removeUserToken(userId: number): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { fcmToken: null },
      });

      this.logger.log(`FCM token removed for user ${userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to remove FCM token for user ${userId}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Helper: Check if error is related to invalid token
   */
  private isInvalidTokenError(error: any): boolean {
    if (!error) return false;

    const errorCode = error.code || error.errorInfo?.code;
    const invalidTokenCodes = [
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'messaging/invalid-argument',
    ];

    return invalidTokenCodes.includes(errorCode);
  }

  /**
   * Helper: Handle send errors
   */
  private async handleSendError(
    error: any,
    fcmToken: string,
    userId?: number
  ): Promise<void> {
    this.enhancedLogger.error(
      `Failed to send push notification`,
      error.stack,
      'FCMService',
      { userId, fcmErrorCode: error.code }
    );

    // If token is invalid, remove it from database
    if (this.isInvalidTokenError(error) && userId) {
      await this.removeUserToken(userId);
    }
  }

  /**
   * Helper: Remove invalid tokens from database
   */
  private async removeInvalidTokens(tokens: string[]): Promise<void> {
    try {
      await this.prisma.user.updateMany({
        where: { fcmToken: { in: tokens } },
        data: { fcmToken: null },
      });

      this.logger.log(`Removed ${tokens.length} invalid FCM tokens`);
    } catch (error) {
      this.logger.error('Failed to remove invalid tokens', error.stack);
    }
  }

  /**
   * Test notification - useful for debugging
   */
  async sendTestNotification(userId: number): Promise<SendNotificationResult> {
    return this.sendToUser(userId, {
      title: 'Test Notification',
      body: 'This is a test notification from Rental Host',
      data: {
        type: 'test',
        timestamp: new Date().toISOString(),
      },
    });
  }
}
