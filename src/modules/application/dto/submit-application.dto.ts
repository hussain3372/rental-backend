import { IsOptional, IsString } from 'class-validator';

export class SubmitApplicationDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
