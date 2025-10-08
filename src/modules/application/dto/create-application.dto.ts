import { IsOptional, IsObject } from 'class-validator';

export class CreateApplicationDto {
  @IsOptional()
  @IsObject()
  propertyDetails?: Record<string, any>;
}
