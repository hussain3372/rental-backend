# Push Notification Testing Guide

## Setup Instructions

### 1. Firebase Configuration

1. **Create Firebase Project:**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create a new project or use existing one
   - Enable Cloud Messaging

2. **Generate Service Account Key:**
   - Go to Project Settings > Service Accounts
   - Click "Generate new private key"
   - Download the JSON file
   - Rename it to `firebase-service-account.js`
   - Place it in the project root directory

3. **Environment Variables:**
   Add these to your `.env` file:
   ```env
   FIREBASE_PROJECT_ID=your-firebase-project-id
   FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.js
   ```

### 2. Database Setup

Make sure your user has an FCM token:
```sql
UPDATE users SET fcmToken = 'your-test-fcm-token' WHERE id = 1;
```

## API Endpoints for Testing

### 1. Save FCM Token
**POST** `/fcm/token`
```json
{
  "fcmToken": "your-fcm-token-here"
}
```

### 2. Send Test Notification
**POST** `/fcm/test-notification`
```json
{
  "userId": 1,
  "message": "Custom test message"
} 
```

### 3. Create Application (Triggers Push Notification)
**POST** `/applications`
```json
{
  "propertyDetails": {
    "propertyType": "apartment",
    "address": "123 Test St",
    "city": "Test City"
  }
}
```

### 4. Get User Notifications
**GET** `/notifications`

### 5. Get Notification Stats
**GET** `/notifications/stats`

## Testing with Postman

### Step 1: Authentication
1. Login to get JWT token
2. Add `Authorization: Bearer <token>` header to all requests

### Step 2: Save FCM Token
```http
POST {{baseUrl}}/fcm/token
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "fcmToken": "test-fcm-token-12345"
}
```

### Step 3: Test Push Notification
```http
POST {{baseUrl}}/fcm/test-notification
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "message": "Hello from Rental Host!"
}
```

### Step 4: Create Application (Auto Push Notification)
```http
POST {{baseUrl}}/applications
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "propertyDetails": {
    "propertyType": "house",
    "address": "456 Demo Ave",
    "city": "Demo City",
    "state": "Demo State",
    "zipCode": "12345"
  }
}
```

### Step 5: Check Notifications
```http
GET {{baseUrl}}/notifications
Authorization: Bearer {{token}}
```

## Expected Behavior

1. **FCM Token Saved:** User's FCM token is stored in database
2. **Test Notification:** Push notification sent to user's device
3. **Application Creation:** 
   - Application created successfully
   - Push notification sent: "Application Created Successfully"
   - Notification saved in database
4. **Notification List:** Shows all notifications including the new one

## Troubleshooting

### Firebase Not Initialized
- Check if `firebase-service-account.js` exists
- Verify `FIREBASE_PROJECT_ID` in environment
- Check logs for Firebase initialization errors

### No Push Notifications
- Verify FCM token is valid
- Check if user has `isNotification: true`
- Ensure Firebase project has Cloud Messaging enabled

### Database Errors
- Run Prisma migrations: `npm run prisma:migrate`
- Check database connection
- Verify user exists in database

## Test FCM Token (for testing only)
Use this token for testing: `test-fcm-token-12345`

Note: This is a dummy token. In production, use real FCM tokens from your mobile app.
