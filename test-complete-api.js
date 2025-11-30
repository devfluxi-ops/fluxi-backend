#!/usr/bin/env node

// Complete API Testing Script for Fluxi Backend
// Tests all endpoints systematically

const API_BASE = 'http://localhost:4000';

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
    console.log(`📊 Status: ${response.status}`);
    console.log(`📄 Response:`, JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.log(`❌ Error: ${data.error || 'Unknown error'}`);
    } else {
      console.log(`✅ Success`);
    }

    return { response, data };
  } catch (error) {
    console.error(`💥 Network Error:`, error.message);
    return { error: error.message };
  }
}

async function runCompleteTest() {
  console.log('🚀 FLUXI BACKEND - COMPLETE API TEST SUITE');
  console.log('==========================================\n');

  let jwt = null;
  let accountId = null;
  let productId = null;
  let channelId = null;
  let orderId = null;

  // =========================================
  // 1. HEALTH CHECK
  // =========================================
  console.log('🏥 1. HEALTH CHECK');
  await test('/health');

  // =========================================
  // 2. AUTHENTICATION
  // =========================================
  console.log('\n🔐 2. AUTHENTICATION');

  // Register new user and account
  console.log('\n📝 REGISTERING NEW USER & ACCOUNT');
  const timestamp = Date.now();
  const register = await test('/auth/register', {
    method: 'POST',
    body: {
      email: `test-api-${timestamp}@fluxi.com`,
      password: 'test123456'
    }
  });

  if (register.data?.token) {
    jwt = register.data.token;
    // Decode JWT to get account_id
    const jwtPayload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString());
    accountId = jwtPayload.account_id;
    console.log(`🎟️ JWT Token obtained: ${jwt.substring(0, 50)}...`);
    console.log(`🏢 Account ID: ${accountId}`);
  } else {
    console.log('❌ Registration failed, stopping tests');
    console.log('Response:', register.data);
    return;
  }

  // Test login
  console.log('\n🔑 TESTING LOGIN');
  const login = await test('/auth/login', {
    method: 'POST',
    body: {
      email: 'test-api@fluxi.com',
      password: 'test123456'
    }
  });

  // Test /auth/me
  console.log('\n👤 TESTING /auth/me');
  await test('/auth/me', {
    headers: { Authorization: `Bearer ${jwt}` }
  });

  // =========================================
  // 3. ACCOUNTS MANAGEMENT
  // =========================================
  console.log('\n🏢 3. ACCOUNTS MANAGEMENT');

  // List user accounts
  console.log('\n📋 LISTING USER ACCOUNTS');
  await test('/accounts', {
    headers: { Authorization: `Bearer ${jwt}` }
  });

  // List account users
  console.log('\n👥 LISTING ACCOUNT USERS');
  await test(`/accounts/${accountId}/users`, {
    headers: { Authorization: `Bearer ${jwt}` }
  });

  // =========================================
  // 4. CHANNEL MANAGEMENT
  // =========================================
  console.log('\n🔗 4. CHANNEL MANAGEMENT');

  // List channel types
  console.log('\n📋 LISTING CHANNEL TYPES');
  await test('/channel-types', {
    headers: { Authorization: `Bearer ${jwt}` }
  });

  // Create Siigo channel
  console.log('\n➕ CREATING SIIGO CHANNEL');
  const channelCreate = await test('/channels', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      account_id: accountId,
      name: 'Siigo Test Channel',
      type: 'siigo',
      external_id: 'test@siigo.com',
      config: {
        username: 'test@siigo.com',
        api_key: 'test_api_key_123'
      }
    }
  });

  if (channelCreate.data?.channel?.id) {
    channelId = channelCreate.data.channel.id;
    console.log(`🔗 Channel ID: ${channelId}`);
  }

  // List channels
  console.log('\n📋 LISTING CHANNELS');
  await test('/channels', {
    headers: { Authorization: `Bearer ${jwt}` },
    body: { account_id: accountId }
  });

  // Test channel connection (will fail with test credentials)
  if (channelId) {
    console.log('\n🧪 TESTING CHANNEL CONNECTION');
    await test(`/channels/${channelId}/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` }
    });
  }

  // =========================================
  // 5. PRODUCT MANAGEMENT
  // =========================================
  console.log('\n📦 5. PRODUCT MANAGEMENT');

  // Create product
  console.log('\n➕ CREATING PRODUCT');
  const productCreate = await test('/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      account_id: accountId,
      name: 'Test Product API',
      sku: 'TEST-API-001',
      price: 50000,
      stock: 100,
      status: 'active'
    }
  });

  if (productCreate.data?.data?.id) {
    productId = productCreate.data.data.id;
    console.log(`📦 Product ID: ${productId}`);
  }

  // List products
  console.log('\n📋 LISTING PRODUCTS');
  await test('/products', {
    headers: { Authorization: `Bearer ${jwt}` },
    body: { account_id: accountId }
  });

  // Get single product
  if (productId) {
    console.log('\n🔍 GETTING SINGLE PRODUCT');
    await test(`/products/${productId}`, {
      headers: { Authorization: `Bearer ${jwt}` }
    });

    // Update product
    console.log('\n✏️ UPDATING PRODUCT');
    await test(`/products/${productId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${jwt}` },
      body: {
        name: 'Test Product API - Updated',
        price: 55000
      }
    });
  }

  // =========================================
  // 6. ORDER MANAGEMENT
  // =========================================
  console.log('\n🛒 6. ORDER MANAGEMENT');

  // Create manual order
  if (productId) {
    console.log('\n📝 CREATING MANUAL ORDER');
    const orderCreate = await test('/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: {
        account_id: accountId,
        type: 'manual',
        customer_name: 'Juan Pérez',
        customer_email: 'juan@example.com',
        items: [
          {
            product_id: productId,
            quantity: 2
          }
        ]
      }
    });

    if (orderCreate.data?.data?.id) {
      orderId = orderCreate.data.data.id;
      console.log(`🛒 Order ID: ${orderId}`);
    }

    // List orders
    console.log('\n📋 LISTING ORDERS');
    await test('/orders', {
      headers: { Authorization: `Bearer ${jwt}` },
      body: { account_id: accountId }
    });

    // Get single order
    if (orderId) {
      console.log('\n🔍 GETTING SINGLE ORDER');
      await test(`/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${jwt}` }
      });

      // Update order status
      console.log('\n📊 UPDATING ORDER STATUS');
      await test(`/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${jwt}` },
        body: { status: 'confirmed' }
      });
    }
  }

  // =========================================
  // 7. CLEANUP (Optional)
  // =========================================
  console.log('\n🧹 CLEANUP SECTION');

  // Delete order
  if (orderId) {
    console.log('\n🗑️ DELETING ORDER (if endpoint exists)');
    // Note: Orders typically shouldn't be deleted, but if endpoint exists
  }

  // Delete product
  if (productId) {
    console.log('\n🗑️ DELETING PRODUCT');
    await test(`/products/${productId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt}` }
    });
  }

  // Delete channel
  if (channelId) {
    console.log('\n🗑️ DELETING CHANNEL');
    await test(`/channels/${channelId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt}` }
    });
  }

  // =========================================
  // SUMMARY
  // =========================================
  console.log('\n🎉 TEST SUITE COMPLETED');
  console.log('========================');
  console.log(`✅ JWT Token: ${jwt ? 'Obtained' : 'Failed'}`);
  console.log(`✅ Account: ${accountId ? 'Created' : 'Failed'}`);
  console.log(`✅ Channel: ${channelId ? 'Created' : 'Failed'}`);
  console.log(`✅ Product: ${productId ? 'Created' : 'Failed'}`);
  console.log(`✅ Order: ${orderId ? 'Created' : 'Failed'}`);
  console.log('\n🔍 Check the logs above for detailed results');
}

// Handle script execution
if (require.main === module) {
  runCompleteTest().catch(console.error);
}

module.exports = { runCompleteTest, test };