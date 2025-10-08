import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { MailService } from '../../common/mail/mail.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService,
    private cacheService: CacheService,
    private mailService: MailService,
  ) {}

  async getHealthStatus() {
    const checks = await this.performHealthChecks();

    const isHealthy = checks.every(check => check.healthy);

    return {
      success: true,
      data: {
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: this.configService.get<string>('NODE_ENV', 'development'),
        version: process.env.npm_package_version || '1.0.0',
        checks: checks.reduce((acc, check) => {
          acc[check.name] = {
            status: check.healthy ? 'up' : 'down',
            responseTime: check.responseTime,
          };
          return acc;
        }, {}),
      },
    };
  }

  async getDetailedHealthStatus() {
    const checks = await this.performHealthChecks();

    return {
      success: true,
      data: {
        status: checks.every(check => check.healthy) ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: this.configService.get<string>('NODE_ENV', 'development'),
        version: process.env.npm_package_version || '1.0.0',
        checks,
      },
    };
  }

  async getDatabaseHealth() {
    try {
      const startTime = Date.now();
      const isHealthy = await this.prismaService.healthCheck();
      const responseTime = Date.now() - startTime;

      return {
        success: true,
        data: {
          service: 'database',
          healthy: isHealthy,
          responseTime,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return {
        success: false,
        error: {
          code: 'DATABASE_HEALTH_CHECK_FAILED',
          message: 'Database health check failed',
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  async getCacheHealth() {
    try {
      const startTime = Date.now();
      const isHealthy = await this.cacheService.healthCheck();
      const responseTime = Date.now() - startTime;

      return {
        success: true,
        data: {
          service: 'cache',
          healthy: isHealthy,
          responseTime,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Cache health check failed', error);
      return {
        success: false,
        error: {
          code: 'CACHE_HEALTH_CHECK_FAILED',
          message: 'Cache health check failed',
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  async getEmailHealth() {
    try {
      const startTime = Date.now();
      const isHealthy = await this.mailService.healthCheck();
      const responseTime = Date.now() - startTime;

      return {
        success: true,
        data: {
          service: 'email',
          healthy: isHealthy,
          responseTime,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Email health check failed', error);
      return {
        success: false,
        error: {
          code: 'EMAIL_HEALTH_CHECK_FAILED',
          message: 'Email health check failed',
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  private async performHealthChecks(): Promise<HealthCheckResult[]> {
    const checks: HealthCheckResult[] = [];

    // Database check
    try {
      const startTime = Date.now();
      const isHealthy = await this.prismaService.healthCheck();
      const responseTime = Date.now() - startTime;

      checks.push({
        name: 'database',
        healthy: isHealthy,
        responseTime,
        details: isHealthy ? 'Connected' : 'Connection failed',
      });
    } catch (error) {
      checks.push({
        name: 'database',
        healthy: false,
        responseTime: 0,
        details: error.message,
      });
    }

    // Cache check
    try {
      const startTime = Date.now();
      const isHealthy = await this.cacheService.healthCheck();
      const responseTime = Date.now() - startTime;

      checks.push({
        name: 'cache',
        healthy: isHealthy,
        responseTime,
        details: isHealthy ? 'Connected' : 'Connection failed',
      });
    } catch (error) {
      checks.push({
        name: 'cache',
        healthy: false,
        responseTime: 0,
        details: error.message,
      });
    }

    // Email check
    try {
      const startTime = Date.now();
      const isHealthy = await this.mailService.healthCheck();
      const responseTime = Date.now() - startTime;

      checks.push({
        name: 'email',
        healthy: isHealthy,
        responseTime,
        details: isHealthy ? 'Connected' : 'Connection failed',
      });
    } catch (error) {
      checks.push({
        name: 'email',
        healthy: false,
        responseTime: 0,
        details: error.message,
      });
    }

    // System resources check
    const memUsage = process.memoryUsage();
    const isMemoryHealthy = memUsage.heapUsed / memUsage.heapTotal < 0.9;

    checks.push({
      name: 'memory',
      healthy: isMemoryHealthy,
      responseTime: 0,
      details: `Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB, Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
    });

    return checks;
  }
}

interface HealthCheckResult {
  name: string;
  healthy: boolean;
  responseTime: number;
  details?: string;
}
