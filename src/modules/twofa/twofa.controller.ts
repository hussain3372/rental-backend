import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { TwofaService } from './twofa.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // Adjust path as needed
import { VerifyOTPDto } from './dto/VerifyOTPDto';
import { UpdateMFADto } from './dto/UpdateMFADto';

@Controller('twofa')
@UseGuards(JwtAuthGuard) // Protect all routes with authentication
export class TwofaController {
  constructor(private readonly twofaService: TwofaService) {}

  // POST /twofa/send-otp - Send OTP to logged-in user
  @Post('send-otp')
  async sendOTP(@Request() req) {
    const userId = req.user.id; // Assuming user ID is in JWT payload
    return this.twofaService.sendOTP(userId);
  }

  // POST /twofa/verify-otp - Verify OTP and enable MFA
  @Post('verify-otp')
  async verifyOTP(@Request() req, @Body() verifyOTPDto: VerifyOTPDto) {
    const userId = req.user.id;
    return this.twofaService.verifyOTP(userId, verifyOTPDto.otp);
  }

  // PUT /twofa/status - Update MFA status (enable/disable)
  @Put('status')
  async updateMFAStatus(@Request() req, @Body() updateMFADto: UpdateMFADto) {
    const userId = req.user.id;
    return this.twofaService.updateMFAStatus(userId, updateMFADto.mfaEnabled);
  }

  // GET /twofa/status - Get MFA status
  @Get('status')
  async getMFAStatus(@Request() req) {
    const userId = req.user.id;
    return this.twofaService.getMFAStatus(userId);
  }
}
