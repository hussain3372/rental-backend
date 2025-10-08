import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('✅ Successfully connected to database');

      // Query logging removed - use Prisma Studio or database logs for monitoring
    } catch (error) {
      this.logger.error('❌ Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.logger.log('🔌 Disconnected from database');
    } catch (error) {
      this.logger.error('❌ Error disconnecting from database', error);
    }
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('❌ Database health check failed', error);
      return false;
    }
  }

  // Transaction helper
  async executeTransaction<T>(
    operation: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (prisma) => {
      return operation(prisma as PrismaClient);
    });
  }

  // Clean up method for testing
  async cleanDatabase() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('cleanDatabase can only be used in test environment');
    }

    const models = Object.keys(this).filter(
      (key) => key[0] !== '_' && key[0] !== '$' && typeof this[key] === 'object',
    );

    for (const model of models) {
      if (this[model]?.deleteMany) {
        await this[model].deleteMany({});
      }
    }
  }
}
