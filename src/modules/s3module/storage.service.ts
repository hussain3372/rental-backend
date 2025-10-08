// src/modules/s3module/storage.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject('S3_CLIENT') private readonly s3Client: S3Client,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Upload single file to S3
   */
  async uploadFile(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    path: string,
    ownerId?: string,
    ownerEmail?: string,
    actor?: string
  ): Promise<{ url: string; key: string; name: string }> {
    try {
      const bucket = this.config.get<string>('S3_BUCKET_NAME');
      const region = this.config.get<string>('AWS_REGION');

      const cleanFileName = file.originalname.replace(/\s+/g, '-');
      const filename = `${Date.now()}-${randomUUID()}-${cleanFileName}`;
      const key = `${path.replace(/\/$/, '')}/${filename}`;

      this.logger.log(`Uploading file to S3: ${key}`);

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await this.s3Client.send(command);

      const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

      this.logger.log(`✅ Uploaded ${key} for ${ownerEmail || ownerId || 'unknown'}`);

      return { url, key, name: cleanFileName };
    } catch (error) {
      this.logger.error(`Failed to upload file: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Upload multiple files to S3
   */
  async uploadMultipleFiles(
    files: { buffer: Buffer; originalname: string; mimetype: string }[],
    path: string,
    ownerId?: string,
    ownerEmail?: string,
    actor?: string
  ): Promise<{ url: string; key: string; name: string }[]> {
    try {
      const uploaded: { url: string; key: string; name: string }[] = [];

      for (const file of files) {
        const result = await this.uploadFile(file, path, ownerId, ownerEmail, actor);
        uploaded.push(result);
      }

      this.logger.log(`✅ Successfully uploaded ${uploaded.length} files`);
      return uploaded;
    } catch (error) {
      this.logger.error(`Failed to upload multiple files: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Upload images to S3 and create Image records linked to Application
   */
  async uploadApplicationImages(
    files: { buffer: Buffer; originalname: string; mimetype: string }[],
    applicationId: string,
    ownerEmail?: string,
    actor?: string
  ): Promise<{ uploaded: { url: string; key: string; name: string }[] }> {
    try {
      // Upload files to S3
      const uploaded = await this.uploadMultipleFiles(
        files,
        `applications/${applicationId}/images`,
        applicationId,
        ownerEmail,
        actor
      );

      // Create Image records for each upload
      await this.prisma.$transaction(
        uploaded.map(img =>
          (this.prisma as any).image.create({
            data: {
              applicationId,
              name: img.name,
              key: img.key,
              url: img.url,
            },
          })
        )
      );

      this.logger.log(
        `✅ Updated application ${applicationId} with ${uploaded.length} new images`
      );

      return { uploaded };
    } catch (error) {
      this.logger.error(
        `Failed to upload application images: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Delete file from S3
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const bucket = this.config.get<string>('S3_BUCKET_NAME');
      const cmd = new DeleteObjectCommand({ Bucket: bucket, Key: key });
      await this.s3Client.send(cmd);
      this.logger.log(`🗑️ Deleted file: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete file: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Delete image from DB and S3
   */
  async deleteApplicationImage(
    applicationId: string,
    imageKey: string
  ): Promise<void> {
    try {
      // Delete image record if it belongs to the application
      await (this.prisma as any).image.delete({
        where: { key: imageKey },
      });

      // Delete from S3
      await this.deleteFile(imageKey);

      this.logger.log(
        `🗑️ Deleted image ${imageKey} from application ${applicationId}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to delete application image: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * List all files in S3 bucket or specific prefix
   */
  async listFiles(
    prefix?: string
  ): Promise<
    Array<{ key: string; url: string; size: number; lastModified: Date }>
  > {
    try {
      const bucket = this.config.get<string>('S3_BUCKET_NAME');
      const region = this.config.get<string>('AWS_REGION');

      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
      });

      const data = await this.s3Client.send(command);

      const files = (data.Contents || []).map(item => ({
        key: item.Key,
        url: `https://${bucket}.s3.${region}.amazonaws.com/${item.Key}`,
        size: item.Size,
        lastModified: item.LastModified,
      }));

      this.logger.log(`📁 Listed ${files.length} files from S3`);
      return files;
    } catch (error) {
      this.logger.error(`Failed to list files: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get application images from database
   */
  async getApplicationImages(applicationId: string): Promise<any[]> {
    try {
      const images = await (this.prisma as any).image.findMany({
        where: { applicationId },
        orderBy: { uploadedAt: 'desc' },
      });

      return images;
    } catch (error) {
      this.logger.error(
        `Failed to get application images: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }
}