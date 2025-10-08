import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class DefaultChecklistItemDto {
  @ApiProperty({ description: 'Name of the checklist item' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Description of the checklist item' })
  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdatePropertyTypeDto {
  @ApiProperty({ description: 'Name of the property type' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Description of the property type' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether the property type is active',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Default checklist items to create alongside the property type',
    type: [DefaultChecklistItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DefaultChecklistItemDto)
  @IsOptional()
  defaultChecklist?: DefaultChecklistItemDto[];
}
