import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3StorageProvider } from './providers/s3-storage.provider';
import { EnhancedLoggerService } from '../../common/logger/enhanced-logger.service';
import { AuditService } from '../audit/audit.service';
import * as path from 'path';
import * as crypto from 'crypto';

export interface FileUploadResult {
  key: string;
  url: string;
  etag: string;
  size: number;
  contentType: string;
  uploadedAt: Date;
}

export interface FileValidationOptions {
  maxSize?: number;
  allowedTypes?: string[];
  allowedExtensions?: string[];
}

@Injectable()
export class StorageService {
  private readonly defaultValidation: FileValidationOptions = {
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.pdf'],
  };

  constructor(
    private s3Provider: S3StorageProvider,
    private configService: ConfigService,
    private logger: EnhancedLoggerService,
    private auditService: AuditService,
  ) {}

  async uploadFile(
    file: Express.Multer.File | { buffer: Buffer; originalname: string; mimetype: string },
    folder: string,
    userId?: string,
    userEmail?: string,
    userRole?: string,
    validationOptions?: FileValidationOptions
  ): Promise<FileUploadResult> {
    const validation = { ...this.defaultValidation, ...validationOptions };
    
    // Validate file
    this.validateFile(file, validation);

    // Generate secure file key
    const fileExtension = path.extname(file.originalname).toLowerCase();
    const fileName = path.basename(file.originalname, fileExtension);
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const hash = crypto.randomBytes(8).toString('hex');
    
    const key = `${folder}/${timestamp}-${hash}-${sanitizedFileName}${fileExtension}`;

    try {
      const result = await this.s3Provider.upload({
        key,
        body: file.buffer,
        contentType: file.mimetype,
        metadata: {
          originalName: file.originalname,
          uploadedBy: userId || 'anonymous',
          uploadedAt: new Date().toISOString(),
          folder,
        },
      });

      const uploadResult: FileUploadResult = {
        key: result.key,
        url: result.url,
        etag: result.etag,
        size: file.buffer.length,
        contentType: file.mimetype,
        uploadedAt: new Date(),
      };

      // Log and audit the upload
      this.logger.logFileOperation('UPLOAD', key, file.buffer.length, {
        userId,
        userEmail,
        userRole,
        contentType: file.mimetype,
        folder,
      });

      if (userId) {
        await this.auditService.auditFileOperation(
          'FILE_UPLOAD',
          key,
          userId,
          userEmail || '',
          userRole || 'HOST',
          {
            originalName: file.originalname,
            size: file.buffer.length,
            contentType: file.mimetype,
            folder,
          }
        );
      }

      return uploadResult;
    } catch (error) {
      this.logger.error(
        `File upload failed: ${file.originalname}`,
        error.stack,
        'StorageService',
        { userId, folder }
      );
      throw error;
    }
  }

  async uploadMultipleFiles(
    files: (Express.Multer.File | { buffer: Buffer; originalname: string; mimetype: string })[],
    folder: string,
    userId?: string,
    userEmail?: string,
    userRole?: string,
    validationOptions?: FileValidationOptions
  ): Promise<FileUploadResult[]> {
    const results: FileUploadResult[] = [];
    
    for (const file of files) {
      try {
        const result = await this.uploadFile(file, folder, userId, userEmail, userRole, validationOptions);
        results.push(result);
      } catch (error) {
        this.logger.error(
          `Failed to upload file in batch: ${file.originalname}`,
          error.stack,
          'StorageService',
          { userId, folder }
        );
        // Continue with other files, but log the failure
      }
    }

    return results;
  }

  async downloadFile(key: string, userId?: string, userEmail?: string, userRole?: string) {
    try {
      const result = await this.s3Provider.download({ key });
      
      this.logger.logFileOperation('DOWNLOAD', key, result.body.length, {
        userId,
        userEmail,
        userRole,
        contentType: result.contentType,
      });

      if (userId) {
        await this.auditService.auditFileOperation(
          'FILE_DOWNLOAD',
          key,
          userId,
          userEmail || '',
          userRole || 'HOST',
          {
            size: result.body.length,
            contentType: result.contentType,
          }
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        `File download failed: ${key}`,
        error.stack,
        'StorageService',
        { userId }
      );
      throw new NotFoundException(`File not found: ${key}`);
    }
  }

  async deleteFile(key: string, userId?: string, userEmail?: string, userRole?: string): Promise<void> {
    try {
      // Check if file exists first
      const bucket = this.configService.get<string>('AWS_S3_BUCKET')
        || this.configService.get<string>('S3_BUCKET_NAME')
        || 'rental-host-images';
      const exists = await this.s3Provider.exists(bucket, key);
      
      if (!exists) {
        throw new NotFoundException(`File not found: ${key}`);
      }

      await this.s3Provider.delete({ key });
      
      this.logger.logFileOperation('DELETE', key, undefined, {
        userId,
        userEmail,
        userRole,
      });

      if (userId) {
        await this.auditService.auditFileOperation(
          'FILE_DELETE',
          key,
          userId,
          userEmail || '',
          userRole || 'HOST',
          {}
        );
      }
    } catch (error) {
      this.logger.error(
        `File deletion failed: ${key}`,
        error.stack,
        'StorageService',
        { userId }
      );
      throw error;
    }
  }

  async getPresignedUploadUrl(
    fileName: string,
    folder: string,
    contentType: string,
    expiresIn: number = 3600,
    userId?: string
  ): Promise<{ uploadUrl: string; key: string }> {
    const fileExtension = path.extname(fileName).toLowerCase();
    const baseName = path.basename(fileName, fileExtension);
    const sanitizedFileName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const hash = crypto.randomBytes(8).toString('hex');
    
    const key = `${folder}/${timestamp}-${hash}-${sanitizedFileName}${fileExtension}`;

    try {
      const uploadUrl = await this.s3Provider.getPresignedUrl({
        key,
        operation: 'putObject',
        expiresIn,
        contentType,
      });

      this.logger.log(
        `Generated presigned upload URL: ${key}`,
        'StorageService',
        { userId, folder, expiresIn }
      );

      return { uploadUrl, key };
    } catch (error) {
      this.logger.error(
        `Failed to generate presigned upload URL: ${fileName}`,
        error.stack,
        'StorageService',
        { userId, folder }
      );
      throw error;
    }
  }

  async getPresignedDownloadUrl(
    key: string,
    expiresIn: number = 3600,
    userId?: string
  ): Promise<string> {
    try {
      const downloadUrl = await this.s3Provider.getPresignedUrl({
        key,
        operation: 'getObject',
        expiresIn,
      });

      this.logger.log(
        `Generated presigned download URL: ${key}`,
        'StorageService',
        { userId, expiresIn }
      );

      return downloadUrl;
    } catch (error) {
      this.logger.error(
        `Failed to generate presigned download URL: ${key}`,
        error.stack,
        'StorageService',
        { userId }
      );
      throw error;
    }
  }

  async listFiles(folder: string, maxFiles: number = 100): Promise<any> {
    try {
      const result = await this.s3Provider.list({
        prefix: folder,
        maxKeys: maxFiles,
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to list files in folder: ${folder}`,
        error.stack,
        'StorageService'
      );
      throw error;
    }
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      return await this.s3Provider.exists(this.configService.get<string>('AWS_S3_BUCKET'), key);
    } catch (error) {
      this.logger.error(
        `Failed to check file existence: ${key}`,
        error.stack,
        'StorageService'
      );
      return false;
    }
  }

  private validateFile(
    file: Express.Multer.File | { buffer: Buffer; originalname: string; mimetype: string },
    options: FileValidationOptions
  ): void {
    // Check file size
    if (options.maxSize && file.buffer.length > options.maxSize) {
      throw new BadRequestException(
        `File size ${file.buffer.length} bytes exceeds maximum allowed size ${options.maxSize} bytes`
      );
    }

    // Check MIME type
    if (options.allowedTypes && !options.allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type ${file.mimetype} is not allowed. Allowed types: ${options.allowedTypes.join(', ')}`
      );
    }

    // Check file extension
    if (options.allowedExtensions) {
      const fileExtension = path.extname(file.originalname).toLowerCase();
      if (!options.allowedExtensions.includes(fileExtension)) {
        throw new BadRequestException(
          `File extension ${fileExtension} is not allowed. Allowed extensions: ${options.allowedExtensions.join(', ')}`
        );
      }
    }

    // Check for empty files
    if (file.buffer.length === 0) {
      throw new BadRequestException('File cannot be empty');
    }

    // Basic security check - ensure filename doesn't contain path traversal
    if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
      throw new BadRequestException('Invalid filename');
    }
  }
}