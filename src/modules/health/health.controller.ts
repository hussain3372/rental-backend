import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth() {
    return this.healthService.getHealthStatus();
  }

  @Get('detailed')
  async getDetailedHealth(): Promise<any> {
    return this.healthService.getDetailedHealthStatus();
  }

  @Get('database')
  async getDatabaseHealth() {
    return this.healthService.getDatabaseHealth();
  }

  @Get('cache')
  async getCacheHealth() {
    return this.healthService.getCacheHealth();
  }

  @Get('email')
  async getEmailHealth() {
    return this.healthService.getEmailHealth();
  }
}
