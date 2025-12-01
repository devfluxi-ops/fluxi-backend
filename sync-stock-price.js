#!/usr/bin/env node

// Script to sync stock and price from staging to products
const API_BASE = 'http://localhost:4000';

async function syncStockPrice() {
  console.log('Syncing stock and price from staging to products...');

  try {
    // Step 1: Update existing products with stock and price from staging
    console.log('\n📊 Step 1: Updating stock and price...');
    const updateResponse = await fetch(`${API_BASE}/admin/sync-stock-price`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'update_stock_price'
      })
    });

    if (!updateResponse.ok) {
      const error = await updateResponse.text();
      console.error('❌ Update failed:', error);
      return;
    }

    const updateResult = await updateResponse.json();
    console.log('✅ Update result:', updateResult);

    // Step 2: Verify the results
    console.log('\n🔍 Step 2: Verifying results...');
    const verifyResponse = await fetch(`${API_BASE}/admin/sync-stock-price`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'verify_sync'
      })
    });

    if (!verifyResponse.ok) {
      const error = await verifyResponse.text();
      console.error('❌ Verification failed:', error);
      return;
    }

    const verifyResult = await verifyResponse.json();
    console.log('✅ Verification result:', JSON.stringify(verifyResult, null, 2));

  } catch (error) {
    console.error('💥 Error:', error);
    process.exit(1);
  }
}

syncStockPrice();