// src/services/shopifyService.ts
import axios from "axios";
import { supabase } from "../supabaseClient";

export interface ShopRecord {
  id: string;
  shop_domain: string;
  access_token: string;
  scope: string | null;
}

/**
 * Obtiene una tienda Shopify desde la tabla `shops`
 */
export async function getShopByDomain(shopDomain: string): Promise<ShopRecord | null> {
  const { data, error } = await supabase
    .from("shops")
    .select("*")
    .eq("shop_domain", shopDomain)
    .single();

  if (error) {
    console.error("[getShopByDomain] error", error);
    return null;
  }

  return data as ShopRecord;
}

/**
 * Crea/actualiza tienda Shopify en la tabla `shops`
 */
export async function upsertShop(params: {
  shopDomain: string;
  accessToken: string;
  scope?: string;
}) {
  const { shopDomain, accessToken, scope } = params;

  const { error } = await supabase.from("shops").upsert(
    {
      shop_domain: shopDomain,
      access_token: accessToken,
      scope: scope || null,
      installed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop_domain" }
  );

  if (error) {
    console.error("[upsertShop] error", error);
    throw error;
  }
}

/**
 * Helper genérico para llamar a la API de Shopify Admin
 */
export async function shopifyRequest<T>(
  shopDomain: string,
  accessToken: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  data?: any
): Promise<T> {
  const version = process.env.SHOPIFY_API_VERSION || "2023-10";
  const url = `https://${shopDomain}/admin/api/${version}${path}`;

  try {
    const res = await axios.request<T>({
      url,
      method,
      data,
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });

    return res.data;
  } catch (err: any) {
    console.error("[shopifyRequest] error", method, path, err?.response?.data || err.message);
    throw err;
  }
}