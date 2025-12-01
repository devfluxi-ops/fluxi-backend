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
  app.get("/channels", async (req: FastifyRequest<{ Querystring: { account_id: string } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { account_id } = req.query;

      if (!account_id) {
        return reply.status(400).send({
          success: false,
          error: "account_id is required"
        });
      }

      // Validate account belongs to user
      await validateAccountAccess(user, account_id);

      const { data, error } = await supabase
        .from("channels")
        .select("*")
        .eq("account_id", account_id)
        .order("created_at", { ascending: false });

      if (error) {
        return reply.status(400).send({ success: false, error: error.message });
      }

      // Transform response to use channel_type_id
      const channels = (data || []).map(channel => {
        const { type, ...rest } = channel;
        return {
          ...rest,
          channel_type_id: type
        };
      });

      return reply.send({ success: true, channels });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
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

        // Normalize Siigo products to frontend format
        products = siigoData.results?.map((p: any) => ({
          id: p.id,
          external_id: p.id,
          name: p.name,
          sku: p.code,
          description: p.description || '',
          price: p.prices?.[0]?.price_list?.[0]?.value || 0,
          currency: p.prices?.[0]?.currency_code || 'COP',
          stock: p.available_quantity || 0,
          status: p.active ? 'active' : 'inactive',
          source: 'siigo',
          warehouses: p.warehouses || []
        })) || [];

        return reply.send({
          success: true,
          products,
          total: siigoData.pagination?.total_results || products.length,
          page: siigoData.pagination?.page || 1,
          limit
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