#!/usr/bin/env node

/**
 * Simple test script for push notifications
 * Run with: node test-push-notifications.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3001';

async function testPushNotifications() {
  console.log('🚀 Testing Push Notification System...\n');

  try {
    // Step 1: Login to get JWT token
    console.log('1. Logging in...');
    const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
      email: 'admin@rental-certification.com', // Use your admin email
      password: 'secure-admin-password' // Use your admin password
    });
    
    const token = loginResponse.data.access_token;
    console.log('✅ Login successful\n');

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    // Step 2: Save FCM Token
    console.log('2. Saving FCM token...');
    await axios.post(`${BASE_URL}/fcm/token`, {
      fcmToken: 'test-fcm-token-12345'
    }, { headers });
    console.log('✅ FCM token saved\n');

    // Step 3: Send test notification
    console.log('3. Sending test notification...');
    const testResponse = await axios.post(`${BASE_URL}/fcm/test-notification`, {
      message: 'Hello from Rental Host Backend!'
    }, { headers });
    console.log('✅ Test notification sent:', testResponse.data);
    console.log('');

    // Step 4: Create application (triggers push notification)
    console.log('4. Creating application (triggers push notification)...');
    const appResponse = await axios.post(`${BASE_URL}/applications`, {
      propertyDetails: {
        propertyType: 'house',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        zipCode: '12345'
      }
    }, { headers });
    console.log('✅ Application created:', appResponse.data.id);
    console.log('');

    // Step 5: Get notifications
    console.log('5. Fetching notifications...');
    const notificationsResponse = await axios.get(`${BASE_URL}/notifications`, { headers });
    console.log('✅ Notifications retrieved:');
    notificationsResponse.data.notifications.forEach((notification, index) => {
      console.log(`   ${index + 1}. ${notification.title}: ${notification.message}`);
    });
    console.log('');

    // Step 6: Get notification stats
    console.log('6. Getting notification stats...');
    const statsResponse = await axios.get(`${BASE_URL}/notifications/stats`, { headers });
    console.log('✅ Notification stats:', statsResponse.data);
    console.log('');

    console.log('🎉 All tests completed successfully!');
    console.log('\n📱 Check your mobile device for push notifications!');
    console.log('📊 Check the notifications API to see stored notifications.');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure the server is running on port 3001');
    console.log('2. Check your Firebase configuration');
    console.log('3. Verify your admin credentials');
    console.log('4. Ensure the database is running');
  }
}

// Run the test
testPushNotifications();
