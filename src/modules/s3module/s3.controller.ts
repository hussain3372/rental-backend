import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { StorageService } from './storage.service';

const memoryStorage = multer.memoryStorage();

@Controller('applications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class S3Controller {
  constructor(private readonly storageService: StorageService) {}

  /**
   * Upload image(s) for an application
   * POST /applications/:id/upload-images
   */
  @Post(':id/upload-images')
  @Roles(UserRole.HOST)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: { fileSize: 5 * 1024 * 1024, files: 10 },
      storage: memoryStorage,
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          return cb(new BadRequestException('Only image files are allowed!'), false);
        }
        cb(null, true);
      },
    })
  )
  
  async uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: any
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const normalized = files.map(file => ({
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    }));

    const result = await this.storageService.uploadApplicationImages(
      normalized,
      id,
      user.email,
      'HOST'
    );

    return {
      message: `✅ ${result.uploaded.length} file(s) uploaded successfully`,
      count: result.uploaded.length,
      uploaded: result.uploaded,
    };
  }

  /**
   * Get all images for a specific application (from database)
   * GET /applications/:id/images
   */
  @Get(':id/images')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getApplicationImages(@Param('id') id: string) {
    const images = await this.storageService.getApplicationImages(id);
    return { applicationId: id, count: images.length, images };
  }

  /**
   * Get all images from S3 for a specific application
   * GET /applications/:id/images/s3
   */
  @Get(':id/images/s3')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getApplicationImagesFromS3(@Param('id') id: string) {
    const files = await this.storageService.listFiles(`applications/${id}/images`);
    return { applicationId: id, count: files.length, images: files };
  }

  /**
   * Delete an image from application and S3
   * DELETE /applications/:id/images/:key
   */
  @Delete(':id/images/:key(*)')
  @Roles(UserRole.HOST, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async deleteApplicationImage(
    @Param('id') id: string,
    @Param('key') key: string
  ) {
    const decodedKey = decodeURIComponent(key);
    await this.storageService.deleteApplicationImage(id, decodedKey);
    return { message: '🗑️ Image deleted successfully', applicationId: id, key: decodedKey };
  }

  /**
   * Get all images across all applications (admin only)
   * GET /applications/images/all
   */
  @Get('images/all')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async getAllImages() {
    const files = await this.storageService.listFiles('applications/');
    return { count: files.length, images: files };
  }
}


