import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand, CreateBucketCommand, DeleteBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { IStorageProvider, UploadOptions, DownloadOptions, DeleteOptions, ListOptions, ListResult, PresignedUrlOptions, StorageObject } from '../interfaces/storage.interface';
import { EnhancedLoggerService } from '../../../common/logger/enhanced-logger.service';

@Injectable()
export class S3StorageProvider implements IStorageProvider {
  private s3Client: S3Client;
  private defaultBucket: string;
  private isLocal: boolean;

  constructor(
    private configService: ConfigService,
    private logger: EnhancedLoggerService,
  ) {
    this.initializeS3Client();
    this.defaultBucket =
      this.configService.get<string>('AWS_S3_BUCKET') ||
      this.configService.get<string>('S3_BUCKET_NAME') ||
      'rental-host-images';
  }

  private initializeS3Client() {
    this.isLocal = this.configService.get<boolean>('USE_LOCAL_STORAGE', false) === true;
    
    if (this.isLocal) {
      // MinIO configuration for local development
      this.s3Client = new S3Client({
        endpoint: this.configService.get<string>('MINIO_ENDPOINT', 'http://localhost:9000'),
        region: 'eu-north-1', // MinIO doesn't care about region, but AWS SDK requires it
        credentials: {
          accessKeyId: this.configService.get<string>('MINIO_ACCESS_KEY', 'minioadmin'),
          secretAccessKey: this.configService.get<string>('MINIO_SECRET_KEY', 'minioadmin123'),
        },
        forcePathStyle: true, // Required for MinIO
      });
    } else {
      // AWS S3 configuration for production
      this.s3Client = new S3Client({
        region: this.configService.get<string>('AWS_REGION', 'eu-north-1'),
        credentials: {
          accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
          secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
        },
      });
    }

    this.logger.log('S3 Storage Provider initialized', 'S3StorageProvider');
  }

  async upload(options: UploadOptions): Promise<{ key: string; url: string; etag: string }> {
    const bucket = options.bucket || this.defaultBucket;
    let attemptedAwsFallback = false;
    
    try {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: options.key,
        Body: options.body,
        ContentType: options.contentType,
        Metadata: options.metadata,
        ACL: options.acl || 'private',
        Expires: options.expires,
        // ServerSideEncryption: options.serverSideEncryption, // Removed due to type issues
        StorageClass: options.storageClass,
      });

      const result = await this.s3Client.send(command);
      
      const url = this.getObjectUrl(bucket, options.key);
      
      this.logger.logFileOperation(
        'UPLOAD',
        options.key,
        Buffer.isBuffer(options.body) ? options.body.length : options.body.toString().length,
        {
          bucket,
          contentType: options.contentType,
          etag: result.ETag,
        }
      );

      return {
        key: options.key,
        url,
        etag: result.ETag || '',
      };
    } catch (error) {
      // If using local storage (MinIO) and connection is refused, fall back to AWS once
      const isConnRefused = (error?.code === 'ECONNREFUSED') || (error?.message || '').includes('ECONNREFUSED');
      if (this.isLocal && isConnRefused && !attemptedAwsFallback) {
        attemptedAwsFallback = true;
        // Switch to AWS client and retry once
        this.isLocal = false;
        this.s3Client = new S3Client({
          region: this.configService.get<string>('AWS_REGION', 'eu-north-1'),
          credentials: {
            accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
            secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
          },
        });
        this.logger.log('MinIO connection failed, falling back to AWS S3 for this upload', 'S3StorageProvider');
        return await this.upload(options);
      }
      this.logger.error(
        `Failed to upload file: ${options.key}`,
        error.stack,
        'S3StorageProvider',
        { bucket, key: options.key }
      );
      const reason = error?.message || error?.name || 'Unknown error';
      throw new BadRequestException(`Failed to upload file: ${reason}`);
    }
  }

  async download(options: DownloadOptions): Promise<{ body: Buffer; contentType?: string; metadata?: Record<string, string> }> {
    const bucket = options.bucket || this.defaultBucket;
    
    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: options.key,
        Range: options.range,
      });

      const result = await this.s3Client.send(command);
      
      const body = await this.streamToBuffer(result.Body as any);
      
      this.logger.logFileOperation(
        'DOWNLOAD',
        options.key,
        body.length,
        {
          bucket,
          contentType: result.ContentType,
        }
      );

      return {
        body,
        contentType: result.ContentType,
        metadata: result.Metadata,
      };
    } catch (error) {
      this.logger.error(
        `Failed to download file: ${options.key}`,
        error.stack,
        'S3StorageProvider',
        { bucket, key: options.key }
      );
      const reason = error?.message || error?.name || 'Unknown error';
      throw new BadRequestException(`Failed to download file: ${reason}`);
    }
  }

  async delete(options: DeleteOptions): Promise<void> {
    const bucket = options.bucket || this.defaultBucket;
    
    try {
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: options.key,
      });

      await this.s3Client.send(command);
      
      this.logger.logFileOperation(
        'DELETE',
        options.key,
        undefined,
        { bucket }
      );
    } catch (error) {
      this.logger.error(
        `Failed to delete file: ${options.key}`,
        error.stack,
        'S3StorageProvider',
        { bucket, key: options.key }
      );
      const reason = error?.message || error?.name || 'Unknown error';
      throw new BadRequestException(`Failed to delete file: ${reason}`);
    }
  }

  async list(options: ListOptions): Promise<ListResult> {
    const bucket = options.bucket || this.defaultBucket;
    
    try {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: options.prefix,
        MaxKeys: options.maxKeys || 1000,
        ContinuationToken: options.continuationToken,
      });

      const result = await this.s3Client.send(command);
      
      const objects: StorageObject[] = (result.Contents || []).map(obj => ({
        key: obj.Key || '',
        size: obj.Size || 0,
        lastModified: obj.LastModified || new Date(),
        etag: obj.ETag || '',
      }));

      return {
        objects,
        isTruncated: result.IsTruncated || false,
        nextContinuationToken: result.NextContinuationToken,
      };
    } catch (error) {
      this.logger.error(
        `Failed to list objects in bucket: ${bucket}`,
        error.stack,
        'S3StorageProvider',
        { bucket, prefix: options.prefix }
      );
      const reason = error?.message || error?.name || 'Unknown error';
      throw new BadRequestException(`Failed to list objects: ${reason}`);
    }
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  async getPresignedUrl(options: PresignedUrlOptions): Promise<string> {
    const bucket = options.bucket || this.defaultBucket;
    const expiresIn = options.expiresIn || 3600; // 1 hour default
    
    try {
      let command;
      
      switch (options.operation) {
        case 'getObject':
          command = new GetObjectCommand({
            Bucket: bucket,
            Key: options.key,
          });
          break;
        case 'putObject':
          command = new PutObjectCommand({
            Bucket: bucket,
            Key: options.key,
            ContentType: options.contentType,
          });
          break;
        case 'deleteObject':
          command = new DeleteObjectCommand({
            Bucket: bucket,
            Key: options.key,
          });
          break;
        default:
          throw new BadRequestException(`Unsupported operation: ${options.operation}`);
      }

      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      
      this.logger.log(
        `Generated presigned URL for ${options.operation}: ${options.key}`,
        'S3StorageProvider',
        {
          bucket,
          key: options.key,
          operation: options.operation,
          expiresIn,
        }
      );

      return url;
    } catch (error) {
      this.logger.error(
        `Failed to generate presigned URL: ${options.key}`,
        error.stack,
        'S3StorageProvider',
        { bucket, key: options.key, operation: options.operation }
      );
      const reason = error?.message || error?.name || 'Unknown error';
      throw new BadRequestException(`Failed to generate presigned URL: ${reason}`);
    }
  }

  async createBucket(bucket: string): Promise<void> {
    try {
      const command = new CreateBucketCommand({
        Bucket: bucket,
      });

      await this.s3Client.send(command);
      
      this.logger.log(`Bucket created: ${bucket}`, 'S3StorageProvider');
    } catch (error) {
      if (error.name !== 'BucketAlreadyExists' && error.name !== 'BucketAlreadyOwnedByYou') {
        this.logger.error(
          `Failed to create bucket: ${bucket}`,
          error.stack,
          'S3StorageProvider'
        );
        throw new BadRequestException(`Failed to create bucket: ${error.message}`);
      }
    }
  }

  async deleteBucket(bucket: string): Promise<void> {
    try {
      const command = new DeleteBucketCommand({
        Bucket: bucket,
      });

      await this.s3Client.send(command);
      
      this.logger.log(`Bucket deleted: ${bucket}`, 'S3StorageProvider');
    } catch (error) {
      this.logger.error(
        `Failed to delete bucket: ${bucket}`,
        error.stack,
        'S3StorageProvider'
      );
      throw new BadRequestException(`Failed to delete bucket: ${error.message}`);
    }
  }

  private async streamToBuffer(stream: any): Promise<Buffer> {
    const chunks: Buffer[] = [];
    
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  }

  private getObjectUrl(bucket: string, key: string): string {
    const isLocal = this.configService.get<boolean>('USE_LOCAL_STORAGE', false) === true;
    
    if (isLocal) {
      const endpoint = this.configService.get<string>('MINIO_ENDPOINT', 'http://localhost:9000');
      return `${endpoint}/${bucket}/${key}`;
    } else {
      const region = this.configService.get<string>('AWS_REGION', 'eu-north-1');
      return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    }
  }
}