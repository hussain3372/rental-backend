import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit {
  private client: RedisClientType | null = null;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const disableRedis = this.configService.get<string>('DISABLE_REDIS');
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';

    if (disableRedis === 'true' || disableRedis === '1') {
      this.logger.warn('Redis disabled via DISABLE_REDIS env; skipping connection');
      return;
    }

    try {
      this.client = createClient({ url: redisUrl });
      this.client.on('error', (err: unknown) => {
        this.logger.error(`Redis client error: ${err instanceof Error ? err.message : String(err)}`);
      });
      await this.client.connect();
      this.logger.log('✅ Connected to Redis');
    } catch (e) {
      this.logger.warn('⚠️ Failed to connect to Redis; proceeding without Redis');
      this.client = null;
    }
  }

  async set(key: string, value: string, ttl?: number) {
    if (!this.client) return; // silently no-op when Redis disabled/unavailable
    if (ttl) await this.client.setEx(key, ttl, value);
    else await this.client.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(key);
  }
}
