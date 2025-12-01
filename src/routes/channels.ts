import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { supabase } from "../supabaseClient";
import { getUserFromRequest, validateAccountAccess } from "../utils/auth";
import { sendSuccess, sendError, sendNotFound } from "../utils/responses";

export type ChannelStatus = 'connected' | 'disconnected' | 'error';
export type ChannelType = 'shopify' | 'siigo' | 'erp' | 'woocommerce' | 'prestashop';

export interface Channel {
  id: string;
  name: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  account_id: string;
  type: ChannelType;
  external_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  config: any;
  status: ChannelStatus;
  last_error: string | null;
}

interface ChannelInput {
  name?: string;
  description?: string;
  channel_type_id?: ChannelType;
  external_id?: string;
  config?: Record<string, any>;
}

export async function channelsRoutes(app: FastifyInstance) {
  // GET /channel-types - List available channel types
  app.get("/channel-types", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      // This endpoint doesn't require authentication as it just lists available types
      const { data, error } = await supabase
        .from("channel_types")
        .select("*")
        .order("name");

      if (error) {
        return reply.status(400).send({ success: false, error: error.message });
      }

      return reply.send({ success: true, channel_types: data || [] });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // GET /channels - List channels for account
  app.get('/channels', async (request, reply) => {
    const { account_id } = request.query as any;

    if (!account_id) {
      return reply.status(400).send({
        success: false,
        message: 'account_id is required'
      });
    }

    const { data, error } = await supabase
      .from('channels')
      .select(`
        id,
        account_id,
        name,
        status,
        channel_type_id,
        channel_types(name)
      `)
      .eq('account_id', account_id)
      .order('created_at', { ascending: false });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({
        success: false,
        message: 'Error fetching channels',
        error: error.message
      });
    }

    const channels = (data ?? []).map(c => ({
      id: c.id,
      account_id: c.account_id,
      name: c.name,
      status: c.status,
      channel_type_id: c.channel_type_id,
      channel_type_name: c.channel_types?.[0]?.name ?? null
    }));

    return reply.send({
      success: true,
      channels,
      total: channels.length
    });
  });

  // POST /channels/:channelId/sync - Sync products from Siigo into staging (paginated)
  app.post("/channels/:channelId/sync", async (req: FastifyRequest<{ Params: { channelId: string }, Body: { account_id?: string } }>, reply: FastifyReply) => {
    try {
      const { channelId } = req.params;
      const { account_id } = req.body || {};

      const { data: channel, error: channelError } = await supabase
        .from("channels")
        .select("id, account_id, name, channel_type_id, config")
        .eq("id", channelId)
        .single();

      if (channelError || !channel) {
        return reply.status(404).send({ success: false, message: "Channel not found" });
      }

      if (account_id && channel.account_id !== account_id) {
        return reply.status(400).send({ success: false, message: "Channel does not belong to the provided account_id" });
      }

      if (channel.channel_type_id !== "siigo") {
        return reply.status(400).send({ success: false, message: "Only Siigo channels are supported for sync" });
      }

      const { username, api_key, partner_id } = channel.config || {};
      const siigoPartnerId = partner_id || process.env.SIIGO_PARTNER_ID || "fluxiBackend";
      const siigoBaseUrl = process.env.SIIGO_API_BASE_URL || "https://api.siigo.com";

      if (!username || !api_key) {
        return reply.status(400).send({ success: false, message: "Siigo credentials not configured" });
      }

      // Authenticate with Siigo
      const authResponse = await fetch(`${siigoBaseUrl}/auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Partner-Id": siigoPartnerId
        },
        body: JSON.stringify({ username, access_key: api_key })
      });

      if (!authResponse.ok) {
        const errorText = await authResponse.text();

        await supabase.from("channels").update({
          status: "error",
          last_error: `Authentication failed: ${authResponse.status} ${errorText}`,
          updated_at: new Date().toISOString()
        }).eq("id", channelId);

        await supabase.from("sync_logs").insert([{
          account_id: channel.account_id,
          channel_id: channelId,
          event_type: "channel_product_sync",
          status: "error",
          payload: { error: "authentication_failed" }
        }]);

        return reply.status(502).send({ success: false, message: "Failed to authenticate with Siigo" });
      }

      const { access_token } = await authResponse.json();

      if (!access_token) {
        return reply.status(502).send({ success: false, message: "No access token received from Siigo" });
      }

      // Fetch all products with pagination
      const allSiigoProducts: any[] = [];
      const pageSize = 100;
      let page = 1; // Siigo pages are 1-based
      let totalResults = 0;
      let pageCountGuard = 0;

      do {
        const productsResponse = await fetch(`${siigoBaseUrl}/v1/products?page=${page}&page_size=${pageSize}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${access_token}`,
            "Content-Type": "application/json",
            "Partner-Id": siigoPartnerId
          }
        });

        if (!productsResponse.ok) {
          const errorText = await productsResponse.text();

          await supabase.from("channels").update({
            status: "error",
            last_error: `Products fetch failed: ${productsResponse.status} ${errorText}`,
            updated_at: new Date().toISOString()
          }).eq("id", channelId);

          await supabase.from("sync_logs").insert([{
            account_id: channel.account_id,
            channel_id: channelId,
            event_type: "channel_product_sync",
            status: "error",
            payload: { error: "products_fetch_failed" }
          }]);

          return reply.status(502).send({ success: false, message: "Failed to fetch products from Siigo" });
        }

        const productsData = await productsResponse.json();
        const results = productsData.results || [];
        totalResults = productsData.pagination?.total_results || totalResults;

        if (results.length > 0) {
          allSiigoProducts.push(...results);
        }

        page += 1;
        pageCountGuard += 1;
      } while (allSiigoProducts.length < totalResults && totalResults > 0 && pageCountGuard < 60);

      // Track existing staging entries to detect new vs updated
      const { data: existingStaging } = await supabase
        .from("channel_products_staging")
        .select("external_id")
        .eq("channel_id", channelId)
        .eq("account_id", channel.account_id);

      const existingExternalIds = new Set((existingStaging || []).map((row: any) => row.external_id));

      let newProducts = 0;
      let updatedProducts = 0;
      const errors: { sku?: string; error: string }[] = [];

      for (const sp of allSiigoProducts) {
        try {
          const price = sp?.prices?.[0]?.price_list?.[0]?.value != null
            ? Number(sp.prices[0].price_list[0].value)
            : 0;
          const currency = sp?.prices?.[0]?.price_list?.[0]?.currency_code || "COP";
          const status = sp?.active ? "active" : "inactive";

      const payload = {
        account_id: channel.account_id,
        channel_id: channel.id,
        external_id: sp.id,
        external_sku: sp.code,
            name: sp.name,
            description: sp.description || "",
            price,
            currency,
            stock: sp?.available_quantity || 0,
            status,
            raw_data: sp,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          const { error: stagingError } = await supabase
            .from("channel_products_staging")
            .upsert(payload, { onConflict: "channel_id,external_id" });

          if (stagingError) {
            throw new Error(stagingError.message);
          }

          if (existingExternalIds.has(sp.id)) {
            updatedProducts++;
          } else {
            newProducts++;
            existingExternalIds.add(sp.id);
          }
        } catch (productError: any) {
          errors.push({ sku: sp?.code, error: productError.message });
        }
      }

      await supabase.from("channels").update({
        status: errors.length ? "warning" : "connected",
        last_error: errors.length ? errors[0].error : null,
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("id", channelId);

      await supabase.from("sync_logs").insert([{
        account_id: channel.account_id,
        channel_id: channelId,
        event_type: "channel_product_sync",
        status: errors.length ? "warning" : "completed",
        records_processed: newProducts + updatedProducts,
        payload: {
          source: "siigo",
          new_products: newProducts,
          updated_products: updatedProducts,
          total_from_siigo: allSiigoProducts.length,
          errors: errors.slice(0, 10)
        }
      }]);

      return reply.send({
        success: true,
        new_products: newProducts,
        updated_products: updatedProducts,
        total_from_siigo: allSiigoProducts.length,
        errors: errors.length ? errors.slice(0, 10) : undefined,
        message: `${newProducts} nuevos, ${updatedProducts} actualizados de ${allSiigoProducts.length} productos`
      });
    } catch (error: any) {
      console.error("Error syncing channel products:", error);
      return reply.status(500).send({
        success: false,
        message: "Internal server error during sync",
        error: error.message
      });
    }
  });

  // POST /channels - Create new channel
  app.post("/channels", async (req: FastifyRequest<{ Body: ChannelInput & { account_id: string; channel_type_id: string } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { account_id, name, description, channel_type_id, external_id, config } = req.body;

      if (!account_id || !channel_type_id) {
        return reply.status(400).send({
          success: false,
          error: "account_id and channel_type_id are required"
        });
      }

      // Validate account exists
      const { data: accountCheck } = await supabase
        .from("accounts")
        .select("id")
        .eq("id", account_id)
        .single();

      if (!accountCheck) {
        return reply.status(400).send({
          success: false,
          error: "Invalid account_id: account does not exist"
        });
      }

      const validTypes: ChannelType[] = ['shopify', 'siigo', 'erp', 'woocommerce', 'prestashop'];
      if (!validTypes.includes(channel_type_id as ChannelType)) {
        return reply.status(400).send({
          success: false,
          error: `Invalid channel_type_id. Must be one of: ${validTypes.join(', ')}`
        });
      }

      // Process config based on channel type
      let processedConfig = config || {};
      let hasCredentials = false;

      if (channel_type_id === 'siigo') {
        // For Siigo, validate username and api_key in config
        const username = config?.username || config?.email;
        const apiKey = config?.api_key;

        if (!username || !apiKey) {
          return reply.status(400).send({
            success: false,
            error: "Siigo channels require username and api_key in config"
          });
        }

        // Partner-Id is managed by backend from environment
        const partnerId = process.env.SIIGO_PARTNER_ID || 'fluxiBackend';

        processedConfig = {
          ...config,
          username: username,
          api_key: apiKey,
          configured_at: new Date().toISOString()
        };
        hasCredentials = true;
      } else if (channel_type_id === 'shopify') {
        // For Shopify, validate store_url and access_token
        if (config?.store_url && config?.access_token) {
          processedConfig = {
            ...config,
            configured_at: new Date().toISOString()
          };
          hasCredentials = true;
        }
      } else {
        // For other types, check if any config is provided
        hasCredentials = Object.keys(config || {}).length > 0;
      }

      const { data, error } = await supabase
        .from("channels")
        .insert([{
          account_id,
          name,
          description,
          channel_type_id,
          external_id,
          config: processedConfig,
          status: hasCredentials ? 'connected' : 'disconnected'
        }])
        .select()
        .single();

      if (error) {
        return reply.status(400).send({ success: false, error: error.message });
      }

      return reply.send({ success: true, channel: data });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // GET /channels/:channelId/staging-products - List staged products before import
  app.get("/channels/:channelId/staging-products", async (req: FastifyRequest<{ Params: { channelId: string }, Querystring: { account_id?: string; status?: string; search?: string; page?: number; limit?: number } }>, reply: FastifyReply) => {
    try {
      const { channelId } = req.params;
      const { account_id, status, search, page = 0, limit = 50 } = req.query as any;

      if (!account_id) {
        return reply.status(400).send({ success: false, message: "account_id is required" });
      }

      const pageNumber = Number(page) || 0;
      const limitNumber = Math.min(Math.max(Number(limit) || 50, 1), 200);

      let stagingQuery = supabase
        .from("channel_products_staging")
        .select("*")
        .eq("channel_id", channelId)
        .eq("account_id", account_id);

      if (status) {
        stagingQuery = stagingQuery.eq("import_status", status);
      }

      if (search) {
        stagingQuery = stagingQuery.or(`name.ilike.%${search}%,external_sku.ilike.%${search}%`);
      }

      stagingQuery = stagingQuery
        .order("synced_at", { ascending: false })
        .range(pageNumber * limitNumber, pageNumber * limitNumber + limitNumber - 1);

      const { data: stagingProducts, error: stagingError } = await stagingQuery;

      if (stagingError) {
        return reply.status(500).send({ success: false, message: "Error fetching staging products", error: stagingError.message });
      }

      const externalSkus = (stagingProducts || []).map((p) => p.external_sku).filter(Boolean);

      let inventoryMap = new Map<string, any>();
      if (externalSkus.length > 0) {
        const { data: inventoryProducts, error: inventoryError } = await supabase
          .from("products")
          .select("id, sku, price, status")
          .eq("account_id", account_id)
          .in("sku", externalSkus);

        if (inventoryError) {
          return reply.status(500).send({ success: false, message: "Error checking existing inventory", error: inventoryError.message });
        }

        inventoryMap = new Map((inventoryProducts || []).map((p) => [p.sku, p]));
      }

      const enriched = (stagingProducts || []).map((p) => {
        const existing = inventoryMap.get(p.external_sku);
        return {
          ...p,
          exists_in_inventory: !!existing,
          existing_product_id: existing?.id ?? null,
          inventory_price: existing?.price ?? null,
          inventory_stock: (existing as any)?.stock ?? null
        };
      });

      const [pendingCountRes, importedCountRes, totalCountRes] = await Promise.all([
        supabase.from("channel_products_staging").select("*", { count: "exact", head: true }).eq("channel_id", channelId).eq("account_id", account_id).eq("import_status", "pending"),
        supabase.from("channel_products_staging").select("*", { count: "exact", head: true }).eq("channel_id", channelId).eq("account_id", account_id).eq("import_status", "imported"),
        supabase.from("channel_products_staging").select("*", { count: "exact", head: true }).eq("channel_id", channelId).eq("account_id", account_id)
      ]);

      return reply.send({
        success: true,
        products: enriched,
        counts: {
          pending_count: pendingCountRes.count ?? 0,
          imported_count: importedCountRes.count ?? 0,
          total_count: totalCountRes.count ?? 0
        },
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total: totalCountRes.count ?? 0
        }
      });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: "Internal server error", error: error.message });
    }
  });

  // POST /channels/:channelId/import-to-inventory - Import staged products into main catalog
  app.post("/channels/:channelId/import-to-inventory", async (req: FastifyRequest<{ Params: { channelId: string }, Body: { account_id: string; staging_product_ids?: string[]; import_all?: boolean } }>, reply: FastifyReply) => {
    try {
      const { channelId } = req.params;
      const { account_id, staging_product_ids = [], import_all = false } = req.body;

      if (!account_id) {
        return reply.status(400).send({ success: false, message: "account_id is required" });
      }

      let stagingProducts: any[] = [];

      if (import_all) {
        const { data, error } = await supabase
          .from("channel_products_staging")
          .select("*")
          .eq("channel_id", channelId)
          .eq("account_id", account_id)
          .eq("import_status", "pending");

        if (error) {
          return reply.status(500).send({ success: false, message: "Error fetching staging products", error: error.message });
        }

        stagingProducts = data || [];
      } else {
        if (!Array.isArray(staging_product_ids) || staging_product_ids.length === 0) {
          return reply.status(400).send({ success: false, message: "staging_product_ids is required when import_all is false" });
        }

        const { data, error } = await supabase
          .from("channel_products_staging")
          .select("*")
          .in("id", staging_product_ids)
          .eq("channel_id", channelId)
          .eq("account_id", account_id);

        if (error) {
          return reply.status(500).send({ success: false, message: "Error fetching selected staging products", error: error.message });
        }

        stagingProducts = data || [];
      }

      let importedCount = 0;
      const errors: { sku?: string; error: string }[] = [];

      for (const staging of stagingProducts) {
        try {
          const { data: product, error: productError } = await supabase
            .from("products")
            .upsert({
              account_id,
              name: staging.name,
              sku: staging.external_sku,
              description: staging.description,
              price: staging.price,
              stock: staging.stock,
              currency: staging.currency,
              status: staging.status,
              updated_at: new Date().toISOString()
            }, { onConflict: "account_id,sku" })
            .select("id")
            .single();

          if (productError || !product) {
            throw new Error(productError?.message || "Failed to upsert product");
          }

          const { error: channelProductError } = await supabase
            .from("channel_products")
            .upsert({
              product_id: product.id,
              channel_id: channelId,
              external_id: staging.external_id,
              external_sku: staging.external_sku,
              synced_at: new Date().toISOString(),
              sync_status: "synced",
              last_error: null
            }, { onConflict: "product_id,channel_id" });

          if (channelProductError) {
            throw new Error(channelProductError.message);
          }

          const { error: updateStagingError } = await supabase
            .from("channel_products_staging")
            .update({
              import_status: "imported",
              imported_at: new Date().toISOString(),
              imported_product_id: product.id,
              updated_at: new Date().toISOString()
            })
            .eq("id", staging.id);

          if (updateStagingError) {
            throw new Error(updateStagingError.message);
          }

          importedCount++;
        } catch (productError: any) {
          errors.push({ sku: staging?.external_sku, error: productError.message });

          await supabase
            .from("channel_products_staging")
            .update({ import_status: "error", updated_at: new Date().toISOString() })
            .eq("id", staging.id);
        }
      }

      return reply.send({
        success: true,
        imported_count: importedCount,
        skipped_count: 0,
        errors: errors.length ? errors : undefined,
        message: `${importedCount} productos importados al inventario principal`
      });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: "Internal server error during import", error: error.message });
    }
  });

  // DELETE /channels/:channelId/staging-products - Remove staged products
  app.delete("/channels/:channelId/staging-products", async (req: FastifyRequest<{ Params: { channelId: string }, Body: { account_id: string; staging_product_ids?: string[]; delete_all_skipped?: boolean } }>, reply: FastifyReply) => {
    try {
      const { channelId } = req.params;
      const { account_id, staging_product_ids = [], delete_all_skipped = false } = req.body;

      if (!account_id) {
        return reply.status(400).send({ success: false, message: "account_id is required" });
      }

      let deleteQuery = supabase
        .from("channel_products_staging")
        .delete()
        .eq("channel_id", channelId)
        .eq("account_id", account_id);

      if (delete_all_skipped) {
        deleteQuery = deleteQuery.eq("import_status", "skipped");
      } else {
        if (!Array.isArray(staging_product_ids) || staging_product_ids.length === 0) {
          return reply.status(400).send({ success: false, message: "staging_product_ids is required when delete_all_skipped is false" });
        }
        deleteQuery = deleteQuery.in("id", staging_product_ids);
      }

      const { error } = await deleteQuery;

      if (error) {
        return reply.status(500).send({ success: false, message: "Error deleting staging products", error: error.message });
      }

      return reply.send({ success: true, message: "Productos eliminados del staging" });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: "Internal server error during delete", error: error.message });
    }
  });

  // PUT /channels/:channelId/staging-products/:id/skip - Mark staged product as skipped
  app.put("/channels/:channelId/staging-products/:id/skip", async (req: FastifyRequest<{ Params: { channelId: string; id: string } }>, reply: FastifyReply) => {
    try {
      const { channelId, id } = req.params;

      const { error } = await supabase
        .from("channel_products_staging")
        .update({ import_status: "skipped", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("channel_id", channelId);

      if (error) {
        return reply.status(500).send({ success: false, message: "Error marking staging product as skipped", error: error.message });
      }

      return reply.send({ success: true, message: "Producto marcado como omitido" });
    } catch (error: any) {
      return reply.status(500).send({ success: false, message: "Internal server error", error: error.message });
    }
  });

  // PUT /channels/:id - Update channel
  app.put("/channels/:id", async (req: FastifyRequest<{ Params: { id: string }, Body: Partial<ChannelInput & { config?: any }> }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { id } = req.params;
      const updates = req.body;

      // Validate channel_type_id if provided
      if (updates.channel_type_id) {
        const validTypes: ChannelType[] = ['shopify', 'siigo', 'erp', 'woocommerce', 'prestashop'];
        if (!validTypes.includes(updates.channel_type_id)) {
          return reply.status(400).send({
            success: false,
            error: `Invalid channel_type_id. Must be one of: ${validTypes.join(', ')}`
          });
        
          // GET /channels/:id/products - List products from a specific channel
          app.get("/channels/:id/products", async (req: FastifyRequest<{ Params: { id: string }, Querystring: { limit?: number; offset?: number } }>, reply: FastifyReply) => {
            try {
              getUserFromRequest(req);
        
              const { id } = req.params;
              const { limit = 50, offset = 0 } = req.query;
        
              // Get channel details
              const { data: channel, error: channelError } = await supabase
                .from("channels")
                .select("*")
                .eq("id", id)
                .single();
        
              if (channelError || !channel) {
                return reply.status(404).send({ success: false, error: "Channel not found" });
              }
        
              // For now, return mock data based on channel type
              // In a real implementation, this would call the external API
              let products: any[] = [];
        
              if (channel.channel_type_id === 'siigo') {
                // Mock Siigo products
                products = [
                  {
                    id: "siigo-001",
                    name: "Producto Siigo 1",
                    sku: "SKU001",
                    price: 10000,
                    description: "Producto de ejemplo de Siigo",
                    external_id: "siigo-001"
                  },
                  {
                    id: "siigo-002",
                    name: "Producto Siigo 2",
                    sku: "SKU002",
                    price: 20000,
                    description: "Otro producto de Siigo",
                    external_id: "siigo-002"
                  }
                ];
              } else if (channel.channel_type_id === 'shopify') {
                // Mock Shopify products
                products = [
                  {
                    id: "shopify-001",
                    name: "Producto Shopify 1",
                    sku: "SHOP001",
                    price: 15000,
                    description: "Producto de Shopify",
                    external_id: "shopify-001"
                  }
                ];
              }
        
              return reply.send({
                success: true,
                products,
                total: products.length,
                limit,
                offset
              });
            } catch (error: any) {
              return reply.status(401).send({ success: false, error: error.message });
            }
          });
        
          // POST /channels/:id/import-products - Import products from channel to catalog
          app.post("/channels/:id/import-products", async (req: FastifyRequest<{ Params: { id: string }, Body: { product_ids: string[] } }>, reply: FastifyReply) => {
            try {
              getUserFromRequest(req);
        
              const { id } = req.params;
              const { product_ids } = req.body;
        
              if (!product_ids || !Array.isArray(product_ids)) {
                return reply.status(400).send({
                  success: false,
                  error: "product_ids array is required"
                });
              }
        
              // Get channel details
              const { data: channel, error: channelError } = await supabase
                .from("channels")
                .select("*")
                .eq("id", id)
                .single();
        
              if (channelError || !channel) {
                return reply.status(404).send({ success: false, error: "Channel not found" });
              }
        
              // Mock import process
              const importedProducts = product_ids.map(productId => ({
                id: `imported-${productId}`,
                channel_id: id,
                external_product_id: productId,
                status: "imported"
              }));
        
              return reply.send({
                success: true,
                message: `Imported ${product_ids.length} products`,
                imported_products: importedProducts
              });
            } catch (error: any) {
              return reply.status(401).send({ success: false, error: error.message });
            }
          });
        
          // POST /channels/share-products - Share products between channels
          app.post("/channels/share-products", async (req: FastifyRequest<{ Body: { product_ids: string[]; target_channel_ids: string[] } }>, reply: FastifyReply) => {
            try {
              getUserFromRequest(req);
        
              const { product_ids, target_channel_ids } = req.body;
        
              if (!product_ids || !Array.isArray(product_ids)) {
                return reply.status(400).send({
                  success: false,
                  error: "product_ids array is required"
                });
              }
        
              if (!target_channel_ids || !Array.isArray(target_channel_ids)) {
                return reply.status(400).send({
                  success: false,
                  error: "target_channel_ids array is required"
                });
              }
        
              // Mock sharing process
              const sharedProducts = [];
              for (const productId of product_ids) {
                for (const targetChannelId of target_channel_ids) {
                  sharedProducts.push({
                    product_id: productId,
                    target_channel_id: targetChannelId,
                    status: "shared"
                  });
                }
              }
        
              return reply.send({
                success: true,
                message: `Shared ${product_ids.length} products to ${target_channel_ids.length} channels`,
                shared_products: sharedProducts
              });
            } catch (error: any) {
              return reply.status(401).send({ success: false, error: error.message });
            }
          });
        }
      }

      // Process config updates
      let processedUpdates: any = { ...updates };
      if (updates.config) {
        processedUpdates.config = updates.config;
        // Update configured_at if config is being updated
        processedUpdates.config = {
          ...updates.config,
          configured_at: new Date().toISOString()
        };
      }

      // Remove fields that don't exist in the table
      delete processedUpdates.access_token;
      delete processedUpdates.refresh_token;
      delete processedUpdates.token_expires_at;

      const { data, error } = await supabase
        .from("channels")
        .update({
          ...processedUpdates,
          updated_at: new Date().toISOString()
        })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return reply.status(400).send({ success: false, error: error.message });
      }

      return reply.send({ success: true, channel: data });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // DELETE /channels/:id - Delete channel
  app.delete("/channels/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { id } = req.params;

      const { error } = await supabase
        .from("channels")
        .delete()
        .eq("id", id);

      if (error) {
        return reply.status(400).send({ success: false, error: error.message });
      }

      return reply.send({ success: true, message: "Channel deleted" });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // POST /channels/:id/test - Test channel connection
  app.post("/channels/:id/test", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { id } = req.params;

      // Get channel details
      const { data: channel, error: channelError } = await supabase
        .from("channels")
        .select("*")
        .eq("id", id)
        .single();

      if (channelError || !channel) {
        return reply.status(404).send({ success: false, error: "Channel not found" });
      }

      console.log('TEST CHANNEL from DB:', JSON.stringify(channel, null, 2));

      let testResult = { success: false, message: "Test not implemented for this channel type" };

      // Test based on channel type
      switch (channel.channel_type_id) {
        case 'shopify':
          testResult = await testShopifyConnection(channel);
          break;
        case 'siigo':
          testResult = await testSiigoConnection(channel);
          break;
        case 'erp':
          testResult = await testERPConnection(channel);
          break;
        default:
          testResult = { success: false, message: `Test not implemented for ${channel.channel_type_id || 'unknown'}` };
      }

      // Update channel status
      await supabase
        .from("channels")
        .update({
          status: testResult.success ? 'connected' : 'error',
          last_error: testResult.success ? null : testResult.message,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      return reply.send({
        success: true,
        channel_id: id,
        test_result: testResult
      });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // GET /channels/:id/products - List products from a specific channel
  app.get("/channels/:id/products", async (req: FastifyRequest<{ Params: { id: string }, Querystring: { limit?: number; offset?: number } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { id } = req.params;
      const { limit = 50, offset = 0 } = req.query;

      // Get channel details
      const { data: channel, error: channelError } = await supabase
        .from("channels")
        .select("*")
        .eq("id", id)
        .single();

      if (channelError || !channel) {
        return reply.status(404).send({ success: false, error: "Channel not found" });
      }

      let products: any[] = [];

      if (channel.channel_type_id === 'siigo') {
        // Fetch real products from Siigo API
        const { username, api_key } = channel.config;

        if (!username || !api_key) {
          return reply.status(400).send({ success: false, error: "Siigo credentials not configured" });
        }

        const SIIGO_BASE_URL = process.env.SIIGO_API_BASE_URL || "https://api.siigo.com";
        const SIIGO_PARTNER_ID = process.env.SIIGO_PARTNER_ID || "fluxiBackend";

        // Authenticate with Siigo
        const authResponse = await fetch(`${SIIGO_BASE_URL}/auth`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Partner-Id': SIIGO_PARTNER_ID,
          },
          body: JSON.stringify({
            username: username,
            access_key: api_key
          })
        });

        if (!authResponse.ok) {
          const errorText = await authResponse.text();
          return reply.status(400).send({
            success: false,
            error: `Siigo authentication failed: ${authResponse.status} ${errorText}`
          });
        }

        const authData = await authResponse.json();
        const accessToken = authData.access_token;

        if (!accessToken) {
          return reply.status(400).send({ success: false, error: "No access token received from Siigo" });
        }

        // Fetch products from Siigo
        const productsResponse = await fetch(`${SIIGO_BASE_URL}/v1/products?page_size=${limit}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Partner-Id': SIIGO_PARTNER_ID,
            'Content-Type': 'application/json'
          }
        });

        if (!productsResponse.ok) {
          const errorText = await productsResponse.text();
          return reply.status(400).send({
            success: false,
            error: `Siigo products API failed: ${productsResponse.status} ${errorText}`
          });
        }

        const siigoData = await productsResponse.json();

        // Store/update products in local database
        const syncedProducts = [];
        for (const siigoProduct of siigoData.results || []) {
          try {
            // Check if product already exists in our catalog
            const { data: existingChannelProduct } = await supabase
              .from("channel_products")
              .select("id, product_id")
              .eq("channel_id", id)
              .eq("external_id", siigoProduct.id)
              .single();

            let localProduct;

            if (existingChannelProduct) {
              // Get existing product
              const { data: existingProduct } = await supabase
                .from("products")
                .select("id, name, sku, price, description, status")
                .eq("id", existingChannelProduct.product_id)
                .single();

              if (existingProduct) {
                // Update existing product
                localProduct = existingProduct;
                await supabase
                  .from("products")
                  .update({
                    name: siigoProduct.name,
                    description: siigoProduct.description || '',
                    updated_at: new Date().toISOString()
                  })
                  .eq("id", localProduct.id);
              }
            } else {
              // Create new product
              const { data: newProduct, error: productError } = await supabase
                .from("products")
                .insert({
                  account_id: channel.account_id,
                  name: siigoProduct.name,
                  sku: siigoProduct.code,
                  price: siigoProduct.prices?.[0]?.price_list?.[0]?.value || 0,
                  description: siigoProduct.description || '',
                  status: siigoProduct.active ? 'active' : 'inactive'
                })
                .select()
                .single();

              if (productError) {
                console.error('Error creating product:', productError);
                continue;
              }

              localProduct = newProduct;

              // Create channel product link
              await supabase
                .from("channel_products")
                .insert({
                  channel_id: id,
                  product_id: localProduct.id,
                  external_id: siigoProduct.id,
                  last_sync_at: new Date().toISOString()
                });
            }

            // Add to response
            syncedProducts.push({
              id: localProduct.id,
              external_id: siigoProduct.id,
              name: localProduct.name,
              sku: localProduct.sku,
              description: localProduct.description || '',
              price: localProduct.price,
              currency: siigoProduct.prices?.[0]?.currency_code || 'COP',
              stock: siigoProduct.available_quantity || 0,
              status: localProduct.status,
              source: 'siigo',
              warehouses: siigoProduct.warehouses || [],
              last_sync_at: new Date().toISOString()
            });

          } catch (error) {
            console.error('Error syncing Siigo product:', siigoProduct.id, error);
            // Continue with next product
          }
        }

        return reply.send({
          success: true,
          products: syncedProducts,
          total: siigoData.pagination?.total_results || syncedProducts.length,
          page: siigoData.pagination?.page || 1,
          limit,
          synced_count: syncedProducts.length
        });

      } else if (channel.channel_type_id === 'shopify') {
        // Mock Shopify products (for now)
        products = [
          {
            id: "shopify-001",
            name: "Producto Shopify 1",
            sku: "SHOP001",
            price: 15000,
            description: "Producto de Shopify",
            external_id: "shopify-001"
          }
        ];
      } else {
        return reply.status(400).send({
          success: false,
          error: `Product fetching not implemented for channel type: ${channel.channel_type_id}`
        });
      }

      return reply.send({
        success: true,
        products,
        total: products.length,
        limit,
        offset
      });
    } catch (error: any) {
      console.error('Error fetching channel products:', error);
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // POST /channels/:id/import-products - Import products from channel to catalog
  app.post("/channels/:id/import-products", async (req: FastifyRequest<{ Params: { id: string }, Body: { product_ids: string[] } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { id } = req.params;
      const { product_ids } = req.body;

      if (!product_ids || !Array.isArray(product_ids)) {
        return reply.status(400).send({
          success: false,
          error: "product_ids array is required"
        });
      }

      // Get channel details
      const { data: channel, error: channelError } = await supabase
        .from("channels")
        .select("*")
        .eq("id", id)
        .single();

      if (channelError || !channel) {
        return reply.status(404).send({ success: false, error: "Channel not found" });
      }

      // Mock import process
      const importedProducts = product_ids.map(productId => ({
        id: `imported-${productId}`,
        channel_id: id,
        external_product_id: productId,
        status: "imported"
      }));

      return reply.send({
        success: true,
        message: `Imported ${product_ids.length} products`,
        imported_products: importedProducts
      });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // POST /channels/share-products - Share products between channels
  app.post("/channels/share-products", async (req: FastifyRequest<{ Body: { product_ids: string[]; target_channel_ids: string[] } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { product_ids, target_channel_ids } = req.body;

      if (!product_ids || !Array.isArray(product_ids)) {
        return reply.status(400).send({
          success: false,
          error: "product_ids array is required"
        });
      }

      if (!target_channel_ids || !Array.isArray(target_channel_ids)) {
        return reply.status(400).send({
          success: false,
          error: "target_channel_ids array is required"
        });
      }

      // Mock sharing process
      const sharedProducts = [];
      for (const productId of product_ids) {
        for (const targetChannelId of target_channel_ids) {
          sharedProducts.push({
            product_id: productId,
            target_channel_id: targetChannelId,
            status: "shared"
          });
        }
      }

      return reply.send({
        success: true,
        message: `Shared ${product_ids.length} products to ${target_channel_ids.length} channels`,
        shared_products: sharedProducts
      });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });
}

// Helper functions for testing connections
async function testShopifyConnection(channel: any) {
  try {
    // Basic Shopify API test
    const shopDomain = channel.config?.store_url || channel.external_id;
    const accessToken = channel.config?.access_token;

    if (!shopDomain || !accessToken) {
      return { success: false, message: "Missing shop domain or access token in config" };
    }

    // Test with Shopify Admin API
    const response = await fetch(`https://${shopDomain}/admin/api/2024-01/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      return { success: true, message: "Shopify connection successful" };
    } else {
      return { success: false, message: `Shopify API error: ${response.status}` };
    }
  } catch (error: any) {
    return { success: false, message: `Connection error: ${error.message}` };
  }
}

async function testERPConnection(channel: any) {
  try {
    if (channel.type === 'siigo') {
      return await testSiigoConnection(channel);
    }

    // Generic ERP test for other ERP types
    const apiUrl = process.env.ERP_API_BASE_URL;
    const clientId = process.env.ERP_CLIENT_ID;
    const clientSecret = process.env.ERP_CLIENT_SECRET;

    if (!apiUrl || !clientId || !clientSecret) {
      return { success: false, message: "ERP configuration missing" };
    }

    // This would be specific to the ERP API
    // For now, just check if we have the required config
    return { success: true, message: "ERP configuration valid" };
  } catch (error: any) {
    return { success: false, message: `ERP connection error: ${error.message}` };
  }
}

async function testSiigoConnection(channel: any) {
  const { username, api_key } = channel.config;

  if (!username || !api_key) {
    return { success: false, message: "ERP configuration missing" };
  }

  const SIIGO_BASE_URL = process.env.SIIGO_API_BASE_URL || "https://api.siigo.com";
  const SIIGO_PARTNER_ID = process.env.SIIGO_PARTNER_ID || "fluxiBackend";

  // Intentar URLs en orden de probabilidad
  const authUrls = [
    `${SIIGO_BASE_URL}/auth`,
    `${SIIGO_BASE_URL}/auth/token`,
    `${SIIGO_BASE_URL}/v1/auth`
  ];

  let lastError = null;

  for (const url of authUrls) {
    console.log("[SIIGO TEST] Trying URL:", url);
    console.log("[SIIGO TEST] Username:", username);
    console.log("[SIIGO TEST] Partner-Id:", SIIGO_PARTNER_ID);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Partner-Id": SIIGO_PARTNER_ID,
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        username: username,
        access_key: api_key
      }),
    });

    const raw = await response.text();

    console.log("[SIIGO TEST] Status:", response.status);
    console.log("[SIIGO TEST] Raw response:", raw);

    if (response.ok) {
      try {
        const json = JSON.parse(raw);
        return {
          success: true,
          message: "Siigo authentication success",
          token: json.access_token || null,
        };
      } catch (e) {
        return { success: false, message: "Invalid JSON auth response" };
      }
    }

    lastError = `Status ${response.status}: ${raw}`;
  }

  return {
    success: false,
    message: `Siigo authentication failed: ${lastError}`
  };
}
