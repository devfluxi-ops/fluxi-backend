-- =========================================
-- FLUXI 3.0 DATABASE SCHEMA MIGRATION
-- =========================================
-- This script transforms the current database to match the Fluxi 3.0 specification
-- Run this in Supabase SQL Editor

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================
-- 1. ACCOUNTS TABLE
-- =========================================

-- Drop existing accounts table if exists
DROP TABLE IF EXISTS accounts CASCADE;

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  plan VARCHAR(50) DEFAULT 'free',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =========================================
-- 2. USERS TABLE
-- =========================================

DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'member',
  avatar_url VARCHAR(500),
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =========================================
-- 3. CHANNEL TYPES TABLE
-- =========================================

DROP TABLE IF EXISTS channel_types CASCADE;

CREATE TABLE channel_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  category VARCHAR(50),
  auth_type VARCHAR(50),
  config JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert predefined channel types
INSERT INTO channel_types (slug, name, category, auth_type, config) VALUES
('siigo', 'Siigo', 'erp', 'api_key', '{"api_url": "https://api.siigo.com/v1"}'),
('shopify', 'Shopify', 'ecommerce', 'oauth2', '{"scopes": ["read_products", "write_inventory"]}'),
('woocommerce', 'WooCommerce', 'ecommerce', 'api_key', '{}'),
('mercadolibre', 'Mercado Libre', 'marketplace', 'oauth2', '{}'),
('amazon', 'Amazon', 'marketplace', 'oauth2', '{}');

-- =========================================
-- 4. CHANNELS TABLE
-- =========================================

DROP TABLE IF EXISTS channels CASCADE;

CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_type_id UUID NOT NULL REFERENCES channel_types(id),
  name VARCHAR(255) NOT NULL,
  credentials JSONB NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  last_sync_at TIMESTAMP,
  last_sync_status VARCHAR(50),
  last_sync_message TEXT,
  sync_config JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =========================================
-- 5. PRODUCTS TABLE
-- =========================================

DROP TABLE IF EXISTS products CASCADE;

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sku VARCHAR(100) NOT NULL,
  barcode VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(15, 2) DEFAULT 0,
  compare_at_price DECIMAL(15, 2),
  cost DECIMAL(15, 2),
  currency VARCHAR(3) DEFAULT 'COP',
  stock INTEGER DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 5,
  track_inventory BOOLEAN DEFAULT true,
  allow_backorder BOOLEAN DEFAULT false,
  category VARCHAR(255),
  tags TEXT[],
  vendor VARCHAR(255),
  images JSONB DEFAULT '[]',
  status VARCHAR(50) DEFAULT 'active',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(account_id, sku)
);

-- =========================================
-- 6. CHANNEL PRODUCTS TABLE
-- =========================================

DROP TABLE IF EXISTS channel_products CASCADE;

CREATE TABLE channel_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  external_sku VARCHAR(255),
  external_url VARCHAR(500),
  external_price DECIMAL(15, 2),
  sync_status VARCHAR(50) DEFAULT 'synced',
  sync_error TEXT,
  synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(product_id, channel_id),
  UNIQUE(channel_id, external_id)
);

-- =========================================
-- 7. CHANNEL PRODUCTS STAGING TABLE
-- =========================================

DROP TABLE IF EXISTS channel_products_staging CASCADE;

CREATE TABLE channel_products_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  external_sku VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(15, 2) DEFAULT 0,
  compare_at_price DECIMAL(15, 2),
  cost DECIMAL(15, 2),
  stock INTEGER DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'COP',
  images JSONB DEFAULT '[]',
  category VARCHAR(255),
  vendor VARCHAR(255),
  raw_data JSONB,
  status VARCHAR(50) DEFAULT 'pending',
  existing_product_id UUID REFERENCES products(id),
  exists_in_inventory BOOLEAN DEFAULT false,
  synced_at TIMESTAMP DEFAULT NOW(),
  imported_at TIMESTAMP,
  imported_product_id UUID REFERENCES products(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(channel_id, external_id)
);

-- =========================================
-- 8. STOCK MOVEMENTS TABLE
-- =========================================

DROP TABLE IF EXISTS stock_movements CASCADE;

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id),
  type VARCHAR(50) NOT NULL,
  quantity INTEGER NOT NULL,
  previous_stock INTEGER NOT NULL,
  new_stock INTEGER NOT NULL,
  reason VARCHAR(255),
  reference VARCHAR(255),
  notes TEXT,
  user_id UUID REFERENCES users(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- =========================================
-- 9. ORDERS TABLE
-- =========================================

DROP TABLE IF EXISTS orders CASCADE;

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id),
  external_id VARCHAR(255),
  order_number VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending',
  payment_status VARCHAR(50),
  fulfillment_status VARCHAR(50),
  customer JSONB NOT NULL,
  items JSONB NOT NULL,
  subtotal DECIMAL(15, 2) NOT NULL,
  discount DECIMAL(15, 2) DEFAULT 0,
  taxes DECIMAL(15, 2) DEFAULT 0,
  shipping DECIMAL(15, 2) DEFAULT 0,
  total DECIMAL(15, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'COP',
  notes TEXT,
  internal_notes TEXT,
  shipping_method VARCHAR(255),
  tracking_number VARCHAR(255),
  tracking_url VARCHAR(500),
  placed_at TIMESTAMP,
  paid_at TIMESTAMP,
  fulfilled_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =========================================
-- 10. SYNC LOGS TABLE
-- =========================================

DROP TABLE IF EXISTS sync_logs CASCADE;

CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id),
  entity_type VARCHAR(50),
  entity_id UUID,
  action VARCHAR(50),
  direction VARCHAR(50),
  status VARCHAR(50),
  message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- =========================================
-- INDEXES FOR PERFORMANCE
-- =========================================

-- Products
CREATE INDEX idx_products_account ON products(account_id);
CREATE INDEX idx_products_sku ON products(account_id, sku);
CREATE INDEX idx_products_status ON products(account_id, status);
CREATE INDEX idx_products_search ON products USING gin(to_tsvector('spanish', name || ' ' || COALESCE(description, '')));

-- Channels
CREATE INDEX idx_channels_account ON channels(account_id);
CREATE INDEX idx_channels_status ON channels(account_id, status);

-- Channel Products
CREATE INDEX idx_channel_products_product ON channel_products(product_id);
CREATE INDEX idx_channel_products_channel ON channel_products(channel_id);
CREATE INDEX idx_channel_products_external ON channel_products(channel_id, external_id);

-- Staging
CREATE INDEX idx_staging_channel ON channel_products_staging(channel_id);
CREATE INDEX idx_staging_status ON channel_products_staging(channel_id, status);
CREATE INDEX idx_staging_account ON channel_products_staging(account_id);

-- Stock Movements
CREATE INDEX idx_movements_product ON stock_movements(product_id);
CREATE INDEX idx_movements_date ON stock_movements(created_at DESC);

-- Orders
CREATE INDEX idx_orders_account ON orders(account_id);
CREATE INDEX idx_orders_channel ON orders(channel_id);
CREATE INDEX idx_orders_status ON orders(account_id, status);
CREATE INDEX idx_orders_date ON orders(created_at DESC);

-- =========================================
-- ROW LEVEL SECURITY POLICIES
-- =========================================

-- Enable RLS on all tables
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_products_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (users can only access their account data)
CREATE POLICY "Users can view own account" ON accounts FOR SELECT USING (id = (SELECT account_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Users can view own products" ON products FOR ALL USING (account_id = (SELECT account_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Users can view own channels" ON channels FOR ALL USING (account_id = (SELECT account_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Users can view own staging" ON channel_products_staging FOR ALL USING (account_id = (SELECT account_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Users can view own orders" ON orders FOR ALL USING (account_id = (SELECT account_id FROM users WHERE id = auth.uid()));
CREATE POLICY "Users can view own sync logs" ON sync_logs FOR ALL USING (account_id = (SELECT account_id FROM users WHERE id = auth.uid()));

-- =========================================
-- MIGRATION COMPLETE
-- =========================================

-- Note: This script completely replaces the existing schema.
-- Make sure to backup any important data before running this migration.