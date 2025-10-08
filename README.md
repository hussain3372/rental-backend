# 🏠 Rental Host Certification Platform - Backend

A comprehensive, enterprise-grade backend API for a short-term rental host certification platform. Built with NestJS, this system provides complete certification lifecycle management, role-based access control, payment processing, and public verification services.

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Database Setup](#-database-setup)
- [Environment Configuration](#-environment-configuration)
- [Running the Application](#-running-the-application)
- [API Documentation](#-api-documentation)
- [Testing](#-testing)
- [Project Structure](#-project-structure)
- [Available Scripts](#-available-scripts)
- [API Endpoints](#-api-endpoints)
- [Testing Accounts](#-testing-accounts)
- [Deployment](#-deployment)
- [Contributing](#-contributing)
- [License](#-license)

## ✨ Features

### 🏠 Core Certification System
- **Multi-step Application Process**: Property details → Compliance checklist → Document upload → Payment → Submission
- **Role-based Access Control**: Public, Host, Admin, Super Admin roles
- **Certification Lifecycle**: Application → Review → Approval → Certification → Renewal/Revocation
- **Badge & QR Code Generation**: Automated certificate generation with verification

### 💳 Payment & Billing
- **Stripe Integration**: Secure payment processing for certification fees
- **Billing History**: Complete transaction tracking and invoice generation
- **Refund Management**: Admin-controlled refund processing
- **Revenue Analytics**: Financial reporting and analytics

### 🔍 Public Registry
- **Advanced Search**: Filter by location, property type, amenities, guest capacity
- **Verification System**: QR code and certificate number validation
- **SEO-Friendly**: Sitemap generation and structured data
- **Public API**: RESTful endpoints for integrations

### 👨‍💼 Admin Portal
- **Application Review**: Approve/reject applications with detailed feedback
- **User Management**: CRUD operations for all user types
- **Analytics Dashboard**: Real-time statistics and reporting
- **Bulk Operations**: Mass certification revocation/renewal

### 🎫 Support System
- **Ticket Management**: Create, assign, resolve support tickets
- **FAQ System**: Categorized knowledge base with search
- **Notification Workflows**: Automated alerts for status changes

### 🔧 Enterprise Features
- **Audit Logging**: Complete system activity tracking
- **Health Monitoring**: System status and performance metrics
- **File Storage**: S3/MinIO integration for document management
- **Caching**: Redis-based performance optimization
- **Rate Limiting**: API protection and abuse prevention

## 🏗️ Architecture

### Modular Architecture
```
src/
├── modules/                    # Feature-based modules
│   ├── auth/                  # Authentication & authorization
│   ├── admin/                 # Admin portal functionality
│   ├── application/           # Certification applications
│   ├── certification/         # Certificate management
│   ├── document/              # File upload/management
│   ├── payment/               # Stripe payment processing
│   ├── public/                # Public registry & search
│   ├── support/               # Support tickets & FAQ
│   ├── audit/                 # System audit logging
│   ├── storage/               # File storage abstraction
│   ├── health/                # System monitoring
│   └── notification/          # Automated notifications
├── common/                    # Shared utilities
│   ├── decorators/            # Custom decorators
│   ├── guards/                # Route guards
│   ├── interceptors/          # Response interceptors
│   └── pipes/                 # Validation pipes
├── config/                    # Configuration management
└── seeders/                   # Database seeding
```

### Role-Based Access Control
- **Public**: Unauthenticated users (registry browsing, FAQ)
- **Host**: Certified property owners (applications, certifications)
- **Admin**: Application reviewers (review queue, basic management)
- **Super Admin**: System administrators (full user management, system config)

### Data Flow
1. **Host Registration** → Email verification → Profile completion
2. **Application Submission** → Multi-step process → Document upload → Payment
3. **Admin Review** → Approval/Rejection → Certification generation
4. **Public Verification** → QR scan/Certificate lookup → Validation

## 🛠️ Tech Stack

### Backend Framework
- **NestJS**: Progressive Node.js framework for enterprise applications
- **TypeScript**: Type-safe JavaScript with modern features

### Database & ORM
- **PostgreSQL**: Robust relational database
- **Prisma**: Next-generation ORM with type safety

### Authentication & Security
- **JWT**: JSON Web Tokens for authentication
- **bcrypt**: Password hashing
- **Helmet**: Security headers
- **Rate Limiting**: API abuse protection

### Payment Processing
- **Stripe**: Payment gateway integration
- **Webhooks**: Real-time payment status updates

### File Storage
- **AWS S3 / MinIO**: Cloud object storage
- **Multer**: File upload handling

### Caching & Performance
- **Redis**: High-performance caching
- **Compression**: Response compression

### Development Tools
- **ESLint**: Code linting
- **Prettier**: Code formatting
- **Jest**: Unit and integration testing
- **Swagger/OpenAPI**: API documentation

## 📋 Prerequisites

- **Node.js**: v18.x or higher
- **npm**: v8.x or higher
- **PostgreSQL**: v13.x or higher
- **Redis**: v6.x or higher (optional, for caching)
- **MinIO/AWS S3**: For file storage

### System Requirements
- **RAM**: 2GB minimum, 4GB recommended
- **Disk**: 1GB for application, plus storage for files
- **Network**: Stable internet for external services

## 🚀 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd rental-certifications/backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Database setup**
   ```bash
   # Generate Prisma client
   npx prisma generate

   # Run database migrations
   npx prisma db push

   # Seed with test data
   npm run seed
   ```

5. **Start the application**
   ```bash
   # Development mode
   npm run start:dev

   # Production build
   npm run build
   npm run start:prod
   ```

## 🗄️ Database Setup

### Prisma Configuration
The database schema includes comprehensive models for:

- **Users**: Multi-role user management
- **Applications**: Multi-step certification process
- **Certifications**: Certificate lifecycle management
- **Documents**: File upload and management
- **Payments**: Transaction and billing history
- **Notifications**: Automated alert system
- **Support Tickets**: Customer support management
- **Audit Logs**: System activity tracking

### Database Migrations
```bash
# Push schema changes to database
npx prisma db push

# Generate migrations (for production)
npx prisma migrate dev

# Reset database (development only)
npm run db:reset
```

### Seeding
```bash
# Populate with test data
npm run seed

# Reset and reseed
npm run db:reset
```

## ⚙️ Environment Configuration

Create a `.env` file with the following variables:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/rental_certification_dev"

# JWT
JWT_SECRET="your-super-secret-jwt-key"
JWT_EXPIRES_IN="1h"
JWT_REFRESH_SECRET="your-refresh-token-secret"
JWT_REFRESH_EXPIRES_IN="7d"

# Application
NODE_ENV="development"
PORT=3001
CORS_ORIGIN="http://localhost:3000"

# Redis (optional)
REDIS_HOST="localhost"
REDIS_PORT=6379
REDIS_PASSWORD=""

# File Storage
STORAGE_PROVIDER="minio" # or "s3"
MINIO_ENDPOINT="localhost"
MINIO_PORT=9000
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MINIO_BUCKET="certifications"

# AWS S3 (alternative)
AWS_ACCESS_KEY_ID=""
AWS_SECRET_ACCESS_KEY=""
AWS_S3_BUCKET=""
AWS_REGION="us-east-1"

# Stripe
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PUBLISHABLE_KEY="pk_test_..."

# Email (optional)
EMAIL_HOST="smtp.gmail.com"
EMAIL_PORT=587
EMAIL_USER=""
EMAIL_PASS=""
EMAIL_FROM="noreply@rentalcert.com"

# Logging (optional)
ELASTICSEARCH_NODE="http://localhost:9200"
```

## 🏃 Running the Application

### Development Mode
```bash
npm run start:dev
```
- Hot reload enabled
- Debug mode available
- Full error stack traces

### Production Mode
```bash
npm run build
npm run start:prod
```
- Optimized build
- Minimal logging
- Error responses sanitized

### Docker (Optional)
```bash
# Build and run with Docker
docker build -t rental-cert-backend .
docker run -p 3001:3001 rental-cert-backend
```

## 📚 API Documentation

### Swagger UI
When running in development, access the API documentation at:
```
http://localhost:3001/docs
```

### API Base URL
```
http://localhost:3001/api
```

### Response Format
All API responses follow a consistent format:
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Error Format
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": { ... },
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

## 🧪 Testing

### Unit Tests
```bash
npm run test
```

### E2E Tests
```bash
npm run test:e2e
```

### Test Coverage
```bash
npm run test:cov
```

### Manual Testing
Use the provided test accounts or create your own for testing.

## 📁 Project Structure

```
backend/
├── src/
│   ├── modules/              # Feature modules
│   │   ├── auth/            # Authentication & authorization
│   │   ├── admin/           # Admin functionality
│   │   ├── application/     # Certification applications
│   │   ├── certification/   # Certificate management
│   │   ├── document/        # File management
│   │   ├── payment/         # Payment processing
│   │   ├── public/          # Public registry
│   │   ├── support/         # Support system
│   │   ├── audit/           # Audit logging
│   │   ├── storage/         # File storage
│   │   ├── health/          # Health monitoring
│   │   └── notification/    # Notifications
│   ├── common/              # Shared utilities
│   ├── config/              # Configuration
│   └── seeders/             # Database seeding
├── prisma/
│   ├── schema.prisma        # Database schema
│   └── migrations/          # Database migrations
├── test/                    # Test files
├── .env.example             # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## 📜 Available Scripts

```bash
# Development
npm run start:dev          # Start with hot reload
npm run start:debug        # Start with debugger
npm run start:prod         # Production build

# Building
npm run build              # TypeScript compilation
npm run format             # Code formatting
npm run lint               # Code linting
npm run lint:fix           # Fix linting issues

# Database
npm run seed               # Seed database
npm run db:reset           # Reset and reseed
npx prisma studio          # Database GUI
npx prisma generate        # Generate Prisma client
npx prisma db push         # Push schema changes

# Testing
npm run test               # Unit tests
npm run test:watch         # Watch mode tests
npm run test:cov           # Coverage report
npm run test:e2e           # End-to-end tests
```

## 🔗 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh-token` - Refresh JWT token
- `POST /api/auth/forgot-password` - Password reset request
- `POST /api/auth/change-password` - Change password

### Applications (Host)
- `GET /api/applications` - List user's applications
- `POST /api/applications` - Create new application
- `PUT /api/applications/:id` - Update application step
- `POST /api/applications/:id/submit` - Submit for review
- `DELETE /api/applications/:id` - Delete application

### Certifications
- `GET /api/certifications` - User's certifications
- `GET /api/certifications/:id/badge/download` - Download badge
- `GET /api/certifications/:id/qr` - Get QR code

### Public Registry
- `GET /api/registry/search` - Search certifications
- `GET /api/registry/:id` - Get certification details
- `GET /api/registry/stats` - Registry statistics

### Admin Portal
- `GET /api/admin/dashboard` - Admin dashboard
- `GET /api/admin/queue` - Application review queue
- `POST /api/admin/queue/:id/review` - Review application

### Support System
- `GET /api/support/faq` - Public FAQ
- `POST /api/support/tickets` - Create support ticket
- `GET /api/support/tickets` - User's tickets

### System Health
- `GET /api/health` - System health status
- `GET /api/health/detailed` - Detailed health metrics

## 👥 Testing Accounts

| Role | Email | Password | Permissions |
|------|-------|----------|-------------|
| **Super Admin** | `admin@rentalcert.com` | `admin123` | Full system access |
| **Admin** | `reviewer@rentalcert.com` | `reviewer123` | Application review |
| **Host 1** | `john.doe@email.com` | `password123` | Full host features |
| **Host 2** | `sarah.wilson@email.com` | `password123` | Full host features |
| **Host 3** | `mike.johnson@email.com` | `password123` | Pending verification |

### Sample Data
- **1 Active Certification**: Downtown Luxury Apartment (John Doe)
- **3 Applications**: Approved, Under Review, Draft
- **4 FAQ Articles**: Process, documents, renewal, payments
- **3 Support Tickets**: Various statuses and priorities

## 🚀 Deployment

### Production Checklist
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] SSL certificates installed
- [ ] File storage configured
- [ ] Payment webhooks configured
- [ ] Domain and DNS configured
- [ ] Monitoring and logging set up

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 3001
CMD ["npm", "run", "start:prod"]
```

### Environment Variables for Production
```env
NODE_ENV=production
DATABASE_URL="postgresql://..."
JWT_SECRET="strong-production-secret"
STRIPE_SECRET_KEY="sk_live_..."
REDIS_HOST="redis-cluster"
```

## 🤝 Contributing

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**
4. **Run tests and linting**
   ```bash
   npm run test
   npm run lint
   ```
5. **Commit your changes**
   ```bash
   git commit -m "Add: your feature description"
   ```
6. **Push to your branch**
   ```bash
   git push origin feature/your-feature-name
   ```
7. **Create a Pull Request**

### Code Standards
- **TypeScript**: Strict type checking enabled
- **ESLint**: Airbnb configuration with TypeScript support
- **Prettier**: Consistent code formatting
- **Conventional Commits**: Structured commit messages

### Testing Requirements
- **Unit Tests**: Minimum 80% coverage
- **Integration Tests**: API endpoints tested
- **E2E Tests**: Critical user flows covered

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

For support and questions:
- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Documentation**: [API Docs](http://localhost:3001/docs)
- **Email**: support@rentalcert.com

## 🙏 Acknowledgments

- **NestJS**: For the excellent framework
- **Prisma**: For the powerful ORM
- **Stripe**: For payment processing
- **PostgreSQL**: For reliable data storage
- **Redis**: For high-performance caching

---

**🎉 Happy coding! Your rental host certification platform is ready to empower hosts and protect guests worldwide.**
