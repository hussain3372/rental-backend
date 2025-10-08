import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType | null = null;
  private readonly logger = new Logger(RedisService.name);
  private isConnecting = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const disableRedis = this.configService.get<string>('DISABLE_REDIS');
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';

    if (disableRedis === 'true' || disableRedis === '1') {
      this.logger.warn('⚠️ Redis disabled via DISABLE_REDIS env; skipping connection');
      return;
    }

    this.isConnecting = true;

    try {
      this.client = createClient({ 
        url: redisUrl,
        socket: {
          connectTimeout: 5000, // 5 second timeout
          reconnectStrategy: (retries) => {
            if (retries > 3) {
              this.logger.error('❌ Redis reconnection failed after 3 attempts');
              return false; // Stop reconnecting
            }
            return Math.min(retries * 100, 3000);
          }
        }
      });

      // Handle errors without crashing
      this.client.on('error', (err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Redis client error: ${errorMsg}`);
        // Don't rethrow - just log it
      });

      this.client.on('ready', () => {
        this.logger.log('✅ Connected to Redis');
      });

      this.client.on('reconnecting', () => {
        this.logger.warn('⚠️ Redis reconnecting...');
      });

      this.client.on('end', () => {
        this.logger.warn('⚠️ Redis connection closed');
      });

      // Connect with timeout
      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
        )
      ]);

      this.logger.log('✅ Successfully connected to Redis');
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`⚠️ Failed to connect to Redis: ${errorMsg}`);
      this.logger.warn('⚠️ Proceeding without Redis - using fallback');
      
      // Clean up failed client
      if (this.client) {
        try {
          await this.client.disconnect();
        } catch (disconnectError) {
          // Ignore disconnect errors
        }
        this.client = null;
      }
    } finally {
      this.isConnecting = false;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
        this.logger.log('✅ Redis connection closed gracefully');
      } catch (e) {
        this.logger.error('❌ Error closing Redis connection');
      }
    }
  }

  /**
   * Check if Redis is connected and available
   */
  isConnected(): boolean {
    return this.client?.isOpen ?? false;
  }

  /**
   * Set a key-value pair with optional TTL
   */
  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    if (!this.client || !this.isConnected()) {
      this.logger.debug(`Redis not available, skipping SET for key: ${key}`);
      return false;
    }
    
    try {
      if (ttl) {
        await this.client.setEx(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (e) {
      this.logger.error(`Failed to SET key ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /**
   * Get a value by key
   */
  async get(key: string): Promise<string | null> {
    if (!this.client || !this.isConnected()) {
      this.logger.debug(`Redis not available, skipping GET for key: ${key}`);
      return null;
    }
    
    try {
      return await this.client.get(key);
    } catch (e) {
      this.logger.error(`Failed to GET key ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /**
   * Delete a key
   */
  async del(key: string): Promise<boolean> {
    if (!this.client || !this.isConnected()) {
      this.logger.debug(`Redis not available, skipping DEL for key: ${key}`);
      return false;
    }
    
    try {
      await this.client.del(key);
      return true;
    } catch (e) {
      this.logger.error(`Failed to DEL key ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.client || !this.isConnected()) {
      return false;
    }
    
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (e) {
      this.logger.error(`Failed to check EXISTS for key ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /**
   * Set expiration on a key
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    if (!this.client || !this.isConnected()) {
      return false;
    }
    
    try {
      await this.client.expire(key, seconds);
      return true;
    } catch (e) {
      this.logger.error(`Failed to EXPIRE key ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /**
   * Get TTL of a key
   */
  async ttl(key: string): Promise<number> {
    if (!this.client || !this.isConnected()) {
      return -2; // Key doesn't exist
    }
    
    try {
      return await this.client.ttl(key);
    } catch (e) {
      this.logger.error(`Failed to get TTL for key ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return -2;
    }
  }
}
