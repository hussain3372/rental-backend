import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class CacheService {
  private client: RedisClientType | null = null;
  private readonly logger = new Logger(CacheService.name);
  private isRedisReady = false;
  private useInMemory = false;

  private memoryStore = new Map<
    string,
    { value: string; expiresAt: number | null }
  >();
  private memoryCleanupInterval: NodeJS.Timeout | null = null;
  private lastRedisErrorAt = 0;
  private readonly errorThrottleMs = 2000;

  constructor(private configService: ConfigService) {
    // Use nextTick to avoid blocking Nest's bootstrap
    process.nextTick(() => this.initializeRedis());
  }

  private async initializeRedis() {
    const disableRedis = this.configService.get<string>('DISABLE_REDIS');
    const redisUrl =
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';

    // ✅ Disable Redis explicitly for Render or missing URL
    if (disableRedis === 'true' || disableRedis === '1' || !redisUrl) {
      this.enableInMemoryFallback(
        disableRedis === 'true'
          ? 'Redis disabled via env (DISABLE_REDIS)'
          : 'No REDIS_URL provided'
      );
      return;
    }

    try {
      this.client = createClient({ url: redisUrl });

      this.client.on('error', (err: unknown) => {
        const now = Date.now();
        if (now - this.lastRedisErrorAt > this.errorThrottleMs) {
          this.lastRedisErrorAt = now;
          this.logger.error(`Redis client error: ${this.stringifyError(err)}`);
        }

        // ⚠️ Switch to in-memory after repeated connection errors
        if (!this.isRedisReady) {
          this.enableInMemoryFallback('Redis connection failed');
        }
      });

      this.client.on('connect', () => {
        this.isRedisReady = true;
        this.logger.log('✅ Successfully connected to Redis');
      });

      this.client.on('end', () => {
        this.isRedisReady = false;
        this.logger.warn(
          'Redis connection ended. Switching to in-memory cache.'
        );
        this.enableInMemoryFallback('Redis connection ended');
      });

      await this.client.connect();
      this.isRedisReady = true;
    } catch (error) {
      this.enableInMemoryFallback(
        `Failed to connect to Redis: ${this.stringifyError(error)}`
      );
    }
  }

  private enableInMemoryFallback(reason: string) {
    if (this.useInMemory) return; // prevent duplicate logs
    this.useInMemory = true;
    this.isRedisReady = false;
    this.client = null;
    this.logger.warn(`⚠️ Using in-memory cache fallback. Reason: ${reason}`);
    this.ensureMemoryCleanup();
  }

  private ensureMemoryCleanup() {
    if (this.memoryCleanupInterval) return;
    this.memoryCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.memoryStore.entries()) {
        if (entry.expiresAt && entry.expiresAt <= now) {
          this.memoryStore.delete(key);
        }
      }
    }, 30000);
  }

  private stringifyError(err: unknown): string {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  async onModuleDestroy() {
    try {
      if (this.client && this.isRedisReady) {
        await this.client.quit();
        this.logger.log('🔌 Disconnected from Redis');
      }
    } catch (error) {
      this.logger.error(
        `Error disconnecting from Redis: ${this.stringifyError(error)}`
      );
    } finally {
      if (this.memoryCleanupInterval) {
        clearInterval(this.memoryCleanupInterval);
        this.memoryCleanupInterval = null;
      }
    }
  }

  // Basic cache operations
  async set(key: string, value: any, ttl?: number): Promise<void> {
    const serializedValue = JSON.stringify(value);
    if (this.useInMemory || !this.isRedisReady || !this.client) {
      const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
      this.memoryStore.set(key, { value: serializedValue, expiresAt });
      return;
    }
    try {
      if (ttl) {
        await this.client.setEx(key, ttl, serializedValue);
      } else {
        await this.client.set(key, serializedValue);
      }
    } catch (error) {
      this.logger.error(
        `Error setting cache key: ${key}: ${this.stringifyError(error)}`
      );
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.useInMemory || !this.isRedisReady || !this.client) {
      const entry = this.memoryStore.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        this.memoryStore.delete(key);
        return null;
      }
      return entry.value ? JSON.parse(entry.value) : null;
    }
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      this.logger.error(
        `Error getting cache key: ${key}: ${this.stringifyError(error)}`
      );
      return null;
    }
  }

  async delete(key: string): Promise<boolean> {
    if (this.useInMemory || !this.isRedisReady || !this.client) {
      return this.memoryStore.delete(key);
    }
    try {
      const result = await this.client.del(key);
      return result > 0;
    } catch (error) {
      this.logger.error(
        `Error deleting cache key: ${key}: ${this.stringifyError(error)}`
      );
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (this.useInMemory || !this.isRedisReady || !this.client) {
      const entry = this.memoryStore.get(key);
      if (!entry) return false;
      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        this.memoryStore.delete(key);
        return false;
      }
      return true;
    }
    try {
      const result = await this.client.exists(key);
      return result > 0;
    } catch (error) {
      this.logger.error(
        `Error checking cache key: ${key}: ${this.stringifyError(error)}`
      );
      return false;
    }
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    if (this.useInMemory || !this.isRedisReady || !this.client) {
      const entry = this.memoryStore.get(key);
      if (!entry) return false;
      entry.expiresAt = Date.now() + ttl * 1000;
      this.memoryStore.set(key, entry);
      return true;
    }
    try {
      const result = await this.client.expire(key, ttl);
      return result === true;
    } catch (error) {
      this.logger.error(
        `Error setting expiry for key: ${key}: ${this.stringifyError(error)}`
      );
      return false;
    }
  }

  // Advanced operations
  async setMultiple(data: Record<string, any>, ttl?: number): Promise<void> {
    if (this.useInMemory || !this.isRedisReady || !this.client) {
      const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
      for (const [key, value] of Object.entries(data)) {
        this.memoryStore.set(key, {
          value: JSON.stringify(value),
          expiresAt,
        });
      }
      return;
    }
    try {
      const pipeline = this.client.multi();

      Object.entries(data).forEach(([key, value]) => {
        const serializedValue = JSON.stringify(value);
        if (ttl) {
          pipeline.setEx(key, ttl, serializedValue);
        } else {
          pipeline.set(key, serializedValue);
        }
      });

      await pipeline.exec();
    } catch (error) {
      this.logger.error(
        `Error setting multiple cache keys: ${this.stringifyError(error)}`
      );
    }
  }

  async getMultiple<T>(keys: string[]): Promise<Record<string, T | null>> {
    const result: Record<string, T | null> = {};
    if (this.useInMemory || !this.isRedisReady || !this.client) {
      for (const key of keys) {
        const entry = this.memoryStore.get(key);
        if (!entry) {
          result[key] = null;
        } else if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
          this.memoryStore.delete(key);
          result[key] = null;
        } else {
          result[key] = entry.value ? JSON.parse(entry.value) : null;
        }
      }
      return result;
    }
    try {
      const values = await this.client.mGet(keys);
      keys.forEach((key, index) => {
        const value = values[index];
        result[key] = value ? JSON.parse(value) : null;
      });
      return result;
    } catch (error) {
      this.logger.error(
        `Error getting multiple cache keys: ${this.stringifyError(error)}`
      );
      return {};
    }
  }

  async deleteMultiple(keys: string[]): Promise<number> {
    if (this.useInMemory || !this.isRedisReady || !this.client) {
      let count = 0;
      for (const key of keys) {
        if (this.memoryStore.delete(key)) count += 1;
      }
      return count;
    }
    try {
      const result = await this.client.del(keys);
      return result;
    } catch (error) {
      this.logger.error(
        `Error deleting multiple cache keys: ${this.stringifyError(error)}`
      );
      return 0;
    }
  }

  // Pattern-based operations
  async getByPattern(pattern: string): Promise<Record<string, any>> {
    if (this.useInMemory || !this.isRedisReady || !this.client) {
      const result: Record<string, any> = {};
      const regex = this.patternToRegex(pattern);
      for (const [key, entry] of this.memoryStore.entries()) {
        if (!regex.test(key)) continue;
        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
          this.memoryStore.delete(key);
          continue;
        }
        result[key] = entry.value ? JSON.parse(entry.value) : null;
      }
      return result;
    }
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return {};
      const values = await this.client.mGet(keys);
      const result: Record<string, any> = {};
      keys.forEach((key, index) => {
        const value = values[index];
        if (value) {
          result[key] = JSON.parse(value);
        }
      });
      return result;
    } catch (error) {
      this.logger.error(
        `Error getting keys by pattern: ${pattern}: ${this.stringifyError(error)}`
      );
      return {};
    }
  }

  async deleteByPattern(pattern: string): Promise<number> {
    if (this.useInMemory || !this.isRedisReady || !this.client) {
      const regex = this.patternToRegex(pattern);
      let count = 0;
      for (const key of Array.from(this.memoryStore.keys())) {
        if (regex.test(key)) {
          this.memoryStore.delete(key);
          count += 1;
        }
      }
      return count;
    }
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return 0;
      const result = await this.client.del(keys);
      return result;
    } catch (error) {
      this.logger.error(
        `Error deleting keys by pattern: ${pattern}: ${this.stringifyError(error)}`
      );
      return 0;
    }
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    if (this.useInMemory) return true; // consider in-memory healthy
    try {
      if (!this.client) return false;
      await this.client.ping();
      return true;
    } catch (error) {
      this.logger.error(
        `Redis health check failed: ${this.stringifyError(error)}`
      );
      return false;
    }
  }

  // Utility methods for common patterns
  async remember<T>(
    key: string,
    callback: () => Promise<T>,
    ttl: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const result = await callback();
    await this.set(key, result, ttl);
    return result;
  }

  async invalidateCache(patterns: string[]): Promise<void> {
    try {
      for (const pattern of patterns) {
        await this.deleteByPattern(pattern);
      }
    } catch (error) {
      this.logger.error(
        `Error invalidating cache: ${this.stringifyError(error)}`
      );
    }
  }

  private patternToRegex(pattern: string): RegExp {
    // Convert simple glob-style '*' to regex; escape regex special chars first
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
    return new RegExp(regexStr);
  }
}
