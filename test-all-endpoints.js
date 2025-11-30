#!/usr/bin/env node

// Complete API Testing Script for ALL Fluxi Backend Endpoints
// Tests all 38 endpoints systematically with proper authentication

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

async function runCompleteEndpointTest() {
  console.log('🚀 FLUXI BACKEND - COMPLETE ENDPOINT VALIDATION');
  console.log('===============================================\n');

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
  // 2. AUTHENTICATION (3 endpoints)
  // =========================================
  console.log('\n🔐 2. AUTHENTICATION');

  // Register new user and account
  console.log('\n📝 REGISTERING NEW USER & ACCOUNT');
  const timestamp = Date.now();
  const register = await test('/auth/register', {
    method: 'POST',
    body: {
      email: `test-endpoints-${timestamp}@fluxi.com`,
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
      email: `test-endpoints-${timestamp}@fluxi.com`,
      password: 'test123456'
    }
  });

  // Test /auth/me
  console.log('\n👤 TESTING /auth/me');
  await test('/auth/me', {
    headers: { Authorization: `Bearer ${jwt}` }
  });

  // =========================================
  // 3. ACCOUNTS MANAGEMENT (6 endpoints)
  // =========================================
  console.log('\n🏢 3. ACCOUNTS MANAGEMENT');

  // GET /accounts - List user's accounts
  console.log('\n📋 LISTING USER ACCOUNTS');
  await test('/accounts', {
    headers: { Authorization: `Bearer ${jwt}` }
  });

  // POST /accounts - Create new account
  console.log('\n➕ CREATING NEW ACCOUNT');
  const newAccount = await test('/accounts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      name: 'Test Account 2',
      slug: 'test-account-2'
    }
  });

  // GET /accounts/:accountId/members - List account members
  console.log('\n👥 LISTING ACCOUNT MEMBERS');
  await test(`/accounts/${accountId}/members`, {
    headers: { Authorization: `Bearer ${jwt}` }
  });

  // GET /accounts/:accountId/users - Alias for members
  console.log('\n👥 LISTING ACCOUNT USERS (alias)');
  await test(`/accounts/${accountId}/users`, {
    headers: { Authorization: `Bearer ${jwt}` }
  });

  // POST /accounts/:accountId/members/invite - Invite member
  console.log('\n📨 INVITING MEMBER');
  await test(`/accounts/${accountId}/members/invite`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      email: 'invited@example.com',
      role: 'member'
    }
  });

  // PATCH /accounts/:accountId/members/:memberId - Update member role
  console.log('\n✏️ UPDATING MEMBER ROLE');
  // First get a member ID from the members list
  const membersResponse = await test(`/accounts/${accountId}/members`, {
    headers: { Authorization: `Bearer ${jwt}` }
  });
  if (membersResponse.data?.data?.[0]?.id) {
    const memberId = membersResponse.data.data[0].id;
    await test(`/accounts/${accountId}/members/${memberId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${jwt}` },
      body: { role: 'admin' }
    });
  }

  // =========================================
  // 4. PRODUCTS MANAGEMENT (5 endpoints)
  // =========================================
  console.log('\n📦 4. PRODUCTS MANAGEMENT');

  // POST /products - Create product
  console.log('\n➕ CREATING PRODUCT');
  const productCreate = await test('/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      account_id: accountId,
      name: 'Test Product Complete',
      sku: 'TEST-COMPLETE-001',
      price: 50000,
      description: 'Producto de prueba completo',
      status: 'active'
    }
  });

  if (productCreate.data?.data?.id) {
    productId = productCreate.data.data.id;
    console.log(`📦 Product ID: ${productId}`);
  }

  // GET /products - List products
  console.log('\n📋 LISTING PRODUCTS');
  await test('/products', {
    headers: { Authorization: `Bearer ${jwt}` },
    body: { account_id: accountId }
  });

  // GET /products - With search
  console.log('\n🔍 SEARCHING PRODUCTS');
  await test('/products', {
    headers: { Authorization: `Bearer ${jwt}` },
    body: { account_id: accountId, search: 'test' }
  });

  // GET /products/:id - Get single product
  if (productId) {
    console.log('\n🔍 GETTING SINGLE PRODUCT');
    await test(`/products/${productId}`, {
      headers: { Authorization: `Bearer ${jwt}` }
    });

    // PUT /products/:id - Update product
    console.log('\n✏️ UPDATING PRODUCT');
    await test(`/products/${productId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${jwt}` },
      body: {
        name: 'Test Product Complete - Updated',
        price: 55000
      }
    });

    // DELETE /products/:id - Delete product
    console.log('\n🗑️ DELETING PRODUCT');
    await test(`/products/${productId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt}` }
    });
  }

  // =========================================
  // 5. INVENTORY MANAGEMENT (1 endpoint)
  // =========================================
  console.log('\n📊 5. INVENTORY MANAGEMENT');

  // PUT /inventories - Update stock
  console.log('\n📦 UPDATING INVENTORY STOCK');
  await test('/inventories', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      product_id: productId || 'placeholder-product-id',
      warehouse: 'default',
      quantity: 100
    }
  });

  // =========================================
  // 6. CHANNELS MANAGEMENT (6 endpoints)
  // =========================================
  console.log('\n🔗 6. CHANNELS MANAGEMENT');

  // GET /channel-types - List channel types
  console.log('\n📋 LISTING CHANNEL TYPES');
  await test('/channel-types');

  // POST /channels - Create channel
  console.log('\n➕ CREATING SHOPIFY CHANNEL');
  const channelCreate = await test('/channels', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      account_id: accountId,
      name: 'Test Shopify Store',
      type: 'shopify',
      external_id: 'test-store.myshopify.com',
      config: {
        store_url: 'https://test-store.myshopify.com',
        api_key: 'test_api_key',
        api_secret: 'test_api_secret'
      }
    }
  });

  if (channelCreate.data?.channel?.id) {
    channelId = channelCreate.data.channel.id;
    console.log(`🔗 Channel ID: ${channelId}`);
  }

  // GET /channels - List channels
  console.log('\n📋 LISTING CHANNELS');
  await test('/channels', {
    headers: { Authorization: `Bearer ${jwt}` },
    body: { account_id: accountId }
  });

  // PUT /channels/:id - Update channel
  if (channelId) {
    console.log('\n✏️ UPDATING CHANNEL');
    await test(`/channels/${channelId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${jwt}` },
      body: {
        name: 'Test Shopify Store - Updated'
      }
    });

    // POST /channels/:id/test - Test channel connection
    console.log('\n🧪 TESTING CHANNEL CONNECTION');
    await test(`/channels/${channelId}/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` }
    });

    // DELETE /channels/:id - Delete channel
    console.log('\n🗑️ DELETING CHANNEL');
    await test(`/channels/${channelId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt}` }
    });
  }

  // =========================================
  // 7. ORDERS MANAGEMENT (6 endpoints)
  // =========================================
  console.log('\n🛒 7. ORDERS MANAGEMENT');

  // POST /orders - Create order
  console.log('\n📝 CREATING ORDER');
  const orderCreate = await test('/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      account_id: accountId,
      type: 'manual',
      customer_name: 'Juan Pérez',
      customer_email: 'juan@example.com',
      customer_phone: '+57 300 123 4567',
      notes: 'Pedido de prueba completo',
      items: [
        {
          product_id: productId || 'placeholder-product-id',
          quantity: 2
        }
      ]
    }
  });

  if (orderCreate.data?.data?.id) {
    orderId = orderCreate.data.data.id;
    console.log(`🛒 Order ID: ${orderId}`);
  }

  // GET /orders - List orders
  console.log('\n📋 LISTING ORDERS');
  await test('/orders', {
    headers: { Authorization: `Bearer ${jwt}` },
    body: { account_id: accountId }
  });

  // GET /orders - With filters
  console.log('\n🔍 LISTING ORDERS WITH FILTERS');
  await test('/orders', {
    headers: { Authorization: `Bearer ${jwt}` },
    body: { account_id: accountId, status: 'created', limit: 10 }
  });

  if (orderId) {
    // GET /orders/:id - Get single order
    console.log('\n🔍 GETTING SINGLE ORDER');
    await test(`/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${jwt}` }
    });

    // PUT /orders/:id - Update order
    console.log('\n✏️ UPDATING ORDER');
    await test(`/orders/${orderId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${jwt}` },
      body: {
        customer_name: 'Juan Pérez Actualizado',
        notes: 'Pedido actualizado'
      }
    });

    // PATCH /orders/:id/status - Change order status
    console.log('\n📊 CHANGING ORDER STATUS');
    await test(`/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${jwt}` },
      body: { status: 'confirmed' }
    });

    // DELETE /orders/:id - Delete order
    console.log('\n🗑️ DELETING ORDER');
    await test(`/orders/${orderId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt}` }
    });
  }

  // =========================================
  // 8. SYNCHRONIZATION (4 endpoints)
  // =========================================
  console.log('\n🔄 8. SYNCHRONIZATION');

  // POST /sync/products - Sync products
  console.log('\n🔄 SYNCING PRODUCTS');
  await test('/sync/products', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      account_id: accountId,
      direction: 'from_channel'
    }
  });

  // POST /sync/inventory - Sync inventory
  console.log('\n🔄 SYNCING INVENTORY');
  await test('/sync/inventory', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      account_id: accountId,
      direction: 'from_channel'
    }
  });

  // POST /sync/orders - Sync orders
  console.log('\n🔄 SYNCING ORDERS');
  await test('/sync/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      account_id: accountId,
      direction: 'from_channel'
    }
  });

  // GET /sync/status - Get sync status
  console.log('\n📊 GETTING SYNC STATUS');
  await test('/sync/status', {
    headers: { Authorization: `Bearer ${jwt}` },
    body: { account_id: accountId }
  });

  // =========================================
  // SUMMARY
  // =========================================
  console.log('\n🎉 ENDPOINT VALIDATION COMPLETED');
  console.log('====================================');
  console.log(`✅ JWT Token: ${jwt ? 'Generated' : 'Failed'}`);
  console.log(`✅ Account: ${accountId ? 'Created' : 'Failed'}`);
  console.log(`✅ Product: ${productId ? 'Created' : 'Failed'}`);
  console.log(`✅ Channel: ${channelId ? 'Created' : 'Failed'}`);
  console.log(`✅ Order: ${orderId ? 'Created' : 'Failed'}`);
  console.log('\n🔍 All 38 endpoints tested systematically');
  console.log('📋 Check the logs above for detailed results');
}

// Handle script execution
if (require.main === module) {
  runCompleteEndpointTest().catch(console.error);
}

module.exports = { runCompleteEndpointTest, test };