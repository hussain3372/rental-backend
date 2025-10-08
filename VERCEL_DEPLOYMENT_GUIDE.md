# Vercel Deployment Guide for NestJS Rental Host Backend

This guide provides step-by-step instructions for deploying your NestJS application to Vercel with all dependencies and functionality working correctly.

## Prerequisites

- Node.js 18+ installed locally
- Vercel CLI installed (`npm install -g vercel`)
- A Vercel account (free tier available)
- PostgreSQL database (recommended: Neon, Supabase, or Railway)
- Redis instance (recommended: Upstash Redis)
- AWS S3 bucket for file storage
- Stripe account for payments
- Firebase project for push notifications

## Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

## Step 2: Login to Vercel

```bash
vercel login
```

## Step 3: Prepare Your Database

### Option A: Using Neon (Recommended)
1. Go to [Neon Console](https://console.neon.tech/)
2. Create a new project
3. Copy the connection string
4. Update your `DATABASE_URL` environment variable

### Option B: Using Supabase
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Create a new project
3. Go to Settings > Database
4. Copy the connection string

### Option C: Using Railway
1. Go to [Railway](https://railway.app/)
2. Create a new PostgreSQL service
3. Copy the connection string

## Step 4: Set Up Redis

### Using Upstash Redis (Recommended)
1. Go to [Upstash Console](https://console.upstash.com/)
2. Create a new Redis database
3. Copy the connection details

## Step 5: Configure Environment Variables

Create a `.env.local` file in your project root with the following variables:

```bash
# Copy from env.template and update with your values
cp env.template .env.local
```

**Required Environment Variables:**

```env
# Database
DATABASE_URL="postgresql://username:password@host:port/database"

# Server
NODE_ENV=production
CORS_ORIGIN="https://your-frontend-domain.com"

# JWT
JWT_SECRET="your-super-secret-jwt-key-here"
JWT_EXPIRES_IN="7d"

# Redis
REDIS_URL="redis://username:password@host:port"

# Email (Nodemailer)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"

# AWS S3
AWS_ACCESS_KEY_ID="your-aws-access-key"
AWS_SECRET_ACCESS_KEY="your-aws-secret-key"
AWS_REGION="us-east-1"
AWS_S3_BUCKET="your-s3-bucket-name"

# Stripe
STRIPE_SECRET_KEY="sk_live_your-stripe-secret-key"
STRIPE_PUBLISHABLE_KEY="pk_live_your-stripe-publishable-key"

# Firebase
FIREBASE_PROJECT_ID="your-firebase-project-id"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nyour-private-key\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL="firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com"
```

## Step 6: Build and Test Locally

```bash
# Install dependencies
npm install

# Build the application
npm run build:vercel

# Test locally with Vercel
npm run vercel:dev
```

## Step 7: Deploy to Vercel

### Option A: Deploy via CLI

```bash
# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

### Option B: Deploy via GitHub Integration

1. Push your code to GitHub
2. Go to [Vercel Dashboard](https://vercel.com/dashboard)
3. Click "New Project"
4. Import your GitHub repository
5. Configure build settings:
   - **Build Command**: `npm run build:vercel`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`

## Step 8: Configure Environment Variables in Vercel

1. Go to your project in Vercel Dashboard
2. Navigate to Settings > Environment Variables
3. Add all the environment variables from your `.env.local` file
4. Make sure to set them for Production, Preview, and Development environments

## Step 9: Run Database Migrations

After deployment, you need to run Prisma migrations:

```bash
# Connect to your Vercel project
vercel env pull .env.local

# Run migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate
```

## Step 10: Test Your Deployment

1. Visit your Vercel URL (e.g., `https://your-project.vercel.app`)
2. Check the health endpoint: `https://your-project.vercel.app/api/health`
3. Check the API documentation: `https://your-project.vercel.app/api/docs`

## Build Configuration

### Build Commands
- **Build Command**: `npm run build:vercel`
- **Output Directory**: `dist`
- **Install Command**: `npm install`

### Vercel Configuration (`vercel.json`)
```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "api/index.js"
    }
  ],
  "env": {
    "NODE_ENV": "production"
  },
  "functions": {
    "api/index.js": {
      "maxDuration": 30
    }
  }
}
```

## Common Issues and Solutions

### Issue 1: Build Failures
**Problem**: Build fails with TypeScript errors
**Solution**: 
```bash
# Check TypeScript compilation
npm run type-check

# Fix any TypeScript errors
npm run lint:fix
```

### Issue 2: Database Connection Issues
**Problem**: Cannot connect to database
**Solution**:
1. Verify your `DATABASE_URL` is correct
2. Ensure your database allows connections from Vercel IPs
3. Check if SSL is required (add `?sslmode=require` to connection string)

### Issue 3: Redis Connection Issues
**Problem**: Redis connection fails
**Solution**:
1. Verify your `REDIS_URL` is correct
2. Ensure Redis instance is accessible from Vercel
3. Check if authentication is required

### Issue 4: File Upload Issues
**Problem**: File uploads fail
**Solution**:
1. Verify AWS S3 credentials
2. Check S3 bucket permissions
3. Ensure CORS is configured on S3 bucket

### Issue 5: CORS Issues
**Problem**: Frontend cannot connect to API
**Solution**:
1. Update `CORS_ORIGIN` environment variable
2. Ensure your frontend domain is included in CORS settings

### Issue 6: Memory Issues
**Problem**: Function timeout or memory errors
**Solution**:
1. Optimize your code to reduce memory usage
2. Consider using Vercel Pro plan for higher limits
3. Implement connection pooling for database

### Issue 7: Environment Variables Not Loading
**Problem**: Environment variables are undefined
**Solution**:
1. Ensure variables are set in Vercel Dashboard
2. Redeploy after adding new variables
3. Check variable names match exactly

## Performance Optimization

### 1. Database Connection Pooling
```typescript
// In your Prisma service
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: ['error'],
});
```

### 2. Redis Connection Optimization
```typescript
// In your Redis service
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
});
```

### 3. Caching Strategy
- Implement Redis caching for frequently accessed data
- Use Vercel's edge caching for static content
- Implement database query optimization

## Monitoring and Logging

### 1. Vercel Analytics
- Enable Vercel Analytics in your dashboard
- Monitor function execution times
- Track error rates

### 2. Application Logging
- Use Winston for structured logging
- Log errors and important events
- Monitor database query performance

### 3. Health Checks
- Implement health check endpoints
- Monitor external service dependencies
- Set up alerts for critical failures

## Security Considerations

### 1. Environment Variables
- Never commit sensitive data to version control
- Use Vercel's environment variable encryption
- Rotate secrets regularly

### 2. API Security
- Implement rate limiting
- Use HTTPS only
- Validate all inputs
- Implement proper authentication

### 3. Database Security
- Use connection pooling
- Implement query timeouts
- Use SSL connections
- Regular security updates

## Scaling Considerations

### 1. Function Limits
- Vercel Free: 10s execution time, 1GB memory
- Vercel Pro: 60s execution time, 3GB memory
- Consider breaking large operations into smaller functions

### 2. Database Scaling
- Use read replicas for read-heavy operations
- Implement connection pooling
- Consider database sharding for large datasets

### 3. Caching Strategy
- Implement multi-level caching
- Use CDN for static assets
- Cache API responses appropriately

## Troubleshooting Commands

```bash
# Check Vercel CLI version
vercel --version

# View deployment logs
vercel logs

# Check environment variables
vercel env ls

# Pull environment variables
vercel env pull .env.local

# Check function logs
vercel logs --follow

# Debug build issues
vercel build --debug
```

## Support and Resources

- [Vercel Documentation](https://vercel.com/docs)
- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [Vercel Community](https://github.com/vercel/vercel/discussions)

## Final Checklist

- [ ] All environment variables configured
- [ ] Database migrations run successfully
- [ ] Redis connection working
- [ ] File uploads working
- [ ] Email sending working
- [ ] Payment processing working
- [ ] Push notifications working
- [ ] Health checks passing
- [ ] API documentation accessible
- [ ] CORS configured correctly
- [ ] SSL certificates working
- [ ] Performance monitoring set up

Your NestJS application should now be successfully deployed on Vercel with all functionality working correctly!
