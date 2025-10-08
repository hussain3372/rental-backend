import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChecklistDto {
  @ApiProperty({ description: 'ID of the property type this checklist belongs to' })
  @IsString()
  @IsNotEmpty()
  propertyTypeId: string;

  @ApiProperty({ description: 'Name of the checklist item' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Description of the checklist item' })
  @IsString()
  @IsOptional()
  description?: string;
}