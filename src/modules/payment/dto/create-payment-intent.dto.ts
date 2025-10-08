import { IsString, IsNumber, IsOptional, Min, Max, IsIn } from 'class-validator';

export class CreatePaymentIntentDto {
  @IsString()
  applicationId: string;

  @IsNumber()
  @Min(0.01)
  @Max(10000)
  amount: number;

  @IsOptional()
  @IsString()
  @IsIn(['USD', 'EUR', 'GBP'])
  currency?: string = 'USD';

  @IsOptional()
  @IsString()
  description?: string;
}
