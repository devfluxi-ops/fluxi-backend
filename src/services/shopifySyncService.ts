// src/services/shopifySyncService.ts
import { supabase } from "../supabaseClient";
import { getShopByDomain, shopifyRequest } from "./shopifyService";

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  image?: { src: string | null } | null;
  images?: { src: string | null }[];
  variants: ShopifyVariant[];
}

interface ShopifyVariant {
  id: number;
  sku: string | null;
  price: string;
  inventory_item_id: number;
}

interface ShopifyInventoryLevel {
  inventory_item_id: number;
  location_id: number;
  available: number | null;
}

export async function ensureShopifyChannel(accountId: string, shopDomain: string) {
  // Ajusta los campos a tu tabla `channels`
  const { data: existing, error } = await supabase
    .from("channels")
    .select("*")
    .eq("account_id", accountId)
    .eq("external_id", shopDomain)
    .eq("type", "shopify")
    .maybeSingle();

  if (error) {
    console.error("[ensureShopifyChannel] error select", error);
    throw error;
  }

  if (existing) return existing;

  const { data, error: insertError } = await supabase
    .from("channels")
    .insert({
      account_id: accountId,
      name: `Shopify - ${shopDomain}`,
      type: "shopify",
      external_id: shopDomain,
      status: "connected",
      connected_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (insertError) {
    console.error("[ensureShopifyChannel] error insert", insertError);
    throw insertError;
  }

  return data;
}

/**
 * Sincroniza productos desde Shopify y los guarda en:
 * - products
 * - product_variants
 * - channel_products
 */
export async function syncShopifyProducts(params: {
  accountId: string;
  shopDomain: string;
}) {
  const { accountId, shopDomain } = params;

  const shop = await getShopByDomain(shopDomain);
  if (!shop) {
    throw new Error(`Shop ${shopDomain} not found in DB`);
  }

  const channel = await ensureShopifyChannel(accountId, shopDomain);

  // 1. Obtener productos desde Shopify
  const data = await shopifyRequest<{ products: ShopifyProduct[] }>(
    shopDomain,
    shop.access_token,
    "GET",
    "/products.json?limit=250"
  );

  const products = data.products || [];
  if (!products.length) {
    return { imported: 0, products: [] };
  }

  // 2. Mapear y guardar productos + variantes
  const importedProducts: any[] = [];

  for (const p of products) {
    // 2.1. Product maestro en tabla `products`
    const { data: productRow, error: productError } = await supabase
      .from("products")
      .upsert(
        {
          account_id: accountId,
          name: p.title,
          description: p.body_html,
          sku: p.variants?.[0]?.sku || `shopify-${p.id}`,
          price: Number(p.variants?.[0]?.price || 0),
          currency: "COP",
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id,sku" }
      )
      .select("*")
      .single();

    if (productError) {
      console.error("[syncShopifyProducts] upsert product error", productError);
      continue;
    }

    // 2.2. Relación canal ↔ producto
    const { error: cpError } = await supabase.from("channel_products").upsert(
      {
        channel_id: channel.id,
        product_id: productRow.id,
        external_id: String(p.id),
        external_sku: p.variants?.[0]?.sku || `shopify-${p.id}`,
        synced_at: new Date().toISOString(),
        sync_status: "synced",
      },
      { onConflict: "channel_id,product_id" }
    );

    if (cpError) console.error("[syncShopifyProducts] upsert channel_products error", cpError);

    // 2.3. Variantes
    for (const v of p.variants) {
      const { error: variantError } = await supabase.from("product_variants").upsert(
        {
          product_id: productRow.id,
          internal_sku: v.sku || `variant-${v.id}`,
          price: Number(v.price),
          attributes: {},
          barcode: null,
          weight: null,
          dimensions: null,
        },
        { onConflict: "product_id,internal_sku" }
      );

      if (variantError) {
        console.error("[syncShopifyProducts] upsert variant error", variantError);
      }
    }

    importedProducts.push({
      id: productRow.id,
      name: productRow.name,
      sku: productRow.sku,
      price: productRow.price,
      external_id: String(p.id),
    });
  }

  // Actualizar last_sync en channel
  await supabase
    .from("channels")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", channel.id);

  return {
    imported: importedProducts.length,
    products: importedProducts,
  };
}

/**
 * Sincroniza inventario desde Shopify y actualiza stock
 */
export async function syncShopifyInventory(params: {
  accountId: string;
  shopDomain: string;
}) {
  const { accountId, shopDomain } = params;

  const shop = await getShopByDomain(shopDomain);
  if (!shop) throw new Error(`Shop ${shopDomain} not found`);

  const channel = await ensureShopifyChannel(accountId, shopDomain);

  const data = await shopifyRequest<{ inventory_levels: ShopifyInventoryLevel[] }>(
    shopDomain,
    shop.access_token,
    "GET",
    "/inventory_levels.json?limit=250"
  );

  const levels = data.inventory_levels || [];
  if (!levels.length) {
    return { updated: 0 };
  }

  let updatedCount = 0;

  for (const level of levels) {
    // Buscar producto por external_id en channel_products
    const { data: channelProduct, error: cpError } = await supabase
      .from("channel_products")
      .select("product_id")
      .eq("channel_id", channel.id)
      .eq("external_id", String(level.inventory_item_id))
      .maybeSingle();

    if (cpError || !channelProduct) continue;

    // Actualizar stock del producto
    const { error: stockError } = await supabase
      .from("products")
      .update({
        stock: level.available || 0,
        updated_at: new Date().toISOString()
      })
      .eq("id", channelProduct.product_id);

    if (!stockError) updatedCount++;
  }

  return {
    updated: updatedCount,
  };
}