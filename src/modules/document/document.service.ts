import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { Document, DocumentType, UserRole, ApplicationStatus } from '@prisma/client';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { AuditService } from '../audit/audit.service';
import { EnhancedLoggerService } from '../../common/logger/enhanced-logger.service';

export interface DocumentWithDetails extends Document {
  application: {
    id: string;
    hostId: number;
    status: ApplicationStatus;
  };
}

@Injectable()
export class DocumentService {
  private readonly documentValidationRules = {
    [DocumentType.ID_DOCUMENT]: {
      maxSize: 5 * 1024 * 1024, // 5MB
      allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf'],
      required: true,
      description: 'Government-issued photo ID (passport, driver\'s license, etc.)'
    },
    [DocumentType.SAFETY_PERMIT]: {
      maxSize: 10 * 1024 * 1024, // 10MB
      allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf'],
      required: true,
      description: 'Safety inspection certificate or permit'
    },
    [DocumentType.INSURANCE_CERTIFICATE]: {
      maxSize: 10 * 1024 * 1024, // 10MB
      allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf'],
      required: true,
      description: 'Property insurance certificate'
    },
    [DocumentType.PROPERTY_DEED]: {
      maxSize: 10 * 1024 * 1024, // 10MB
      allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf'],
      required: true,
      description: 'Property ownership deed or lease agreement'
    },
    [DocumentType.OTHER]: {
      maxSize: 10 * 1024 * 1024, // 10MB
      allowedTypes: ['image/jpeg', 'image/png', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx'],
      required: false,
      description: 'Additional supporting documents'
    }
  };

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private auditService: AuditService,
    private logger: EnhancedLoggerService,
  ) {}

  async uploadDocument(
    applicationId: string,
    uploadDto: UploadDocumentDto,
    file: Express.Multer.File,
    userId: number,
    userEmail: string,
    userRole: UserRole
  ): Promise<Document> {
    // Validate application access
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    // Check permissions
    if (userRole === UserRole.HOST && application.hostId !== userId) {
      throw new ForbiddenException('You can only upload documents to your own applications');
    }

    // Only allow uploads for draft or under review applications
    if (application.status !== ApplicationStatus.DRAFT && application.status !== ApplicationStatus.UNDER_REVIEW) {
      throw new BadRequestException('Cannot upload documents to submitted applications');
    }

    // Check if document type already exists for this application
    const existingDocument = await this.prisma.document.findFirst({
      where: {
        applicationId,
        documentType: uploadDto.documentType,
      },
    });

    if (existingDocument && uploadDto.documentType !== DocumentType.OTHER) {
      throw new BadRequestException(`A ${uploadDto.documentType.toLowerCase().replace('_', ' ')} document already exists for this application`);
    }

    // Get validation rules for this document type
    const validationRules = this.documentValidationRules[uploadDto.documentType];

    // Upload file to storage
    const uploadResult = await this.storageService.uploadFile(
      file,
      `applications/${applicationId}/documents`,
      userId.toString(),
      userEmail,
      userRole.toLowerCase(),
      {
        maxSize: validationRules.maxSize,
        allowedTypes: validationRules.allowedTypes,
        allowedExtensions: validationRules.allowedExtensions,
      }
    );

    // Create document record
    const document = await this.prisma.document.create({
      data: {
        applicationId,
        fileName: uploadResult.key,
        originalName: file.originalname,
        mimeType: uploadResult.contentType,
        size: uploadResult.size,
        url: uploadResult.url,
        documentType: uploadDto.documentType,
      },
    });

    // Audit the document upload
    await this.auditService.auditFileOperation(
      'DOCUMENT_UPLOAD',
      document.id,
      userId.toString(),
      userEmail,
      userRole.toLowerCase(),
      {
        applicationId,
        documentType: uploadDto.documentType,
        fileSize: uploadResult.size,
        originalName: file.originalname,
      }
    );

    this.logger.log(
      `Document uploaded: ${document.id}`,
      'DocumentService',
      {
        applicationId,
        documentType: uploadDto.documentType,
        userId,
        fileSize: uploadResult.size
      }
    );

    return document;
  }

  async uploadMultipleDocuments(
    applicationId: string,
    files: Express.Multer.File[],
    userId: number,
    userEmail: string,
    userRole: UserRole,
    documentType: DocumentType
  ): Promise<{ created: Document[]; skipped: { reason: string; name: string }[] } > {
    // Validate application access
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw new NotFoundException('Application not found');
    }

    if (userRole === UserRole.HOST && application.hostId !== userId) {
      throw new ForbiddenException('You can only upload documents to your own applications');
    }

    if (application.status !== ApplicationStatus.DRAFT && application.status !== ApplicationStatus.UNDER_REVIEW) {
      throw new BadRequestException('Cannot upload documents to submitted applications');
    }

    const validationRules = this.documentValidationRules[documentType];

    const created: Document[] = [];
    const skipped: { reason: string; name: string }[] = [];

    const folder = `applications/${applicationId}/documents`;

    for (const file of files) {
      try {
        const upload = await this.storageService.uploadFile(
          file,
          folder,
          userId.toString(),
          userEmail,
          userRole.toLowerCase(),
          {
            maxSize: validationRules.maxSize,
            allowedTypes: validationRules.allowedTypes,
            allowedExtensions: validationRules.allowedExtensions,
          }
        );

        const document = await this.prisma.document.create({
          data: {
            applicationId,
            fileName: upload.key,
            originalName: file.originalname,
            mimeType: upload.contentType,
            size: upload.size,
            url: upload.url,
            documentType,
          },
        });

        await this.auditService.auditFileOperation(
          'DOCUMENT_UPLOAD',
          document.id,
          userId.toString(),
          userEmail,
          userRole.toLowerCase(),
          {
            applicationId,
            documentType,
            fileSize: upload.size,
            originalName: file.originalname,
          }
        );

        created.push(document);
      } catch (err) {
        skipped.push({ reason: 'Upload or DB insert failed', name: file.originalname });
      }
    }

    return { created, skipped };
  }

  async getDocumentsForApplication(
    applicationId: string,
    userId: number,
    userRole: UserRole
  ): Promise<DocumentWithDetails[]> {
    // Validate application access
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, hostId: true, status: true }
    });

    if (!application) {
      throw new NotFoundException('Application not found');
    }

    // Check permissions
    if (userRole === UserRole.HOST && application.hostId !== userId) {
      throw new ForbiddenException('You can only view documents from your own applications');
    }

    const documents = await this.prisma.document.findMany({
      where: { applicationId },
      include: {
        application: {
          select: {
            id: true,
            hostId: true,
            status: true,
          }
        }
      },
      orderBy: { uploadedAt: 'desc' },
    });

    return documents as DocumentWithDetails[];
  }

  async downloadDocument(
    documentId: string,
    userId: number,
    userEmail: string,
    userRole: UserRole
  ): Promise<{ stream: any; contentType: string; fileName: string }> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        application: {
          select: { id: true, hostId: true }
        }
      }
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Check permissions
    if (userRole === UserRole.HOST && document.application.hostId !== userId) {
      throw new ForbiddenException('You can only download documents from your own applications');
    }

    // Download from storage
    const downloadResult = await this.storageService.downloadFile(
      document.fileName,
      userId.toString(),
      userEmail,
      userRole.toLowerCase()
    );

    // Audit the download
    await this.auditService.auditFileOperation(
      'DOCUMENT_DOWNLOAD',
      documentId,
      userId.toString(),
      userEmail,
      userRole.toLowerCase(),
      {
        applicationId: document.applicationId,
        documentType: document.documentType,
        originalName: document.originalName,
      }
    );

    return {
      stream: downloadResult.body,
      contentType: document.mimeType,
      fileName: document.originalName,
    };
  }

  async deleteDocument(
    documentId: string,
    userId: number,
    userEmail: string,
    userRole: UserRole
  ): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        application: {
          select: { id: true, hostId: true, status: true }
        }
      }
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Check permissions
    if (userRole === UserRole.HOST && document.application.hostId !== userId) {
      throw new ForbiddenException('You can only delete documents from your own applications');
    }

    // Only allow deletion for draft applications
    if (document.application.status !== ApplicationStatus.DRAFT) {
      throw new BadRequestException('Cannot delete documents from submitted applications');
    }

    // Delete from storage
    await this.storageService.deleteFile(
      document.fileName,
      userId.toString(),
      userEmail,
      userRole.toLowerCase()
    );

    // Delete document record
    await this.prisma.document.delete({
      where: { id: documentId },
    });

    // Audit the deletion
    await this.auditService.auditFileOperation(
      'DOCUMENT_DELETE',
      documentId,
      userId.toString(),
      userEmail,
      userRole.toLowerCase(),
      {
        applicationId: document.applicationId,
        documentType: document.documentType,
        originalName: document.originalName,
      }
    );

    this.logger.log(
      `Document deleted: ${documentId}`,
      'DocumentService',
      {
        applicationId: document.applicationId,
        documentType: document.documentType,
        userId
      }
    );
  }

  async getDocumentRequirements(applicationId: string): Promise<{
    required: Array<{
      type: DocumentType;
      description: string;
      uploaded: boolean;
      documentId?: string;
    }>;
    optional: Array<{
      type: DocumentType;
      description: string;
      uploaded: boolean;
      documentId?: string;
    }>;
  }> {
    // Get existing documents for this application
    const existingDocuments = await this.prisma.document.findMany({
      where: { applicationId },
      select: {
        id: true,
        documentType: true,
      }
    });

    const uploadedTypes = new Set(existingDocuments.map(doc => doc.documentType));
    const documentMap = new Map(existingDocuments.map(doc => [doc.documentType, doc.id]));

    const required = [];
    const optional = [];

    for (const [type, rules] of Object.entries(this.documentValidationRules)) {
      const documentType = type as DocumentType;
      const uploaded = uploadedTypes.has(documentType);
      const documentId = documentMap.get(documentType);

      const item = {
        type: documentType,
        description: rules.description,
        uploaded,
        documentId,
      };

      if (rules.required) {
        required.push(item);
      } else {
        optional.push(item);
      }
    }

    return { required, optional };
  }

  async validateDocumentStepCompletion(applicationId: string): Promise<{
    isComplete: boolean;
    missingRequired: DocumentType[];
    message: string;
  }> {
    const requirements = await this.getDocumentRequirements(applicationId);

    const missingRequired = requirements.required
      .filter(req => !req.uploaded)
      .map(req => req.type);

    const isComplete = missingRequired.length === 0;

    let message = '';
    if (isComplete) {
      message = 'All required documents have been uploaded successfully.';
    } else {
      message = `Missing required documents: ${missingRequired.map(type =>
        type.toLowerCase().replace('_', ' ')
      ).join(', ')}`;
    }

    return {
      isComplete,
      missingRequired,
      message,
    };
  }

  getDocumentTypeValidationRules(documentType: DocumentType) {
    return this.documentValidationRules[documentType] || null;
  }
}
