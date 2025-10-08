import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { PropertyTypesService } from './propertyTypes.service';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreatePropertyTypeDto } from './dto/CreatePropertyTypeDto';
import { UpdatePropertyTypeDto } from './dto/UpdatePropertyTypeDto';

@ApiTags('property-types')
@Controller('property-types')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PropertyTypesController {
  constructor(private readonly propertyTypesService: PropertyTypesService) {}

  /**
   * Get all property types (Public endpoint)
   * GET /property-types
   * Query params: activeOnly (true/false)
   */
  @Get()
  @Public()
  @ApiOperation({ summary: 'Get all property types' })
  @ApiQuery({
    name: 'activeOnly',
    required: false,
    type: String,
    description: 'Filter active property types only',
  })
  @HttpCode(HttpStatus.OK)
  async getAllPropertyTypes(@Query('activeOnly') activeOnly?: string) {
    console.log(`🔍 Fetching all property types (activeOnly: ${activeOnly})`);

    try {
      const propertyTypes = await this.propertyTypesService.findAll({
        activeOnly: activeOnly === 'true',
      });

      return {
        message: '✅ Property types retrieved successfully',
        count: propertyTypes.length,
        data: propertyTypes,
      };
    } catch (error) {
      console.error('❌ Failed to fetch property types:', error);
      throw new BadRequestException(
        `Failed to fetch property types: ${error.message}`
      );
    }
  }

  /**
   * Get a single property type by ID
   * GET /property-types/:id
   */
  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get a property type by ID' })
  @HttpCode(HttpStatus.OK)
  async getPropertyTypeById(@Param('id') id: string) {
    console.log(`🔍 Fetching property type: ${id}`);

    try {
      const propertyType = await this.propertyTypesService.findOne(id);

      return {
        message: '✅ Property type retrieved successfully',
        data: propertyType,
      };
    } catch (error) {
      console.error('❌ Failed to fetch property type:', error);
      throw new BadRequestException(
        `Failed to fetch property type: ${error.message}`
      );
    }
  }

  /**
   * Create a new property type (Super Admin only)
   * POST /property-types
   */
  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new property type (Super Admin only)' })
  @HttpCode(HttpStatus.CREATED)
  async createPropertyType(
    @Body() createPropertyTypeDto: CreatePropertyTypeDto
  ) {
    console.log(`📝 Creating new property type: ${createPropertyTypeDto.name}`);

    try {
      const propertyType = await this.propertyTypesService.create(
        createPropertyTypeDto
      );

      return {
        message: '✅ Property type created successfully',
        data: propertyType,
      };
    } catch (error) {
      console.error('❌ Failed to create property type:', error);
      throw new BadRequestException(
        `Failed to create property type: ${error.message}`
      );
    }
  }

  /**
   * Update a property type (Super Admin only)
   * PUT /property-types/:id
   */
  @Put(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update a property type (Super Admin only)' })
  @HttpCode(HttpStatus.OK)
  async updatePropertyType(
    @Param('id') id: string,
    @Body() updatePropertyTypeDto: UpdatePropertyTypeDto
  ) {
    console.log(`✏️ Updating property type: ${id}`);

    try {
      const propertyType = await this.propertyTypesService.update(
        id,
        updatePropertyTypeDto
      );

      return {
        message: '✅ Property type updated successfully',
        data: propertyType,
      };
    } catch (error) {
      console.error('❌ Failed to update property type:', error);
      throw new BadRequestException(
        `Failed to update property type: ${error.message}`
      );
    }
  }

  /**
   * Delete a property type (Super Admin only)
   * DELETE /property-types/:id
   */
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete a property type (Super Admin only)' })
  @HttpCode(HttpStatus.OK)
  async deletePropertyType(@Param('id') id: string) {
    console.log(`🗑️ Deleting property type: ${id}`);

    try {
      await this.propertyTypesService.remove(id);

      return {
        message: '✅ Property type deleted successfully',
      };
    } catch (error) {
      console.error('❌ Failed to delete property type:', error);
      throw new BadRequestException(
        `Failed to delete property type: ${error.message}`
      );
    }
  }
}
