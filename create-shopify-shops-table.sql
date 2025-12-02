-- Create shopify_shops table for storing Shopify OAuth tokens
create table if not exists shopify_shops (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null unique,        -- "enohfit.myshopify.com"
  access_token text not null,              -- token de Shopify
  scopes text not null,                    -- scopes devueltos por Shopify
  status text not null default 'active',   -- active | uninstalled
  created_at timestamptz default now()
);