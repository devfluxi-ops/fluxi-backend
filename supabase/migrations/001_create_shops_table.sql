-- Create shops table for storing Shopify store connections
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  shop_domain text unique not null,
  access_token text not null,
  scope text,
  installed_at timestamptz not null default now(),
  last_sync timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Create index for faster lookups by shop domain
create index if not exists shops_shop_domain_idx on public.shops (shop_domain);

-- Enable RLS (Row Level Security)
alter table public.shops enable row level security;

-- RLS Policy: Users can only access shops from their accounts
-- Note: This assumes we have account_id in the future, for now allow all
create policy "Allow all operations on shops" on public.shops for all using (true);