import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { supabase } from "../supabaseClient";

function getUserFromRequest(req: FastifyRequest): any {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }
  const token = authHeader.replace("Bearer ", "");
  const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
  return decoded;
}

export async function shopifyRoutes(app: FastifyInstance) {
  // POST /channels/:channelId/shopify-sync - Sync Shopify products into staging
  app.post("/channels/:channelId/shopify-sync", async (req: FastifyRequest<{ Params: { channelId: string }, Body: { account_id: string } }>, reply: FastifyReply) => {
    try {
      const { channelId } = req.params;
      const { account_id } = req.body;

      if (!account_id) {
        return reply.status(400).send({ success: false, error: "account_id is required" });
      }

      // Fetch channel info
      const { data: channel, error: channelError } = await supabase
        .from("channels")
        .select("*")
        .eq("id", channelId)
        .single();

      if (channelError || !channel) {
        return reply.status(404).send({ success: false, error: "Channel not found" });
      }

      if (channel.account_id !== account_id) {
        return reply.status(400).send({ success: false, error: "Channel does not belong to the provided account_id" });
      }

      // Channel type check (supports both 'shopify' in type or channel_type_id)
      const channelType = channel.channel_type_id || channel.type;
      if (channelType !== "shopify") {
        return reply.status(400).send({ success: false, error: "Only Shopify channels are supported for this sync endpoint" });
      }

      const shopDomain = channel.external_id || channel.config?.shop_domain;
      const accessToken = channel.access_token || channel.config?.access_token;

      if (!shopDomain || !accessToken) {
        return reply.status(400).send({ success: false, error: "Shopify credentials missing (shop_domain or access_token)" });
      }

      const apiBase = `https://${shopDomain}/admin/api/2023-10`;
      const headers = {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken
      };

      // Fetch all products with cursor-based pagination
      let nextUrl: string | null = `${apiBase}/products.json?limit=250`;
      const allProducts: any[] = [];

      while (nextUrl) {
        const res: Response = await fetch(nextUrl, { headers });
        if (!res.ok) {
          const text = await res.text();
          return reply.status(502).send({
            success: false,
            error: `Shopify fetch failed: ${res.status}`,
            details: text
          });
        }

        const data = await res.json();
        allProducts.push(...(data.products || []));

        // Parse Link header for next page
        const linkHeader: string | null = res.headers.get("link");
        if (linkHeader && linkHeader.includes('rel="next"')) {
          const matches: string[] = linkHeader.split(",").map((s: string) => s.trim());
          const nextLink: string | undefined = matches.find((s: string) => s.endsWith('rel="next"'));
          if (nextLink) {
            const urlPart: string = nextLink.split(";")[0].replace(/<|>/g, "");
            nextUrl = urlPart;
          } else {
            nextUrl = null;
          }
        } else {
          nextUrl = null;
        }
      }

      // Upsert into staging
      let newProducts = 0;
      let updatedProducts = 0;
      const errors: { sku?: string; error: string }[] = [];

      for (const product of allProducts) {
        try {
          const firstVariant = product.variants?.[0] || {};
          const price = Number(firstVariant.price || 0);
          const currency = firstVariant.currency || product.currency || "USD";
          const stock = firstVariant.inventory_quantity ?? 0;
          const status = product.status || "active";

          const payload = {
            account_id,
            channel_id: channelId,
            external_id: product.id?.toString(),
            external_sku: firstVariant.sku || product.id?.toString(),
            name: product.title,
            description: product.body_html || "",
            price,
            currency,
            stock,
            status,
            raw_data: product,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          const { error: upsertError, data: upsertData } = await supabase
            .from("channel_products_staging")
            .upsert(payload, { onConflict: "channel_id,external_id" })
            .select("id");

          if (upsertError) {
            throw new Error(upsertError.message);
          }

          // Heuristic: if upsert returned existing id, count updated; otherwise new
          if (upsertData && upsertData.length === 1 && upsertData[0]) {
            updatedProducts++;
          } else {
            newProducts++;
          }
        } catch (err: any) {
          errors.push({ sku: product?.variants?.[0]?.sku, error: err.message });
        }
      }

      await supabase
        .from("channels")
        .update({
          status: errors.length ? "warning" : "connected",
          last_error: errors.length ? errors[0].error : null,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", channelId);

      await supabase
        .from("sync_logs")
        .insert([{
          account_id,
          channel_id: channelId,
          event_type: "shopify_product_sync",
          status: errors.length ? "warning" : "completed",
          payload: {
            source: "shopify",
            new_products: newProducts,
            updated_products: updatedProducts,
            total_from_shopify: allProducts.length,
            errors: errors.slice(0, 10)
          }
        }]);

      return reply.send({
        success: true,
        new_products: newProducts,
        updated_products: updatedProducts,
        total_from_shopify: allProducts.length,
        errors: errors.length ? errors.slice(0, 10) : undefined,
        message: `${newProducts} nuevos, ${updatedProducts} actualizados de ${allProducts.length} productos`
      });
    } catch (error: any) {
      console.error("Shopify sync error:", error);
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // GET /shopify/auth - Get Shopify OAuth URL
  app.get("/shopify/auth", async (req: FastifyRequest<{ Querystring: { account_id: string } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { account_id } = req.query;

      if (!account_id) {
        return reply.status(400).send({ success: false, error: "account_id is required" });
      }

      const shopifyClientId = process.env.SHOPIFY_CLIENT_ID;
      const scopes = process.env.SHOPIFY_SCOPES || "read_products,write_products,read_inventory,write_inventory,read_orders";
      const redirectUri = process.env.SHOPIFY_REDIRECT_URL;

      if (!shopifyClientId || !redirectUri) {
        return reply.status(500).send({ success: false, error: "Shopify configuration missing" });
      }

      // Generate nonce for security
      const nonce = crypto.randomBytes(16).toString('hex');

      // Store nonce temporarily (in production, use Redis/session)
      await supabase
        .from("sync_logs")
        .insert([{
          account_id,
          event_type: "shopify_oauth_start",
          status: "pending",
          payload: { nonce, account_id }
        }]);

      const authUrl = `https://shopify.com/admin/oauth/authorize?client_id=${shopifyClientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${nonce}`;

      return reply.send({
        success: true,
        auth_url: authUrl,
        nonce: nonce
      });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // GET /shopify/callback - OAuth callback
  app.get("/shopify/callback", async (req: FastifyRequest<{ Querystring: { code: string, shop: string, state: string } }>, reply: FastifyReply) => {
    try {
      const { code, shop, state: nonce } = req.query;

      if (!code || !shop || !nonce) {
        return reply.status(400).send({ success: false, error: "Missing required parameters" });
      }

      // Verify nonce (in production, check from Redis/session)
      const { data: nonceRecord } = await supabase
        .from("sync_logs")
        .select("*")
        .eq("event_type", "shopify_oauth_start")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!nonceRecord || nonceRecord.payload.nonce !== nonce) {
        return reply.status(400).send({ success: false, error: "Invalid state parameter" });
      }

      const accountId = nonceRecord.payload.account_id;

      // Exchange code for access token
      const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: process.env.SHOPIFY_CLIENT_ID,
          client_secret: process.env.SHOPIFY_CLIENT_SECRET,
          code: code
        })
      });

      if (!tokenResponse.ok) {
        throw new Error('Failed to exchange code for token');
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;

      // Store channel in database
      const { data: channel, error: channelError } = await supabase
        .from("channels")
        .insert([{
          account_id: accountId,
          name: `Shopify Store - ${shop}`,
          description: `Shopify store connected via OAuth`,
          type: 'shopify',
          external_id: shop,
          access_token: accessToken,
          config: { shop_domain: shop },
          status: 'connected'
        }])
        .select()
        .single();

      if (channelError) {
        throw new Error(channelError.message);
      }

      // Update nonce record
      await supabase
        .from("sync_logs")
        .update({
          status: "completed",
          payload: { ...nonceRecord.payload, channel_id: channel.id }
        })
        .eq("id", nonceRecord.id);

      // Redirect to frontend with success
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      return reply.redirect(`${frontendUrl}/integrations?success=true&channel=${channel.id}`);

    } catch (error: any) {
      console.error('Shopify OAuth error:', error);
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      return reply.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent(error.message)}`);
    }
  });


  // POST /shopify/webhooks - Receive Shopify webhooks
  app.post("/shopify/webhooks", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const hmac = req.headers['x-shopify-hmac-sha256'] as string;
      const topic = req.headers['x-shopify-topic'] as string;
      const shopDomain = req.headers['x-shopify-shop-domain'] as string;

      if (!hmac || !topic || !shopDomain) {
        return reply.status(400).send({ error: "Missing webhook headers" });
      }

      // Verify webhook authenticity
      const body = JSON.stringify(req.body);
      const secret = process.env.SHOPIFY_CLIENT_SECRET;
      const hash = crypto
        .createHmac('sha256', secret!)
        .update(body, 'utf8')
        .digest('base64');

      if (hash !== hmac) {
        return reply.status(401).send({ error: "Invalid webhook signature" });
      }

      // Find channel by shop domain
      const { data: channel } = await supabase
        .from("channels")
        .select("*")
        .eq("type", "shopify")
        .eq("external_id", shopDomain)
        .eq("status", "connected")
        .single();

      if (!channel) {
        return reply.status(404).send({ error: "Channel not found" });
      }

      // Process webhook based on topic
      switch (topic) {
        case 'orders/create':
          await processShopifyOrder(channel, req.body);
          break;
        case 'products/create':
        case 'products/update':
          await processShopifyProduct(channel, req.body);
          break;
        case 'inventory_levels/update':
          await processShopifyInventory(channel, req.body);
          break;
        default:
          console.log(`Unhandled webhook topic: ${topic}`);
      }

      // Log webhook
      await supabase
        .from("sync_logs")
        .insert([{
          account_id: channel.account_id,
          event_type: `shopify_webhook_${topic}`,
          status: "completed",
          payload: { topic, shop_domain: shopDomain, data: req.body }
        }]);

      return reply.status(200).send({ received: true });

    } catch (error: any) {
      console.error('Webhook processing error:', error);
      return reply.status(500).send({ error: "Webhook processing failed" });
    }
  });
}

// Helper functions for processing webhooks
async function processShopifyOrder(channel: any, orderData: any) {
  try {
    // Extract order information
    const order = {
      account_id: channel.account_id,
      external_id: orderData.id.toString(),
      type: 'shopify',
      status: 'completed',
      notes: `Shopify Order #${orderData.order_number}`,
      created_at: orderData.created_at
    };

    // Check if order already exists
    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("account_id", channel.account_id)
      .eq("external_id", order.external_id)
      .single();

    if (existingOrder) {
      console.log(`Order ${order.external_id} already exists`);
      return;
    }

    // Create order
    const { data: newOrder, error: orderError } = await supabase
      .from("orders")
      .insert([order])
      .select()
      .single();

    if (orderError) throw orderError;

    // Process line items
    for (const item of orderData.line_items) {
      const orderItem = {
        order_id: newOrder.id,
        product_id: item.product_id?.toString(),
        quantity: item.quantity,
        unit_price: Math.round(parseFloat(item.price) * 100), // Convert to cents
        external_product_id: item.product_id?.toString(),
        external_variant_id: item.variant_id?.toString()
      };

      await supabase
        .from("order_items")
        .insert([orderItem]);
    }

    console.log(`Processed Shopify order: ${orderData.order_number}`);

  } catch (error: any) {
    console.error('Error processing Shopify order:', error);
    throw error;
  }
}

async function processShopifyProduct(channel: any, productData: any) {
  try {
    // This would sync product data from Shopify to our system
    // For now, just log it
    console.log(`Received Shopify product webhook: ${productData.title}`);

    // TODO: Implement product sync logic
    // - Check if product exists
    // - Update or create product
    // - Sync variants, images, etc.

  } catch (error: any) {
    console.error('Error processing Shopify product:', error);
    throw error;
  }
}

async function processShopifyInventory(channel: any, inventoryData: any) {
  try {
    // This would sync inventory levels from Shopify
    console.log(`Received Shopify inventory webhook: ${inventoryData.inventory_item_id}`);

    // TODO: Implement inventory sync logic
    // - Find corresponding product
    // - Update inventory levels

  } catch (error: any) {
    console.error('Error processing Shopify inventory:', error);
    throw error;
  }
}
