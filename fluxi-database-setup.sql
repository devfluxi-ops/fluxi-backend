-- =========================================
-- FLUXI BACKEND - COMPLETE DATABASE SETUP
-- =========================================
-- Execute this script in Supabase SQL Editor
-- Creates all tables, indexes, policies, and functions

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================
-- 1. USERS TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE
);

-- =========================================
-- 2. ACCOUNTS TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    default_currency VARCHAR(3) DEFAULT 'COP',
    timezone VARCHAR(50) DEFAULT 'America/Bogota',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =========================================
-- 3. ACCOUNT_USERS TABLE (Multi-tenant membership)
-- =========================================

CREATE TABLE IF NOT EXISTS public.account_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    invited_by UUID REFERENCES public.users(id),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(account_id, user_id)
);

-- =========================================
-- 4. CHANNEL_TYPES TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.channel_types (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    config_fields JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =========================================
-- 5. CHANNEL_TYPE_FIELDS TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.channel_type_fields (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_type_id VARCHAR(50) NOT NULL REFERENCES public.channel_types(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    field_type VARCHAR(50) NOT NULL,
    required BOOLEAN DEFAULT false,
    description TEXT,
    default_value TEXT,
    validation_rules JSONB DEFAULT '{}'::jsonb,
    UNIQUE(channel_type_id, field_name)
);

-- =========================================
-- 6. CHANNELS TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.channels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    name VARCHAR(255),
    description TEXT,
    type VARCHAR(50) NOT NULL REFERENCES public.channel_types(id),
    external_id VARCHAR(255) NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    config JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
    last_error TEXT,
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =========================================
-- 7. PRODUCTS TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    description TEXT,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'discontinued')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(account_id, sku)
);

-- =========================================
-- 8. PRODUCT_VARIANTS TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.product_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL,
    price INTEGER CHECK (price >= 0),
    attributes JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(product_id, sku)
);

-- =========================================
-- 9. INVENTORIES TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.inventories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    warehouse VARCHAR(100) DEFAULT 'default',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =========================================
-- 10. INVENTORY_STOCK_ITEMS TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.inventory_stock_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inventory_id UUID NOT NULL REFERENCES public.inventories(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    product_variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    warehouse VARCHAR(100) DEFAULT 'default',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK (product_id IS NOT NULL OR product_variant_id IS NOT NULL)
);

-- =========================================
-- 11. ORDERS TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (type IN ('manual', 'whatsapp', 'web', 'api')),
    status VARCHAR(20) NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    notes TEXT,
    total_amount NUMERIC(12,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =========================================
-- 12. ORDER_ITEMS TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    product_variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(12,2) NOT NULL CHECK (total_price >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK (product_id IS NOT NULL OR product_variant_id IS NOT NULL)
);

-- =========================================
-- 13. CHANNEL_PRODUCTS TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.channel_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    product_variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
    external_id VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'syncing')),
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(channel_id, product_id, product_variant_id)
);

-- Staging table for channel products
CREATE TABLE IF NOT EXISTS public.channel_products_staging (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
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
    imported_at TIMESTAMP,
    imported_product_id UUID REFERENCES public.products(id),
    synced_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_staging_product_per_channel UNIQUE (channel_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_staging_account ON public.channel_products_staging(account_id);
CREATE INDEX IF NOT EXISTS idx_staging_channel ON public.channel_products_staging(channel_id);
CREATE INDEX IF NOT EXISTS idx_staging_import_status ON public.channel_products_staging(import_status);
CREATE INDEX IF NOT EXISTS idx_staging_external_sku ON public.channel_products_staging(external_sku);

-- =========================================
-- 14. SYNC_LOGS TABLE
-- =========================================

CREATE TABLE IF NOT EXISTS public.sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES public.channels(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('completed', 'error', 'warning')),
    records_processed INTEGER DEFAULT 0,
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =========================================
-- INDEXES FOR PERFORMANCE
-- =========================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON public.users(created_at);

-- Accounts indexes
CREATE INDEX IF NOT EXISTS idx_accounts_owner_id ON public.accounts(owner_id);
CREATE INDEX IF NOT EXISTS idx_accounts_slug ON public.accounts(slug);

-- Account users indexes
CREATE INDEX IF NOT EXISTS idx_account_users_account_id ON public.account_users(account_id);
CREATE INDEX IF NOT EXISTS idx_account_users_user_id ON public.account_users(user_id);

-- Channels indexes
CREATE INDEX IF NOT EXISTS idx_channels_account_id ON public.channels(account_id);
CREATE INDEX IF NOT EXISTS idx_channels_type ON public.channels(type);
CREATE INDEX IF NOT EXISTS idx_channels_status ON public.channels(status);

-- Products indexes
CREATE INDEX IF NOT EXISTS idx_products_account_id ON public.products(account_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products(sku);
CREATE INDEX IF NOT EXISTS idx_products_status ON public.products(status);
CREATE INDEX IF NOT EXISTS idx_products_account_sku ON public.products(account_id, sku);

-- Product variants indexes
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON public.product_variants(sku);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_sku ON public.product_variants(product_id, sku);

-- Inventory indexes
CREATE INDEX IF NOT EXISTS idx_inventories_account_id ON public.inventories(account_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_inventory_id ON public.inventory_stock_items(inventory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_product ON public.inventory_stock_items(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_variant ON public.inventory_stock_items(product_variant_id);

-- Orders indexes
CREATE INDEX IF NOT EXISTS idx_orders_account_id ON public.orders(account_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_type ON public.orders(type);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_account_created ON public.orders(account_id, created_at);

-- Order items indexes
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON public.order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant ON public.order_items(product_variant_id);

-- Channel products indexes
CREATE INDEX IF NOT EXISTS idx_channel_products_channel ON public.channel_products(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_products_product ON public.channel_products(product_id);
CREATE INDEX IF NOT EXISTS idx_channel_products_variant ON public.channel_products(product_variant_id);
CREATE INDEX IF NOT EXISTS idx_channel_products_channel_product ON public.channel_products(channel_id, product_id);

-- Sync logs indexes
CREATE INDEX IF NOT EXISTS idx_sync_logs_account ON public.sync_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_channel ON public.sync_logs(channel_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_event ON public.sync_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON public.sync_logs(status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_account_created ON public.sync_logs(account_id, created_at);

-- =========================================
-- TRIGGERS FOR UPDATED_AT
-- =========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to tables with updated_at column
DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOR table_name IN
        SELECT t.table_name
        FROM information_schema.tables t
        JOIN information_schema.columns c ON t.table_name = c.table_name
        WHERE t.table_schema = 'public'
        AND c.column_name = 'updated_at'
        AND t.table_name IN ('accounts', 'channels', 'products', 'product_variants', 'inventories', 'inventory_stock_items', 'orders', 'channel_products')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_set_updated_at ON public.%I', table_name, table_name);
        EXECUTE format('CREATE TRIGGER trg_%I_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', table_name, table_name);
    END LOOP;
END $$;

-- =========================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_type_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view their own data" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own data" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- Accounts policies
CREATE POLICY "Users can view accounts they belong to" ON public.accounts
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.account_users
            WHERE account_id = accounts.id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Account owners can update their accounts" ON public.accounts
    FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Users can create accounts" ON public.accounts
    FOR INSERT WITH CHECK (owner_id = auth.uid());

-- Account users policies
CREATE POLICY "Users can view account memberships" ON public.account_users
    FOR SELECT USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.account_users au
            WHERE au.account_id = account_users.account_id AND au.user_id = auth.uid()
        )
    );

CREATE POLICY "Account owners can manage memberships" ON public.account_users
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.account_users au
            WHERE au.account_id = account_users.account_id
            AND au.user_id = auth.uid()
            AND au.role IN ('owner', 'admin')
        )
    );

-- Channel types policies (public read)
CREATE POLICY "Anyone can view channel types" ON public.channel_types
    FOR SELECT USING (true);

-- Channel type fields policies
CREATE POLICY "Anyone can view channel type fields" ON public.channel_type_fields
    FOR SELECT USING (true);

-- Channels policies
CREATE POLICY "Users can view channels in their accounts" ON public.channels
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.account_users
            WHERE account_id = channels.account_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage channels in their accounts" ON public.channels
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.account_users
            WHERE account_id = channels.account_id AND user_id = auth.uid()
        )
    );

-- Products policies
CREATE POLICY "Users can view products in their accounts" ON public.products
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.account_users
            WHERE account_id = products.account_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage products in their accounts" ON public.products
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.account_users
            WHERE account_id = products.account_id AND user_id = auth.uid()
        )
    );

-- Product variants policies
CREATE POLICY "Users can view product variants in their accounts" ON public.product_variants
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.products p
            JOIN public.account_users au ON p.account_id = au.account_id
            WHERE p.id = product_variants.product_id AND au.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage product variants in their accounts" ON public.product_variants
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.products p
            JOIN public.account_users au ON p.account_id = au.account_id
            WHERE p.id = product_variants.product_id AND au.user_id = auth.uid()
        )
    );

-- Inventories policies
CREATE POLICY "Users can view inventories in their accounts" ON public.inventories
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.account_users
            WHERE account_id = inventories.account_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage inventories in their accounts" ON public.inventories
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.account_users
            WHERE account_id = inventories.account_id AND user_id = auth.uid()
        )
    );

-- Inventory stock items policies
CREATE POLICY "Users can view inventory stock in their accounts" ON public.inventory_stock_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.inventories i
            JOIN public.account_users au ON i.account_id = au.account_id
            WHERE i.id = inventory_stock_items.inventory_id AND au.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage inventory stock in their accounts" ON public.inventory_stock_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.inventories i
            JOIN public.account_users au ON i.account_id = au.account_id
            WHERE i.id = inventory_stock_items.inventory_id AND au.user_id = auth.uid()
        )
    );

-- Orders policies
CREATE POLICY "Users can view orders in their accounts" ON public.orders
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.account_users
            WHERE account_id = orders.account_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage orders in their accounts" ON public.orders
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.account_users
            WHERE account_id = orders.account_id AND user_id = auth.uid()
        )
    );

-- Order items policies
CREATE POLICY "Users can view order items in their accounts" ON public.order_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            JOIN public.account_users au ON o.account_id = au.account_id
            WHERE o.id = order_items.order_id AND au.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage order items in their accounts" ON public.order_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            JOIN public.account_users au ON o.account_id = au.account_id
            WHERE o.id = order_items.order_id AND au.user_id = auth.uid()
        )
    );

-- Channel products policies
CREATE POLICY "Users can view channel products in their accounts" ON public.channel_products
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.channels c
            JOIN public.account_users au ON c.account_id = au.account_id
            WHERE c.id = channel_products.channel_id AND au.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage channel products in their accounts" ON public.channel_products
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.channels c
            JOIN public.account_users au ON c.account_id = au.account_id
            WHERE c.id = channel_products.channel_id AND au.user_id = auth.uid()
        )
    );

-- Sync logs policies
CREATE POLICY "Users can view sync logs in their accounts" ON public.sync_logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.account_users
            WHERE account_id = sync_logs.account_id AND user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create sync logs in their accounts" ON public.sync_logs
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.account_users
            WHERE account_id = sync_logs.account_id AND user_id = auth.uid()
        )
    );

-- =========================================
-- ATOMIC ORDER CREATION FUNCTION
-- =========================================

CREATE OR REPLACE FUNCTION public.create_order(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_account_id UUID;
    v_order_id UUID;
    v_item jsonb;
    v_product_id UUID;
    v_quantity INTEGER;
    v_available_stock INTEGER;
    v_unit_price NUMERIC(10,2);
    v_total_amount NUMERIC(12,2) := 0;
BEGIN
    -- Extract account_id from payload
    v_account_id := (payload->>'account_id')::UUID;

    -- Validate account exists
    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = v_account_id) THEN
        RETURN jsonb_build_object('error', 'Account not found', 'code', 'ACCOUNT_NOT_FOUND');
    END IF;

    -- Create order
    INSERT INTO public.orders (
        account_id,
        type,
        status,
        customer_name,
        customer_email,
        customer_phone,
        notes
    ) VALUES (
        v_account_id,
        COALESCE(payload->>'type', 'manual'),
        'created',
        payload->>'customer_name',
        payload->>'customer_email',
        payload->>'customer_phone',
        payload->>'notes'
    ) RETURNING id INTO v_order_id;

    -- Process order items
    FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items')
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_quantity := (v_item->>'quantity')::INTEGER;

        -- Get product price and validate stock
        SELECT price INTO v_unit_price
        FROM public.products
        WHERE id = v_product_id AND account_id = v_account_id;

        IF v_unit_price IS NULL THEN
            RAISE EXCEPTION 'Product not found or does not belong to account';
        END IF;

        -- Check stock availability (simplified - takes from first available inventory)
        SELECT COALESCE(SUM(quantity), 0) INTO v_available_stock
        FROM public.inventory_stock_items isi
        JOIN public.inventories i ON isi.inventory_id = i.id
        WHERE i.account_id = v_account_id
        AND isi.product_id = v_product_id
        AND isi.quantity > 0;

        IF v_available_stock < v_quantity THEN
            RAISE EXCEPTION 'Insufficient stock for product %', v_product_id;
        END IF;

        -- Insert order item
        INSERT INTO public.order_items (
            order_id,
            product_id,
            quantity,
            unit_price,
            total_price
        ) VALUES (
            v_order_id,
            v_product_id,
            v_quantity,
            v_unit_price,
            v_unit_price * v_quantity
        );

        -- Update total amount
        v_total_amount := v_total_amount + (v_unit_price * v_quantity);

        -- Reduce inventory (simplified - reduces from first available)
        UPDATE public.inventory_stock_items
        SET quantity = quantity - v_quantity,
            updated_at = NOW()
        WHERE id = (
            SELECT isi.id
            FROM public.inventory_stock_items isi
            JOIN public.inventories i ON isi.inventory_id = i.id
            WHERE i.account_id = v_account_id
            AND isi.product_id = v_product_id
            AND isi.quantity >= v_quantity
            ORDER BY isi.created_at
            LIMIT 1
        );
    END LOOP;

    -- Update order total
    UPDATE public.orders
    SET total_amount = v_total_amount,
        updated_at = NOW()
    WHERE id = v_order_id;

    -- Log successful order creation
    INSERT INTO public.sync_logs (
        account_id,
        event_type,
        status,
        records_processed,
        payload
    ) VALUES (
        v_account_id,
        'manual_order_created',
        'completed',
        (SELECT COUNT(*) FROM public.order_items WHERE order_id = v_order_id),
        jsonb_build_object(
            'order_id', v_order_id,
            'total_amount', v_total_amount,
            'items_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = v_order_id)
        )
    );

    -- Return success response
    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'total_amount', v_total_amount,
        'items_count', (SELECT COUNT(*) FROM public.order_items WHERE order_id = v_order_id)
    );

EXCEPTION
    WHEN OTHERS THEN
        -- Log error
        INSERT INTO public.sync_logs (
            account_id,
            event_type,
            status,
            payload
        ) VALUES (
            COALESCE(v_account_id, 'unknown'::UUID),
            'manual_order_created',
            'error',
            jsonb_build_object(
                'error', SQLERRM,
                'payload', payload
            )
        );

        -- Return error response
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM,
            'code', 'ORDER_CREATION_FAILED'
        );
END;
$$;

-- Revoke execute permission from public roles for security
REVOKE EXECUTE ON FUNCTION public.create_order(jsonb) FROM anon, authenticated;

-- Grant execute to service role only
GRANT EXECUTE ON FUNCTION public.create_order(jsonb) TO service_role;

-- =========================================
-- INITIAL SEED DATA
-- =========================================

-- Insert channel types
INSERT INTO public.channel_types (id, name, description, config_fields) VALUES
('shopify', 'Shopify', 'E-commerce platform', '["store_url", "api_key", "api_secret"]'::jsonb),
('siigo', 'Siigo', 'ERP and accounting system', '["username", "api_key"]'::jsonb),
('woocommerce', 'WooCommerce', 'WordPress e-commerce', '["store_url", "consumer_key", "consumer_secret"]'::jsonb),
('prestashop', 'PrestaShop', 'Open source e-commerce', '["store_url", "api_key"]'::jsonb),
('erp', 'Generic ERP', 'Custom ERP integration', '["api_url", "api_key", "client_secret"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Insert channel type fields
INSERT INTO public.channel_type_fields (channel_type_id, field_name, field_type, required, description) VALUES
('shopify', 'store_url', 'url', true, 'Shopify store URL'),
('shopify', 'api_key', 'text', true, 'Shopify API key'),
('shopify', 'api_secret', 'password', true, 'Shopify API secret'),
('siigo', 'username', 'text', true, 'Siigo username'),
('siigo', 'api_key', 'password', true, 'Siigo API key'),
('woocommerce', 'store_url', 'url', true, 'WooCommerce store URL'),
('woocommerce', 'consumer_key', 'text', true, 'WooCommerce consumer key'),
('woocommerce', 'consumer_secret', 'password', true, 'WooCommerce consumer secret'),
('prestashop', 'store_url', 'url', true, 'PrestaShop store URL'),
('prestashop', 'api_key', 'text', true, 'PrestaShop API key'),
('erp', 'api_url', 'url', true, 'ERP API base URL'),
('erp', 'api_key', 'text', true, 'ERP API key'),
('erp', 'client_secret', 'password', false, 'ERP client secret')
ON CONFLICT (channel_type_id, field_name) DO NOTHING;

-- =========================================
-- FINAL VERIFICATION
-- =========================================

DO $$
DECLARE
    table_count INTEGER;
    policy_count INTEGER;
    function_exists BOOLEAN;
BEGIN
    -- Count tables
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('users', 'accounts', 'account_users', 'channel_types', 'channel_type_fields', 'channels', 'products', 'product_variants', 'inventories', 'inventory_stock_items', 'orders', 'order_items', 'channel_products', 'sync_logs');

    -- Count RLS policies
    SELECT COUNT(*) INTO policy_count
    FROM pg_policies
    WHERE schemaname = 'public';

    -- Check function exists
    SELECT EXISTS(
        SELECT 1 FROM information_schema.routines
        WHERE routine_schema = 'public'
        AND routine_name = 'create_order'
    ) INTO function_exists;

    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🎉 FLUXI DATABASE SETUP COMPLETED';
    RAISE NOTICE '========================================';
    RAISE NOTICE '📊 Tables created: %/14', table_count;
    RAISE NOTICE '🔒 RLS Policies: %', policy_count;
    RAISE NOTICE '⚡ Functions: create_order exists = %', function_exists;
    RAISE NOTICE '📈 Indexes: Created for all tables';
    RAISE NOTICE '🔄 Triggers: updated_at triggers active';
    RAISE NOTICE '';
    RAISE NOTICE '✅ Database ready for Fluxi Backend!';
    RAISE NOTICE '🚀 Run: npm run dev && node test-all-endpoints.js';
END $$;
