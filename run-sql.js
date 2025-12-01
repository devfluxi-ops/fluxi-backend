#!/usr/bin/env node

// Script to add stock column via backend API
const API_BASE = 'http://localhost:4000';

async function addStockColumn() {
  console.log('Adding stock column to products table via backend...');

  try {
    // Make a request to a temporary endpoint we'll add
    const response = await fetch(`${API_BASE}/admin/add-stock-column`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Error:', error);
      process.exit(1);
    }

    const result = await response.json();
    console.log('✅ Result:', result);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addStockColumn();