export interface StorageConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

export interface UploadOptions {
  bucket?: string;
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  metadata?: Record<string, string>;
  acl?: 'private' | 'public-read' | 'public-read-write';
  expires?: Date;
  serverSideEncryption?: string;
  storageClass?: 'STANDARD' | 'REDUCED_REDUNDANCY' | 'STANDARD_IA' | 'ONEZONE_IA' | 'INTELLIGENT_TIERING' | 'GLACIER' | 'DEEP_ARCHIVE';
}

export interface DownloadOptions {
  bucket?: string;
  key: string;
  range?: string;
}

export interface DeleteOptions {
  bucket?: string;
  key: string;
}

export interface ListOptions {
  bucket?: string;
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  etag: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface ListResult {
  objects: StorageObject[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

export interface PresignedUrlOptions {
  bucket?: string;
  key: string;
  operation: 'getObject' | 'putObject' | 'deleteObject';
  expiresIn?: number; // seconds
  contentType?: string;
}

export interface IStorageProvider {
  upload(options: UploadOptions): Promise<{ key: string; url: string; etag: string }>;
  download(options: DownloadOptions): Promise<{ body: Buffer; contentType?: string; metadata?: Record<string, string> }>;
  delete(options: DeleteOptions): Promise<void>;
  list(options: ListOptions): Promise<ListResult>;
  exists(bucket: string, key: string): Promise<boolean>;
  getPresignedUrl(options: PresignedUrlOptions): Promise<string>;
  createBucket(bucket: string): Promise<void>;
  deleteBucket(bucket: string): Promise<void>;
}