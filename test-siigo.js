#!/usr/bin/env node

/**
 * Test script for Siigo ERP connection
 * Run with: node test-siigo.js
 */

const API_BASE = 'http://localhost:4000';

// Test credentials - replace with real ones
const TEST_CREDENTIALS = {
  email: 'test@fluxi.com', // Your user email
  password: 'password123', // Your user password
  account_id: '702cb585-c4d3-4c6f-b9b7-22958f1a05e2', // Replace with real account ID
  siigo_username: 'usuario@siigo.com', // Replace with real Siigo username
  siigo_api_key: 'TU_API_KEY_REAL' // Replace with real Siigo API key
};

async function test(endpoint, options = {}) {
  console.log(`\n🧪 Testing: ${options.method || 'GET'} ${endpoint}`);

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ SUCCESS:', data);
      return data;
    } else {
      console.log('❌ ERROR:', response.status, data);
      return null;
    }
  } catch (error) {
    console.log('💥 NETWORK ERROR:', error.message);
    return null;
  }
}

async function runTests() {
  console.log('🚀 Starting Siigo ERP Connection Tests\n');

  // 1. Login to get JWT
  console.log('1️⃣ LOGIN');
  const loginResult = await test('/auth/login', {
    method: 'POST',
    body: {
      email: TEST_CREDENTIALS.email,
      password: TEST_CREDENTIALS.password
    }
  });

  if (!loginResult) {
    console.log('❌ Cannot continue without JWT token');
    return;
  }

  const jwt = loginResult.token;
  console.log('📝 JWT obtained:', jwt.substring(0, 50) + '...');

  // 2. Create Siigo channel
  console.log('\n2️⃣ CREATE SIIGO CHANNEL');
  const channelResult = await test('/channels', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      account_id: TEST_CREDENTIALS.account_id,
      type: 'siigo',
      external_id: TEST_CREDENTIALS.siigo_username,
      config: {
        username: TEST_CREDENTIALS.siigo_username,
        api_key: TEST_CREDENTIALS.siigo_api_key
      },
      name: 'Siigo ERP Test',
      description: 'Test connection'
    }
  });

  if (!channelResult) {
    console.log('❌ Cannot continue without channel');
    return;
  }

  const channelId = channelResult.channel.id;
  console.log('📝 Channel created with ID:', channelId);

  // 3. Test Siigo connection
  console.log('\n3️⃣ TEST SIIGO CONNECTION');
  const testResult = await test(`/channels/${channelId}/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` }
  });

  if (testResult && testResult.test_result.success) {
    console.log('\n🎉 SIIGO CONNECTION SUCCESSFUL!');
    console.log('Siigo User:', testResult.test_result.siigo_user);
  } else {
    console.log('\n💥 SIIGO CONNECTION FAILED');
    if (testResult) {
      console.log('Error:', testResult.test_result.message);
    }
  }

  console.log('\n🏁 Tests completed');
}

// Run tests
runTests().catch(console.error);