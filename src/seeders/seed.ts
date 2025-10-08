import {
  PrismaClient,
  UserRole,
  ApplicationStatus,
  ApplicationStep,
  CertificationStatus,
  PaymentStatus,
  SupportTicketStatus,
  SupportTicketPriority,
  SupportTicketCategory,
} from '@prisma/client';

import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Clear existing data (optional - remove in production)
  console.log('🧹 Clearing existing data...');
  await prisma.auditLog.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.fAQ.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.certification.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.document.deleteMany();
  await prisma.application.deleteMany();
  await prisma.user.deleteMany();

  // Create test users
  console.log('👥 Creating test users...');

  // Super Admin
  const superAdmin = await prisma.user.create({
    data: {
      email: 'admin@rentalcert.com',
      password: await bcrypt.hash('admin123', 12),
      name: 'Super Administrator',
      firstName: 'Super',
      lastName: 'Administrator',
      role: UserRole.SUPER_ADMIN,
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  // Admin
  const admin = await prisma.user.create({
    data: {
      email: 'reviewer@rentalcert.com',
      password: await bcrypt.hash('reviewer123', 12),
      name: 'Application Reviewer',
      firstName: 'Application',
      lastName: 'Reviewer',
      role: UserRole.ADMIN,
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  // Test Hosts
  const host1 = await prisma.user.create({
    data: {
      email: 'john.doe@email.com',
      password: await bcrypt.hash('password123', 12),
      name: 'John Doe',
      firstName: 'John',
      lastName: 'Doe',
      companyName: 'Doe Properties LLC',
      phone: '+1-555-0123',
      role: UserRole.HOST,
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  const host2 = await prisma.user.create({
    data: {
      email: 'sarah.wilson@email.com',
      password: await bcrypt.hash('password123', 12),
      name: 'Sarah Wilson',
      firstName: 'Sarah',
      lastName: 'Wilson',
      companyName: 'Wilson Rentals',
      phone: '+1-555-0456',
      role: UserRole.HOST,
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  const host3 = await prisma.user.create({
    data: {
      email: 'mike.johnson@email.com',
      password: await bcrypt.hash('password123', 12),
      name: 'Mike Johnson',
      firstName: 'Mike',
      lastName: 'Johnson',
      companyName: 'Johnson Property Management',
      phone: '+1-555-0789',
      role: UserRole.HOST,
      status: 'PENDING_VERIFICATION',
      emailVerified: false,
    },
  });

  // Create test applications
  console.log('📋 Creating test applications...');

  const app1 = await prisma.application.create({
    data: {
      hostId: host1.id,
      status: ApplicationStatus.APPROVED,
      currentStep: ApplicationStep.SUBMISSION,
      propertyDetails: {
        propertyName: 'Downtown Luxury Apartment',
        address: '123 Main St, Downtown, CA 90210',
        city: 'Downtown',
        state: 'CA',
        zipCode: '90210',
        country: 'USA',
        propertyType: 'apartment',
        bedrooms: 2,
        bathrooms: 2,
        maxGuests: 4,
        description: 'Beautiful downtown apartment with city views',
        amenities: ['wifi', 'parking', 'gym', 'pool'],
      },
      // complianceChecklist removed; see compliance_checklists table
      submittedAt: new Date('2024-09-15'),
      reviewedBy: admin.id,
      reviewedAt: new Date('2024-09-16'),
      reviewNotes: 'Application approved. All requirements met.',
    },
  });

  const app2 = await prisma.application.create({
    data: {
      hostId: host2.id,
      status: ApplicationStatus.UNDER_REVIEW,
      currentStep: ApplicationStep.DOCUMENT_UPLOAD,
      propertyDetails: {
        propertyName: 'Beachfront Villa',
        address: '456 Ocean Ave, Malibu, CA 90265',
        city: 'Malibu',
        state: 'CA',
        zipCode: '90265',
        country: 'USA',
        propertyType: 'house',
        bedrooms: 4,
        bathrooms: 3,
        maxGuests: 8,
        description: 'Stunning beachfront villa with private access',
        amenities: ['wifi', 'parking', 'beach_access', 'pool', 'hot_tub'],
      },
      // complianceChecklist removed; see compliance_checklists table
      submittedAt: new Date('2024-09-20'),
      reviewedBy: admin.id,
      reviewNotes: 'Under review - waiting for insurance certificate',
    },
  });

  const app3 = await prisma.application.create({
    data: {
      hostId: host1.id,
      status: ApplicationStatus.DRAFT,
      currentStep: ApplicationStep.PROPERTY_DETAILS,
      propertyDetails: {
        propertyName: 'Mountain Cabin',
        address: '789 Pine Rd, Aspen, CO 81611',
        city: 'Aspen',
        state: 'CO',
        zipCode: '81611',
        country: 'USA',
        propertyType: 'cabin',
        bedrooms: 3,
        bathrooms: 2,
        maxGuests: 6,
        description: 'Cozy mountain cabin perfect for winter getaways',
        amenities: ['wifi', 'fireplace', 'ski_access'],
      },
    },
  });

  // Create test payments
  console.log('💳 Creating test payments...');

  const payment1 = await prisma.payment.create({
    data: {
      applicationId: app1.id,
      hostId: host1.id,
      amount: 99.0,
      currency: 'USD',
      status: PaymentStatus.COMPLETED,
      gatewayTransactionId: 'pi_test_1234567890',
      createdAt: new Date('2024-09-16'),
    },
  });

  const payment2 = await prisma.payment.create({
    data: {
      applicationId: app2.id,
      hostId: host2.id,
      amount: 99.0,
      currency: 'USD',
      status: PaymentStatus.PENDING,
      createdAt: new Date('2024-09-21'),
    },
  });

  // Create test certifications
  console.log('🏆 Creating test certifications...');

  const cert1 = await prisma.certification.create({
    data: {
      applicationId: app1.id,
      hostId: host1.id,
      certificateNumber: 'CERT-2024-0001',
      status: CertificationStatus.ACTIVE,
      issuedAt: new Date('2024-09-17'),
      expiresAt: new Date('2025-09-17'),
      qrCodeData: 'CERT-2024-0001',
      verificationUrl: 'https://verify.rentalcert.com/cert/CERT-2024-0001',
      badgeUrl:
        'https://s3.amazonaws.com/certifications/1/badges/badge-CERT-2024-0001.png',
      qrCodeUrl:
        'https://s3.amazonaws.com/certifications/1/qrcodes/qrcode-CERT-2024-0001.png',
    },
  });

  // Create test documents
  console.log('📄 Creating test documents...');

  const doc1 = await prisma.document.create({
    data: {
      applicationId: app1.id,
      fileName: 'business_license.pdf',
      originalName: 'Business License.pdf',
      mimeType: 'application/pdf',
      size: 245760,
      url: 'https://s3.amazonaws.com/documents/app1/business_license.pdf',
      documentType: 'OTHER',
      uploadedAt: new Date('2024-09-15'),
    },
  });

  const doc2 = await prisma.document.create({
    data: {
      applicationId: app1.id,
      fileName: 'insurance_certificate.pdf',
      originalName: 'Insurance Certificate.pdf',
      mimeType: 'application/pdf',
      size: 189440,
      url: 'https://s3.amazonaws.com/documents/app1/insurance_certificate.pdf',
      documentType: 'INSURANCE_CERTIFICATE',
      uploadedAt: new Date('2024-09-15'),
    },
  });

  // Create test support tickets
  console.log('🎫 Creating test support tickets...');

  const ticket1 = await prisma.supportTicket.create({
    data: {
      userId: host1.id,
      subject: 'Badge not displaying correctly',
      description:
        'The certification badge on my property listing is not showing the correct information. It shows an old address.',
      category: SupportTicketCategory.TECHNICAL,
      priority: SupportTicketPriority.MEDIUM,
      status: SupportTicketStatus.RESOLVED,
      assignedTo: admin.id,
      resolution:
        'Issue was with cached data. Cleared cache and badge now displays correctly.',
      resolvedAt: new Date('2024-09-18'),
      closedAt: new Date('2024-09-18'),
      tags: ['badge', 'display', 'cache'],
    },
  });

  const ticket2 = await prisma.supportTicket.create({
    data: {
      userId: host2.id,
      subject: 'Application review taking too long',
      description:
        "I submitted my application 5 days ago and haven't heard back. Can you check the status?",
      category: SupportTicketCategory.APPLICATION,
      priority: SupportTicketPriority.HIGH,
      status: SupportTicketStatus.IN_PROGRESS,
      assignedTo: admin.id,
      tags: ['application', 'review', 'status'],
    },
  });

  const ticket3 = await prisma.supportTicket.create({
    data: {
      userId: host3.id,
      subject: 'How do I upload documents?',
      description:
        "I'm trying to complete my application but can't figure out how to upload the required documents.",
      category: SupportTicketCategory.GENERAL,
      priority: SupportTicketPriority.LOW,
      status: SupportTicketStatus.OPEN,
      tags: ['documentation', 'upload', 'help'],
    },
  });

  // Create test FAQs
  console.log('❓ Creating test FAQs...');

  const faq1 = await prisma.fAQ.create({
    data: {
      question: 'How long does the certification process take?',
      answer:
        'The certification process typically takes 3-5 business days from the time you submit a complete application with all required documents. Applications with missing information may take longer.',
      category: 'Application Process',
      tags: ['timeline', 'process', 'application'],
      isPublished: true,
      viewCount: 45,
      helpfulCount: 32,
    },
  });

  const faq2 = await prisma.fAQ.create({
    data: {
      question: 'What documents do I need to submit?',
      answer:
        "You'll need to provide: 1) Valid business license, 2) Insurance certificate, 3) Property deed or lease agreement, 4) Safety inspection reports, and 5) ID verification documents.",
      category: 'Requirements',
      tags: ['documents', 'requirements', 'application'],
      isPublished: true,
      viewCount: 78,
      helpfulCount: 65,
    },
  });

  const faq3 = await prisma.fAQ.create({
    data: {
      question: 'How do I renew my certification?',
      answer:
        "Certifications are valid for 1 year. You'll receive renewal reminders 30 days before expiration. Log into your dashboard and follow the renewal prompts.",
      category: 'Certification',
      tags: ['renewal', 'expiration', 'certification'],
      isPublished: true,
      viewCount: 23,
      helpfulCount: 18,
    },
  });

  const faq4 = await prisma.fAQ.create({
    data: {
      question: 'What if my payment fails?',
      answer:
        "If your payment fails, you'll receive an email notification. You can retry the payment from your dashboard or contact support for assistance.",
      category: 'Payment',
      tags: ['payment', 'failed', 'retry'],
      isPublished: true,
      viewCount: 12,
      helpfulCount: 9,
    },
  });

  // Create test notifications
  console.log('🔔 Creating test notifications...');

  await prisma.notification.create({
    data: {
      userId: host1.id,
      type: 'CERTIFICATION_EXPIRY',
      title: 'Certification Expiring Soon',
      message:
        'Your certification CERT-2024-0001 will expire on September 17, 2025. Please renew to maintain your certified status.',
      data: {
        certificateNumber: 'CERT-2024-0001',
        expiryDate: '2025-09-17',
        daysUntilExpiry: 30,
      },
    },
  });

  await prisma.notification.create({
    data: {
      userId: host2.id,
      type: 'APPLICATION_STATUS',
      title: 'Application Status Update',
      message:
        'Your application status has been updated to "Under Review". We\'re currently reviewing your submitted documents.',
      data: {
        applicationId: app2.id,
        status: 'UNDER_REVIEW',
      },
    },
  });

  await prisma.notification.create({
    data: {
      userId: host3.id,
      type: 'SYSTEM_ALERT',
      title: 'Email Verification Required',
      message:
        'Please verify your email address to complete your registration and submit applications.',
      data: {
        actionRequired: true,
        verificationUrl: '/verify-email',
      },
    },
  });

  // Create test audit logs
  console.log('📊 Creating test audit logs...');

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: 'APPLICATION_APPROVED',
      resource: 'APPLICATION',
      resourceId: app1.id,
      oldValues: JSON.stringify({ status: 'UNDER_REVIEW' }),
      newValues: JSON.stringify({
        status: 'APPROVED',
        reviewedBy: admin.id,
        reviewedAt: new Date('2024-09-16'),
        reviewNotes: 'Application approved. All requirements met.',
      }),
      severity: 'HIGH',
      status: 'SUCCESS',
      metadata: JSON.stringify({
        reviewerName: 'Application Reviewer',
        applicationId: app1.id,
        hostId: host1.id,
      }),
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: host1.id,
      action: 'CERTIFICATION_ISSUED',
      resource: 'CERTIFICATION',
      resourceId: cert1.id,
      newValues: JSON.stringify({
        certificateNumber: 'CERT-2024-0001',
        issuedAt: new Date('2024-09-17'),
        expiresAt: new Date('2025-09-17'),
      }),
      severity: 'HIGH',
      status: 'SUCCESS',
      metadata: JSON.stringify({
        hostName: 'John Doe',
        hostEmail: 'john.doe@email.com',
      }),
    },
  });

  console.log('✅ Database seeding completed successfully!');
  console.log('\n📊 Seeded Data Summary:');
  console.log(
    `👥 Users: 5 (${UserRole.SUPER_ADMIN}: 1, ${UserRole.ADMIN}: 1, ${UserRole.HOST}: 3)`
  );
  console.log(
    `📋 Applications: 3 (${ApplicationStatus.APPROVED}: 1, ${ApplicationStatus.UNDER_REVIEW}: 1, ${ApplicationStatus.DRAFT}: 1)`
  );
  console.log(
    `💳 Payments: 2 (${PaymentStatus.COMPLETED}: 1, ${PaymentStatus.PENDING}: 1)`
  );
  console.log(`🏆 Certifications: 1 (${CertificationStatus.ACTIVE}: 1)`);
  console.log(`📄 Documents: 2`);
  console.log(
    `🎫 Support Tickets: 3 (${SupportTicketStatus.RESOLVED}: 1, ${SupportTicketStatus.IN_PROGRESS}: 1, ${SupportTicketStatus.OPEN}: 1)`
  );
  console.log(`❓ FAQs: 4`);
  console.log(`🔔 Notifications: 3`);
  console.log(`📊 Audit Logs: 2`);

  console.log('\n🔐 Test Accounts:');
  console.log(`Super Admin: admin@rentalcert.com / admin123`);
  console.log(`Admin: reviewer@rentalcert.com / reviewer123`);
  console.log(`Host 1: john.doe@email.com / password123`);
  console.log(`Host 2: sarah.wilson@email.com / password123`);
  console.log(
    `Host 3: mike.johnson@email.com / password123 (pending verification)`
  );

  console.log(
    '\n🚀 Ready for testing! API server should be running at http://localhost:3001/api'
  );
}

main()
  .catch(e => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
