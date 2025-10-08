import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { ChecklistService } from './checklist.service';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateChecklistDto } from './dto/CreateChecklistDto';
import { UpdateChecklistDto } from './dto/UpdateChecklistDto';

@ApiTags('checklists')
@Controller('checklists')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChecklistController {
  constructor(private readonly checklistService: ChecklistService) {}

  /**
   * Get checklists by property type (Public endpoint)
   * GET /checklists/by-property-type/:propertyTypeId
   */
  @Get('by-property-type/:propertyTypeId')
  @Public()
  @ApiOperation({ summary: 'Get checklists by property type' })
  @HttpCode(HttpStatus.OK)
  async getChecklistsByPropertyType(
    @Param('propertyTypeId') propertyTypeId: string
  ) {
    console.log(`🔍 Fetching checklists for property type: ${propertyTypeId}`);

    try {
      const checklists =
        await this.checklistService.findByPropertyType(propertyTypeId);

      return {
        message: '✅ Checklists retrieved successfully',
        count: checklists.length,
        data: checklists,
      };
    } catch (error) {
      console.error('❌ Failed to fetch checklists:', error);
      throw new BadRequestException(
        `Failed to fetch checklists: ${error.message}`
      );
    }
  }

  /**
   * Create a new checklist item (Super Admin only)
   * POST /checklists
   */
  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a new checklist item (Super Admin only)' })
  @HttpCode(HttpStatus.CREATED)
  async createChecklist(@Body() createChecklistDto: CreateChecklistDto) {
    console.log(`📝 Creating new checklist item: ${createChecklistDto.name}`);

    try {
      const checklist = await this.checklistService.create(createChecklistDto);

      return {
        message: '✅ Checklist item created successfully',
        data: checklist,
      };
    } catch (error) {
      console.error('❌ Failed to create checklist item:', error);
      throw new BadRequestException(
        `Failed to create checklist item: ${error.message}`
      );
    }
  }

  /**
   * Update a checklist item (Super Admin only)
   * PUT /checklists/:id
   */
  @Put(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update a checklist item (Super Admin only)' })
  @HttpCode(HttpStatus.OK)
  async updateChecklist(
    @Param('id') id: string,
    @Body() updateChecklistDto: UpdateChecklistDto
  ) {
    console.log(`✏️ Updating checklist item: ${id}`);

    try {
      const checklist = await this.checklistService.update(
        id,
        updateChecklistDto
      );

      return {
        message: '✅ Checklist item updated successfully',
        data: checklist,
      };
    } catch (error) {
      console.error('❌ Failed to update checklist item:', error);
      throw new BadRequestException(
        `Failed to update checklist item: ${error.message}`
      );
    }
  }

  /**
   * Delete a checklist item (Super Admin only)
   * DELETE /checklists/:id
   */
  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete a checklist item (Super Admin only)' })
  @HttpCode(HttpStatus.OK)
  async deleteChecklist(@Param('id') id: string) {
    console.log(`🗑️ Deleting checklist item: ${id}`);

    try {
      await this.checklistService.remove(id);

      return {
        message: '✅ Checklist item deleted successfully',
      };
    } catch (error) {
      console.error('❌ Failed to delete checklist item:', error);
      throw new BadRequestException(
        `Failed to delete checklist item: ${error.message}`
      );
    }
  }
}
