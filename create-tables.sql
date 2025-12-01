-- =========================================
-- FLUXI BACKEND - DATABASE CREATION SCRIPT
-- Execute this in Supabase SQL Editor to create all tables
-- =========================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================
-- 1. ACCOUNTS & USERS (Multi-tenancy)
-- =========================================

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  default_currency VARCHAR(3) DEFAULT 'COP',
  timezone VARCHAR(50) DEFAULT 'America/Bogota',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE account_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'manager', 'member')),
  is_owner BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, user_id)
);

-- =========================================
-- 2. CHANNEL SYSTEM
-- =========================================

CREATE TABLE channel_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  base_api_url VARCHAR(500),
  auth_type VARCHAR(20) DEFAULT 'api_key',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE channel_type_fields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_type_id UUID NOT NULL REFERENCES channel_types(id) ON DELETE CASCADE,
  key VARCHAR(100) NOT NULL,
  label VARCHAR(255) NOT NULL,
  field_type VARCHAR(20) NOT NULL DEFAULT 'string',
  required BOOLEAN DEFAULT FALSE,
  options JSONB,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_type_id, key)
);

CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_type_id UUID NOT NULL REFERENCES channel_types(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error', 'syncing')),
  is_primary BOOLEAN DEFAULT FALSE,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE channel_config_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  channel_type_field_id UUID NOT NULL REFERENCES channel_type_fields(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, channel_type_field_id)
);

-- =========================================
-- 3. INVENTORY SYSTEM
-- =========================================

CREATE TABLE inventories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) DEFAULT 'physical' CHECK (type IN ('physical', 'virtual', 'consignment', 'dropship')),
  external_id VARCHAR(255),
  is_default BOOLEAN DEFAULT FALSE,
  address JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE inventory_stock_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inventory_id UUID NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  product_variant_id UUID NOT NULL, -- Will be created later
  quantity DECIMAL(15,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved_quantity DECIMAL(15,3) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(inventory_id, product_variant_id)
);

CREATE TABLE channel_inventory_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  inventory_id UUID NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  mode VARCHAR(20) NOT NULL DEFAULT 'read_write' CHECK (mode IN ('read_only', 'write_only', 'read_write')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, inventory_id)
);

-- =========================================
-- 4. PRODUCT CATALOG (PIM)
-- =========================================

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  slug VARCHAR(255),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, slug)
);

CREATE TABLE product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  internal_sku VARCHAR(100) NOT NULL,
  attributes JSONB DEFAULT '{}',
  barcode VARCHAR(100),
  weight DECIMAL(10,3),
  dimensions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(internal_sku)
);

-- Now add the foreign key constraint
ALTER TABLE inventory_stock_items
ADD CONSTRAINT fk_inventory_stock_items_variant
FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE CASCADE;

CREATE TABLE channel_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  product_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  external_sku VARCHAR(100),
  price DECIMAL(15,2),
  currency VARCHAR(3) DEFAULT 'COP',
  status VARCHAR(20) DEFAULT 'imported' CHECK (status IN ('imported', 'published', 'unpublished', 'archived')),
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_id, product_variant_id),
  UNIQUE(channel_id, external_id)
);

-- Staging table for channel product imports
CREATE TABLE IF NOT EXISTS channel_products_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  external_id VARCHAR(255) NOT NULL,
  external_sku VARCHAR(255) NOT NULL,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  price DECIMAL(15,2) DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'COP',
  stock INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'active',
  raw_data JSONB,
  import_status VARCHAR(50) DEFAULT 'pending',
  imported_at TIMESTAMPTZ,
  imported_product_id UUID REFERENCES products(id),
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_staging_product_per_channel UNIQUE (channel_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_staging_account ON channel_products_staging(account_id);
CREATE INDEX IF NOT EXISTS idx_staging_channel ON channel_products_staging(channel_id);
CREATE INDEX IF NOT EXISTS idx_staging_import_status ON channel_products_staging(import_status);
CREATE INDEX IF NOT EXISTS idx_staging_external_sku ON channel_products_staging(external_sku);

-- =========================================
-- 5. ORDER MANAGEMENT
-- =========================================

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  external_order_id VARCHAR(255),
  origin VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'external', 'api')),
  status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded')),
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'COP',
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_phone VARCHAR(50),
  customer_address JSONB,
  notes TEXT,
  order_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity DECIMAL(10,3) NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(15,2) NOT NULL,
  total_price DECIMAL(15,2) NOT NULL,
  external_product_id VARCHAR(255),
  external_variant_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- 6. SYNC & AUDIT SYSTEM
-- =========================================

CREATE TABLE sync_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  action VARCHAR(50) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'warning')),
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- TRIGGERS FOR AUTOMATION
-- =========================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to tables with updated_at
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_channels_updated_at BEFORE UPDATE ON channels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Calculate order total automatically
CREATE OR REPLACE FUNCTION calculate_order_total()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE orders
  SET total_amount = (
    SELECT COALESCE(SUM(total_price), 0)
    FROM order_items
    WHERE order_id = COALESCE(NEW.order_id, OLD.order_id)
  )
  WHERE id = COALESCE(NEW.order_id, OLD.order_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_calculate_order_total
  AFTER INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION calculate_order_total();

-- =========================================
-- VIEWS FOR COMMON QUERIES
-- =========================================

CREATE OR REPLACE VIEW product_catalog AS
SELECT
  p.id,
  p.account_id,
  p.name,
  p.slug,
  p.status,
  pv.id as variant_id,
  pv.internal_sku,
  pv.attributes,
  pv.barcode,
  COALESCE(SUM(isi.quantity), 0) as total_stock,
  COALESCE(SUM(isi.reserved_quantity), 0) as reserved_stock,
  COALESCE(SUM(isi.quantity - isi.reserved_quantity), 0) as available_stock
FROM products p
LEFT JOIN product_variants pv ON p.id = pv.product_id
LEFT JOIN inventory_stock_items isi ON pv.id = isi.product_variant_id
GROUP BY p.id, p.account_id, p.name, p.slug, p.status, pv.id, pv.internal_sku, pv.attributes, pv.barcode;

CREATE OR REPLACE VIEW order_summary AS
SELECT
  o.id,
  o.account_id,
  o.channel_id,
  o.external_order_id,
  o.origin,
  o.status,
  o.total_amount,
  o.currency,
  o.customer_name,
  o.customer_email,
  o.order_date,
  COALESCE(
    json_agg(
      json_build_object(
        'id', oi.id,
        'variant_id', oi.product_variant_id,
        'quantity', oi.quantity,
        'unit_price', oi.unit_price,
        'total_price', oi.total_price,
        'variant_sku', pv.internal_sku,
        'product_name', p.name
      )
    ) FILTER (WHERE oi.id IS NOT NULL),
    '[]'::json
  ) as items
FROM orders o
LEFT JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN product_variants pv ON oi.product_variant_id = pv.id
LEFT JOIN products p ON pv.product_id = p.id
GROUP BY o.id, o.account_id, o.channel_id, o.external_order_id, o.origin, o.status, o.total_amount, o.currency, o.customer_name, o.customer_email, o.order_date;

-- =========================================
-- INITIAL DATA (SEED)
-- =========================================

-- Channel types
INSERT INTO channel_types (code, name, category, base_api_url, auth_type) VALUES
('siigo', 'Siigo ERP', 'erp', 'https://api.siigo.com/v1', 'api_key'),
('shopify', 'Shopify', 'ecommerce', 'https://{{store}}.myshopify.com/admin/api/2024-01', 'api_key'),
('woocommerce', 'WooCommerce', 'ecommerce', null, 'api_key'),
('prestashop', 'PrestaShop', 'ecommerce', null, 'api_key'),
('manual', 'Manual/POS', 'pos', null, 'none');

-- Siigo configuration fields
INSERT INTO channel_type_fields (channel_type_id, key, label, field_type, required, description) VALUES
((SELECT id FROM channel_types WHERE code = 'siigo'), 'username', 'Usuario Siigo', 'string', true, 'Correo electrónico del usuario en Siigo'),
((SELECT id FROM channel_types WHERE code = 'siigo'), 'api_key', 'API Key', 'password', true, 'Clave API generada en Siigo');

-- Shopify configuration fields
INSERT INTO channel_type_fields (channel_type_id, key, label, field_type, required, description) VALUES
((SELECT id FROM channel_types WHERE code = 'shopify'), 'store_url', 'Tienda Shopify', 'string', true, 'URL de la tienda (ej: mystore.myshopify.com)'),
((SELECT id FROM channel_types WHERE code = 'shopify'), 'access_token', 'Access Token', 'password', true, 'Token de acceso de Shopify');

-- =========================================
-- INDEXES FOR PERFORMANCE
-- =========================================

CREATE INDEX idx_account_users_account_id ON account_users(account_id);
CREATE INDEX idx_account_users_user_id ON account_users(user_id);
CREATE INDEX idx_channels_account_id ON channels(account_id);
CREATE INDEX idx_products_account_id ON products(account_id);
CREATE INDEX idx_inventories_account_id ON inventories(account_id);
CREATE INDEX idx_orders_account_id ON orders(account_id);
CREATE INDEX idx_channel_config_values_channel_id ON channel_config_values(channel_id);
CREATE INDEX idx_channel_products_channel_id ON channel_products(channel_id);
CREATE INDEX idx_inventory_stock_items_inventory_id ON inventory_stock_items(inventory_id);
CREATE INDEX idx_inventory_stock_items_variant_id ON inventory_stock_items(product_variant_id);
CREATE INDEX idx_orders_channel_id ON orders(channel_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_sync_logs_account_id ON sync_logs(account_id);
CREATE INDEX idx_sync_logs_channel_id ON sync_logs(channel_id);
CREATE INDEX idx_sync_logs_created_at ON sync_logs(created_at DESC);

-- =========================================
-- ROW LEVEL SECURITY (OPTIONAL)
-- =========================================

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- RLS Policies (users can only access their accounts)
CREATE POLICY accounts_policy ON accounts
  FOR ALL USING (
    id IN (
      SELECT account_id FROM account_users
      WHERE user_id = auth.uid()
    )
  );

-- =========================================
-- END OF SCRIPT
-- =========================================

-- Instructions:
-- 1. Execute this entire script in Supabase SQL Editor
-- 2. All tables, relationships, indexes, triggers, and initial data will be created
-- 3. The database will be ready for the Fluxi backend API
-- 4. No errors should occur if executed in order
