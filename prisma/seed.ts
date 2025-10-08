import { PrismaClient, UserRole, UserStatus, ApplicationStatus, ApplicationStep, CertificationStatus, DocumentType, PaymentStatus, NotificationType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Hash password for default users
  const hashedPassword = await bcrypt.hash('AdminPassword123!', 12);

  // Create super admin user
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@rentalcertification.com' },
    update: {},
    create: {
      email: 'admin@rentalcertification.com',
      password: hashedPassword,
      name: 'Super Admin',
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  console.log('✅ Super admin created:', superAdmin.email);

  // Create regular admin user
  const admin = await prisma.user.upsert({
    where: { email: 'reviewer@rentalcertification.com' },
    update: {},
    create: {
      email: 'reviewer@rentalcertification.com',
      password: hashedPassword,
      name: 'Admin Reviewer',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  console.log('✅ Admin user created:', admin.email);

  // Create sample host user
  const hostPassword = await bcrypt.hash('HostPassword123!', 12);
  const hostUser = await prisma.user.upsert({
    where: { email: 'host@example.com' },
    update: {},
    create: {
      email: 'host@example.com',
      password: hostPassword,
      name: 'John Doe',
      role: UserRole.HOST,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  console.log('✅ Sample host user created:', hostUser.email);

  // Create sample application for the host
  const application = await prisma.application.create({
    data: {
      hostId: hostUser.id,
      status: ApplicationStatus.DRAFT,
      currentStep: ApplicationStep.PROPERTY_DETAILS,
      propertyDetails: {
        propertyName: 'Cozy Downtown Apartment',
        address: '456 Oak Avenue, Anytown, ST 12345',
        propertyType: 'Apartment',
        bedrooms: 2,
        bathrooms: 1,
        maxGuests: 4,
        description: 'A beautiful downtown apartment perfect for short-term stays.',
      },
      complianceChecklist: {
        fireDetectors: false,
        fireExtinguisher: false,
        firstAidKit: false,
        emergencyExits: false,
        carbonMonoxideDetector: false,
      },
    },
  });

  console.log('✅ Sample application created for host:', hostUser.name);

  // Create sample documents for the application
  const sampleDocuments = [
    {
      applicationId: application.id,
      fileName: 'property_deed.pdf',
      originalName: 'Property Deed - 456 Oak Avenue.pdf',
      mimeType: 'application/pdf',
      size: 1024000,
      url: 'https://example.com/documents/property_deed.pdf',
      documentType: DocumentType.PROPERTY_DEED,
    },
    {
      applicationId: application.id,
      fileName: 'insurance_cert.pdf',
      originalName: 'Insurance Certificate.pdf',
      mimeType: 'application/pdf',
      size: 512000,
      url: 'https://example.com/documents/insurance_cert.pdf',
      documentType: DocumentType.INSURANCE_CERTIFICATE,
    },
  ];

  await prisma.document.createMany({
    data: sampleDocuments,
  });

  console.log('✅ Sample documents created');

  // Create sample notifications
  const sampleNotifications = [
    {
      userId: hostUser.id,
      type: NotificationType.APPLICATION_STATUS,
      title: 'Application Created',
      message: 'Your certification application has been created successfully.',
      data: { applicationId: application.id },
    },
    {
      userId: admin.id,
      type: NotificationType.ADMIN_MESSAGE,
      title: 'New Application Submitted',
      message: 'A new certification application requires review.',
      data: { applicationId: application.id, hostName: hostUser.name },
    },
  ];

  await prisma.notification.createMany({
    data: sampleNotifications,
  });

  console.log('✅ Sample notifications created');

  // Create system configuration entries
  const systemConfigs = [
    {
      key: 'certification_validity_months',
      value: 12,
      description: 'Number of months a certification remains valid',
    },
    {
      key: 'application_fee_usd',
      value: 99.00,
      description: 'Application fee in USD',
    },
    {
      key: 'renewal_fee_usd',
      value: 79.00,
      description: 'Renewal fee in USD',
    },
    {
      key: 'max_document_size_mb',
      value: 10,
      description: 'Maximum document upload size in MB',
    },
    {
      key: 'allowed_document_types',
      value: ['pdf', 'jpg', 'jpeg', 'png'],
      description: 'Allowed document file types',
    },
  ];

  await prisma.systemConfig.createMany({
    data: systemConfigs,
  });

  console.log('✅ System configuration created');

  console.log('🎉 Database seed completed successfully!');
  console.log('\n📋 Default accounts created:');
  console.log(`Super Admin: admin@rentalcertification.com / AdminPassword123!`);
  console.log(`Admin: reviewer@rentalcertification.com / AdminPassword123!`);
  console.log(`Sample Host: host@example.com / HostPassword123!`);
}

main()
  .catch((e) => {
    console.error('❌ Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });