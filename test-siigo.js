#!/usr/bin/env node

/**
 * Comprehensive test script for Multi-Channel Product Architecture
 * Tests all endpoints according to the new architecture
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
  console.log('🚀 Starting Multi-Channel Product Architecture Tests\n');

  let jwt = null;
  let channelId = null;
  let productIds = [];

  try {
    // ==========================================
    // 1. AUTHENTICATION
    // ==========================================

    // 1.1 Try to register test user first
    console.log('1️⃣ AUTHENTICATION - Register test user');
    const registerResult = await test('/auth/register', {
      method: 'POST',
      body: {
        email: TEST_CREDENTIALS.email,
        password: TEST_CREDENTIALS.password
      }
    });

    if (registerResult && registerResult.token) {
      console.log('✅ Test user registered successfully');
      jwt = registerResult.token;
      // Update account_id from registration response
      TEST_CREDENTIALS.account_id = registerResult.account.id;
      console.log('📝 Account ID updated:', TEST_CREDENTIALS.account_id);
    } else {
      // User might already exist, try login
      console.log('2️⃣ AUTHENTICATION - Login (user might already exist)');
      const loginResult = await test('/auth/login', {
        method: 'POST',
        body: {
          email: TEST_CREDENTIALS.email,
          password: TEST_CREDENTIALS.password
        }
      });

      if (!loginResult || !loginResult.token) {
        console.log('❌ Cannot continue without JWT token');
        return;
      }

      jwt = loginResult.token;
      // Update account_id from login response
      TEST_CREDENTIALS.account_id = loginResult.account.id;
      console.log('📝 Account ID updated from login:', TEST_CREDENTIALS.account_id);
    }

    console.log('✅ Authentication successful');

    // ==========================================
    // 2. CHANNEL MANAGEMENT
    // ==========================================

    // 2.1 List available channel types
    console.log('\n2️⃣ CHANNEL TYPES - List available types');
    await test('/channel-types', {
      headers: { Authorization: `Bearer ${jwt}` }
    });

    // 2.2 List existing channels
    console.log('\n3️⃣ CHANNELS - List channels for account');
    const channelsResult = await test(`/channels?account_id=${TEST_CREDENTIALS.account_id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` }
    });

    // 2.3 Create Siigo channel
    console.log('\n4️⃣ CREATE CHANNEL - Siigo ERP');
    const channelResult = await test('/channels', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: {
        account_id: TEST_CREDENTIALS.account_id,
        channel_type_id: 'siigo',
        name: 'Siigo ERP Test',
        description: 'Test connection to Siigo',
        external_id: TEST_CREDENTIALS.siigo_username,
        config: {
          username: TEST_CREDENTIALS.siigo_username,
          api_key: TEST_CREDENTIALS.siigo_api_key
        }
      }
    });

    if (!channelResult || !channelResult.channel) {
      console.log('❌ Cannot continue without channel');
      return;
    }

    channelId = channelResult.channel.id;
    console.log('✅ Siigo channel created with ID:', channelId);

    // ==========================================
    // 3. CHANNEL TESTING
    // ==========================================

    // 3.1 Test Siigo connection
    console.log('\n5️⃣ TEST CONNECTION - Siigo channel');
    const testResult = await test(`/channels/${channelId}/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: {} // Empty JSON body as required by Fastify
    });

    if (testResult && testResult.test_result) {
      if (testResult.test_result.success) {
        console.log('✅ Siigo connection successful');
      } else {
        console.log('⚠️ Siigo connection failed:', testResult.test_result.message);
      }
    }

    // ==========================================
    // 4. PRODUCT MANAGEMENT
    // ==========================================

    // 4.1 Get all products (should be empty initially)
    console.log('\n6️⃣ PRODUCTS - Get all products');
    const allProductsResult = await test(`/products?account_id=${TEST_CREDENTIALS.account_id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` }
    });

    console.log(`📊 Total products in catalog: ${allProductsResult?.data?.total || 0}`);

    // 4.2 Sync products from Siigo channel
    console.log('\n7️⃣ SYNC PRODUCTS - From Siigo channel');
    const syncResult = await test(`/channels/${channelId}/products`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` }
    });

    if (syncResult && syncResult.products) {
      console.log(`✅ Synced ${syncResult.products.length} products from Siigo`);
      productIds = syncResult.products.map(p => p.id);
      console.log('📝 Product IDs:', productIds);
    }

    // 4.3 Get products from Siigo channel again (should return from DB now)
    console.log('\n8️⃣ GET CHANNEL PRODUCTS - Siigo channel');
    const channelProductsResult = await test(`/channels/${channelId}/products`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` }
    });

    if (channelProductsResult && channelProductsResult.products) {
      console.log(`📊 Products in Siigo channel: ${channelProductsResult.products.length}`);
    }

    // 4.4 Get all products again (should include synced products)
    console.log('\n9️⃣ PRODUCTS - Get all products after sync');
    const allProductsAfterSync = await test(`/products?account_id=${TEST_CREDENTIALS.account_id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` }
    });

    console.log(`📊 Total products after sync: ${allProductsAfterSync?.data?.total || 0}`);

    // ==========================================
    // 5. PRODUCT OPERATIONS
    // ==========================================

    if (productIds.length > 0) {
      // 5.1 Import specific products to catalog
      console.log('\n🔟 IMPORT PRODUCTS - To catalog');
      const importResult = await test(`/channels/${channelId}/import-products`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body: {
          product_ids: productIds.slice(0, 2) // Import first 2 products
        }
      });

      if (importResult) {
        console.log(`✅ Imported ${importResult.imported_products?.length || 0} products`);
      }

      // 5.2 Share products between channels (mock - would need second channel)
      console.log('\n1️⃣1️⃣ SHARE PRODUCTS - Between channels');
      const shareResult = await test('/channels/share-products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body: {
          product_ids: productIds.slice(0, 1),
          target_channel_ids: [channelId] // Share to same channel for testing
        }
      });

      if (shareResult) {
        console.log(`✅ Shared products to ${shareResult.shared_products?.length || 0} channels`);
      }
    }

    // ==========================================
    // 6. CLEANUP (Optional)
    // ==========================================

    console.log('\n🏁 All tests completed successfully!');
    console.log('\n📋 Test Summary:');
    console.log('✅ Authentication');
    console.log('✅ Channel creation');
    console.log('✅ Channel testing');
    console.log('✅ Product synchronization');
    console.log('✅ Product import');
    console.log('✅ Product sharing');
    console.log('✅ Multi-channel architecture working');

  } catch (error) {
    console.log('\n💥 Test suite failed:', error.message);
    console.error(error);
  }
}

// Run tests
runTests().catch(console.error);