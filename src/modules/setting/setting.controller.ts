import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { SettingService } from './setting.service';
import { UpdateSettingDto } from './dto/setting.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  // POST API: update settings
  @Post()
  async updateSettings(@Req() req, @Body() dto: UpdateSettingDto) {
    const userId = req.user.id; // extracted from JWT payload
    return this.settingService.updateSettings(userId, dto);
  }

  // GET API: fetch current settings
  @Get()
  async getSettings(@Req() req) {
    const userId = req.user.id;
    return this.settingService.getSettings(userId);
  }
}
