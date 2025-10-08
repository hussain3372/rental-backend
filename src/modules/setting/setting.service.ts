import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateSettingDto } from './dto/setting.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingService {
  constructor(private prisma: PrismaService) {}

  async updateSettings(userId: number, dto: UpdateSettingDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    this.prisma.user.update({
      where: { id: userId },
      data: {
        isEmail: dto.isEmailStatus ?? user.isEmail,
        isNotification: dto.isNotificationStatus ?? user.isNotification,
      }
    });

    return {
      message: 'Recored Update Successfully',
      status: 'success',
      data: {
        userId: userId,
        isEmail: true,
        isNotification: true,
      },
    };
  }

  async getSettings(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isEmail: true,
        isNotification: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      isEmailStatus: user.isEmail,
      isNotificationStatus: user.isNotification,
    };
  }
}
