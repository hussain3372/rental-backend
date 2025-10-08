import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Response,
  StreamableFile,
  ParseIntPipe,
} from '@nestjs/common';
import { DocumentService } from './document.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Response as ExpressResponse } from 'express';
import { DocumentType, UserRole } from '@prisma/client';

@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  /**
   * Upload single or multiple documents
   * POST /documents/upload/:applicationId
   * Field name: "files" (works for both single and multiple)
   * Body: documentType (optional)
   */
  @Post('upload/:applicationId')
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB per file
      },
      fileFilter: (req, file, cb) => {
        const allowed = [
          'image/jpeg',
          'image/png',
          'image/jpg',
          'image/webp',
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];
        if (!allowed.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              `Unsupported file type: ${file.mimetype}. Allowed types: JPG, PNG, PDF, DOC, DOCX`
            ),
            false
          );
        }
        cb(null, true);
      },
    })
  )
  
  @HttpCode(HttpStatus.CREATED)
  async uploadDocuments(
    @Param('applicationId') applicationId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('documentType') documentType?: string,
    @CurrentUser() user?: any,
  ) {
    // Validate files
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    console.log(`📤 Uploading ${files.length} document(s) for application: ${applicationId}`);

    // Parse document type
    const typeEnum = documentType ? (documentType as keyof typeof DocumentType) : 'OTHER';
    const docType = DocumentType[typeEnum] || DocumentType.OTHER;

    try {
      // Use the multiple upload service method (works for single file too)
      const result = await this.documentService.uploadMultipleDocuments(
        applicationId,
        files,
        user.id,
        user.email,
        user.role,
        docType,
      );

      return {
        message: `✅ ${result.created.length} document(s) uploaded successfully`,
        count: result.created.length,
        uploaded: result.created,
        skipped: result.skipped,
      };
    } catch (error) {
      console.error('❌ Document upload error:', error);
      throw new BadRequestException(`Failed to upload documents: ${error.message}`);
    }
  }

  /**
   * Get all documents for an application
   * GET /documents/application/:applicationId
   */
  @Get('application/:applicationId')
  @HttpCode(HttpStatus.OK)
  async getDocumentsForApplication(
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: any,
  ) {
    return this.documentService.getDocumentsForApplication(
      applicationId,
      user.id,
      user.role,
    );
  }

  /**
   * Get document requirements for an application
   * GET /documents/requirements/:applicationId
   */
  @Get('requirements/:applicationId')
  @HttpCode(HttpStatus.OK)
  async getDocumentRequirements(@Param('applicationId') applicationId: string) {
    return this.documentService.getDocumentRequirements(applicationId);
  }

  /**
   * Validate if document step is complete
   * GET /documents/validate-step/:applicationId
   */
  @Get('validate-step/:applicationId')
  @HttpCode(HttpStatus.OK)
  async validateDocumentStepCompletion(
    @Param('applicationId') applicationId: string,
  ) {
    return this.documentService.validateDocumentStepCompletion(applicationId);
  }

  /**
   * Download a document
   * GET /documents/download/:documentId
   */
  @Get('download/:documentId')
  @HttpCode(HttpStatus.OK)
  async downloadDocument(
    @Param('documentId') documentId: string,
    @CurrentUser() user: any,
    @Response({ passthrough: true }) res: ExpressResponse,
  ) {
    const { stream, contentType, fileName } =
      await this.documentService.downloadDocument(
        documentId,
        user.id,
        user.email,
        user.role,
      );

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    return new StreamableFile(stream);
  }

  /**
   * Delete a document
   * DELETE /documents/:documentId
   */
  @Delete(':documentId')
  @HttpCode(HttpStatus.OK)
  async deleteDocument(
    @Param('documentId') documentId: string,
    @CurrentUser() user: any,
  ) {
    return this.documentService.deleteDocument(
      documentId,
      user.id,
      user.email,
      user.role,
    );
  }

  /**
   * Get validation rules for a document type
   * GET /documents/types/:documentType/validation
   */
  @Get('types/:documentType/validation')
  @HttpCode(HttpStatus.OK)
  async getDocumentTypeValidationRules(
    @Param('documentType') documentType: string,
  ) {
    const type = documentType as keyof typeof DocumentType;
    return this.documentService.getDocumentTypeValidationRules(
      DocumentType[type],
    );
  }

  /**
   * Admin: Get all documents with filters
   * GET /documents/admin/all
   */
  @Get('admin/all')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async getAllDocuments(
    @Query('applicationId') applicationId?: string,
    @Query('documentType') documentType?: DocumentType,
    @Query('skip') skip?: number,
    @Query('take') take?: number,
  ) {
    // Parse query parameters
    const skipNum = skip ? parseInt(skip.toString(), 10) : 0;
    const takeNum = take ? parseInt(take.toString(), 10) : 50;

    return {
      message: 'Admin document listing endpoint',
      filters: {
        applicationId,
        documentType,
        skip: skipNum,
        take: takeNum,
      },
      // TODO: Implement actual document listing logic
      documents: [],
      total: 0,
    };
  }
}