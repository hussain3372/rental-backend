import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class ProcessRefundDto {
  @IsString()
  paymentId: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number; // If not provided, full refund

  @IsOptional()
  @IsString()
  reason?: string;
}
