import { supabase } from "../supabaseClient";

export interface ShopRecord {
  id: string;
  shop_domain: string;
  access_token: string;
  scope?: string;
  installed_at: string;
  last_sync?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get a shop record by domain from Supabase
 */
export async function getShopByDomain(shopDomain: string): Promise<ShopRecord | null> {
  const { data, error } = await supabase
    .from("shops")
    .select("*")
    .eq("shop_domain", shopDomain)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null;
    }
    throw new Error(`Error fetching shop: ${error.message}`);
  }

  return data;
}

/**
 * Create or update a shop record in Supabase
 */
export async function upsertShop(params: {
  shopDomain: string;
  accessToken: string;
  scope?: string;
}): Promise<void> {
  const { shopDomain, accessToken, scope } = params;

  const { error } = await supabase
    .from("shops")
    .upsert(
      {
        shop_domain: shopDomain,
        access_token: accessToken,
        scope,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "shop_domain",
      }
    );

  if (error) {
    throw new Error(`Error upserting shop: ${error.message}`);
  }
}

/**
 * Generic function to make requests to Shopify API
 */
export async function shopifyRequest<T>(
  shopDomain: string,
  accessToken: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  data?: any
): Promise<T> {
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2025-01';
  const baseUrl = `https://${shopDomain}/admin/api/${apiVersion}`;
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json',
  };

  const config: RequestInit = {
    method,
    headers,
  };

  if (data && (method === 'POST' || method === 'PUT')) {
    config.body = JSON.stringify(data);
  }

  const response = await fetch(url, config);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Shopify API error ${response.status}: ${response.statusText}. ${errorText}`
    );
  }

  // For DELETE requests, there might be no body
  if (method === 'DELETE' && response.status === 200) {
    return {} as T;
  }

  return response.json();
}

/**
 * Update the last_sync timestamp for a shop
 */
export async function updateShopLastSync(shopDomain: string): Promise<void> {
  const { error } = await supabase
    .from("shops")
    .update({
      last_sync: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("shop_domain", shopDomain);

  if (error) {
    throw new Error(`Error updating shop last_sync: ${error.message}`);
  }
}