import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
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

export async function syncRoutes(app: FastifyInstance) {
  // POST /sync/products - Manual product sync
  app.post("/sync/products", async (req: FastifyRequest<{ Body: { account_id: string, channel_id?: string, direction: 'from_channel' | 'to_channel' } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { account_id, channel_id, direction = 'from_channel' } = req.body;

      if (!account_id) {
        return reply.status(400).send({
          success: false,
          error: "account_id is required"
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

      let channelsToSync = [];

      if (channel_id) {
        // Sync specific channel
        const { data: channel } = await supabase
          .from("channels")
          .select("*")
          .eq("id", channel_id)
          .eq("account_id", account_id)
          .eq("status", "connected")
          .single();

        if (!channel) {
          return reply.status(404).send({ success: false, error: "Channel not found or not connected" });
        }

        channelsToSync = [channel];
      } else {
        // Sync all connected channels
        const { data: allChannels } = await supabase
          .from("channels")
          .select("*")
          .eq("account_id", account_id)
          .eq("status", "connected");

        channelsToSync = allChannels || [];
      }

      const results = [];

      for (const channel of channelsToSync) {
        try {
          const syncResult = await syncProductsForChannel(channel, direction);
          results.push({
            channel_id: channel.id,
            channel_type: channel.type,
            success: syncResult.success,
            message: syncResult.message,
            products_synced: syncResult.count || 0
          });

          // Log sync
          await supabase
            .from("sync_logs")
            .insert([{
              account_id,
              event_type: `manual_product_sync_${direction}`,
              status: syncResult.success ? "completed" : "error",
              payload: {
                channel_id: channel.id,
                direction,
                products_synced: syncResult.count || 0,
                error: syncResult.error
              }
            }]);

        } catch (error: any) {
          results.push({
            channel_id: channel.id,
            channel_type: channel.type,
            success: false,
            message: `Sync failed: ${error.message}`,
            products_synced: 0
          });
        }
      }

      const successful = results.filter(r => r.success).length;
      const total = results.length;

      return reply.send({
        success: successful > 0,
        message: `Synced products for ${successful}/${total} channels`,
        results
      });

    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // POST /sync/inventory - Manual inventory sync
  app.post("/sync/inventory", async (req: FastifyRequest<{ Body: { account_id: string, channel_id?: string, direction: 'from_channel' | 'to_channel' } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { account_id, channel_id, direction = 'from_channel' } = req.body;

      if (!account_id) {
        return reply.status(400).send({
          success: false,
          error: "account_id is required"
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

      let channelsToSync = [];

      if (channel_id) {
        const { data: channel } = await supabase
          .from("channels")
          .select("*")
          .eq("id", channel_id)
          .eq("account_id", account_id)
          .eq("status", "connected")
          .single();

        if (!channel) {
          return reply.status(404).send({ success: false, error: "Channel not found or not connected" });
        }

        channelsToSync = [channel];
      } else {
        const { data: allChannels } = await supabase
          .from("channels")
          .select("*")
          .eq("account_id", account_id)
          .eq("status", "connected");

        channelsToSync = allChannels || [];
      }

      const results = [];

      for (const channel of channelsToSync) {
        try {
          const syncResult = await syncInventoryForChannel(channel, direction);
          results.push({
            channel_id: channel.id,
            channel_type: channel.type,
            success: syncResult.success,
            message: syncResult.message,
            inventory_updated: syncResult.count || 0
          });

          await supabase
            .from("sync_logs")
            .insert([{
              account_id,
              event_type: `manual_inventory_sync_${direction}`,
              status: syncResult.success ? "completed" : "error",
              payload: {
                channel_id: channel.id,
                direction,
                inventory_updated: syncResult.count || 0,
                error: syncResult.error
              }
            }]);

        } catch (error: any) {
          results.push({
            channel_id: channel.id,
            channel_type: channel.type,
            success: false,
            message: `Sync failed: ${error.message}`,
            inventory_updated: 0
          });
        }
      }

      const successful = results.filter(r => r.success).length;
      const total = results.length;

      return reply.send({
        success: successful > 0,
        message: `Synced inventory for ${successful}/${total} channels`,
        results
      });

    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // POST /sync/orders - Manual order sync
  app.post("/sync/orders", async (req: FastifyRequest<{ Body: { account_id: string, channel_id?: string, direction: 'from_channel' | 'to_channel' } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { account_id, channel_id, direction = 'from_channel' } = req.body;

      if (!account_id) {
        return reply.status(400).send({
          success: false,
          error: "account_id is required"
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

      let channelsToSync = [];

      if (channel_id) {
        const { data: channel } = await supabase
          .from("channels")
          .select("*")
          .eq("id", channel_id)
          .eq("account_id", account_id)
          .eq("status", "connected")
          .single();

        if (!channel) {
          return reply.status(404).send({ success: false, error: "Channel not found or not connected" });
        }

        channelsToSync = [channel];
      } else {
        const { data: allChannels } = await supabase
          .from("channels")
          .select("*")
          .eq("account_id", account_id)
          .eq("status", "connected");

        channelsToSync = allChannels || [];
      }

      const results = [];

      for (const channel of channelsToSync) {
        try {
          const syncResult = await syncOrdersForChannel(channel, direction);
          results.push({
            channel_id: channel.id,
            channel_type: channel.type,
            success: syncResult.success,
            message: syncResult.message,
            orders_synced: syncResult.count || 0
          });

          await supabase
            .from("sync_logs")
            .insert([{
              account_id,
              event_type: `manual_order_sync_${direction}`,
              status: syncResult.success ? "completed" : "error",
              payload: {
                channel_id: channel.id,
                direction,
                orders_synced: syncResult.count || 0,
                error: syncResult.error
              }
            }]);

        } catch (error: any) {
          results.push({
            channel_id: channel.id,
            channel_type: channel.type,
            success: false,
            message: `Sync failed: ${error.message}`,
            orders_synced: 0
          });
        }
      }

      const successful = results.filter(r => r.success).length;
      const total = results.length;

      return reply.send({
        success: successful > 0,
        message: `Synced orders for ${successful}/${total} channels`,
        results
      });

    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // GET /sync/status - Get sync status and history
  app.get("/sync/status", async (req: FastifyRequest<{ Querystring: { account_id: string, limit?: number } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { account_id, limit = 20 } = req.query;

      if (!account_id) {
        return reply.status(400).send({
          success: false,
          error: "account_id is required"
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

      // Get recent sync logs
      const { data: syncLogs, error } = await supabase
        .from("sync_logs")
        .select("*")
        .eq("account_id", account_id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        return reply.status(400).send({ success: false, error: error.message });
      }

      // Get current channel statuses
      const { data: channels } = await supabase
        .from("channels")
        .select("id, type, status, last_error, updated_at")
        .eq("account_id", account_id);

      return reply.send({
        success: true,
        channels: channels || [],
        recent_syncs: syncLogs || []
      });

    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });
}

// Helper functions for syncing different data types
async function syncProductsForChannel(channel: any, direction: string) {
  try {
    let count = 0;

    if (direction === 'from_channel') {
      // Import products from external channel
      switch (channel.type) {
        case 'shopify':
          count = await syncProductsFromShopify(channel);
          break;
        case 'siigo':
        case 'erp':
          count = await syncProductsFromERP(channel);
          break;
        default:
          throw new Error(`Product sync not implemented for ${channel.type}`);
      }
    } else {
      // Export products to external channel
      switch (channel.type) {
        case 'shopify':
          count = await syncProductsToShopify(channel);
          break;
        case 'siigo':
        case 'erp':
          count = await syncProductsToERP(channel);
          break;
        default:
          throw new Error(`Product export not implemented for ${channel.type}`);
      }
    }

    return { success: true, message: `Synced ${count} products`, count };

  } catch (error: any) {
    return { success: false, message: error.message, error: error.message };
  }
}

async function syncInventoryForChannel(channel: any, direction: string) {
  try {
    let count = 0;

    if (direction === 'from_channel') {
      switch (channel.type) {
        case 'shopify':
          count = await syncInventoryFromShopify(channel);
          break;
        case 'siigo':
        case 'erp':
          count = await syncInventoryFromERP(channel);
          break;
        default:
          throw new Error(`Inventory sync not implemented for ${channel.type}`);
      }
    } else {
      switch (channel.type) {
        case 'shopify':
          count = await syncInventoryToShopify(channel);
          break;
        case 'siigo':
        case 'erp':
          count = await syncInventoryToERP(channel);
          break;
        default:
          throw new Error(`Inventory export not implemented for ${channel.type}`);
      }
    }

    return { success: true, message: `Updated ${count} inventory items`, count };

  } catch (error: any) {
    return { success: false, message: error.message, error: error.message };
  }
}

async function syncOrdersForChannel(channel: any, direction: string) {
  try {
    let count = 0;

    if (direction === 'from_channel') {
      switch (channel.type) {
        case 'shopify':
          count = await syncOrdersFromShopify(channel);
          break;
        case 'siigo':
        case 'erp':
          count = await syncOrdersFromERP(channel);
          break;
        default:
          throw new Error(`Order sync not implemented for ${channel.type}`);
      }
    } else {
      // Export orders to external channel (less common)
      count = 0; // Not implemented yet
    }

    return { success: true, message: `Synced ${count} orders`, count };

  } catch (error: any) {
    return { success: false, message: error.message, error: error.message };
  }
}

// Placeholder implementations (to be expanded)
async function syncProductsFromShopify(channel: any): Promise<number> {
  // TODO: Implement Shopify product import
  console.log(`Syncing products from Shopify: ${channel.external_id}`);
  return 0;
}

async function syncProductsFromERP(channel: any): Promise<number> {
  // TODO: Implement ERP product import
  console.log(`Syncing products from ERP: ${channel.type}`);
  return 0;
}

async function syncProductsToShopify(channel: any): Promise<number> {
  // TODO: Implement Shopify product export
  console.log(`Exporting products to Shopify: ${channel.external_id}`);
  return 0;
}

async function syncProductsToERP(channel: any): Promise<number> {
  // TODO: Implement ERP product export
  console.log(`Exporting products to ERP: ${channel.type}`);
  return 0;
}

async function syncInventoryFromShopify(channel: any): Promise<number> {
  // TODO: Implement Shopify inventory import
  console.log(`Syncing inventory from Shopify: ${channel.external_id}`);
  return 0;
}

async function syncInventoryFromERP(channel: any): Promise<number> {
  // TODO: Implement ERP inventory import
  console.log(`Syncing inventory from ERP: ${channel.type}`);
  return 0;
}

async function syncInventoryToShopify(channel: any): Promise<number> {
  // TODO: Implement Shopify inventory export
  console.log(`Exporting inventory to Shopify: ${channel.external_id}`);
  return 0;
}

async function syncInventoryToERP(channel: any): Promise<number> {
  // TODO: Implement ERP inventory export
  console.log(`Exporting inventory to ERP: ${channel.type}`);
  return 0;
}

async function syncOrdersFromShopify(channel: any): Promise<number> {
  // TODO: Implement Shopify order import
  console.log(`Syncing orders from Shopify: ${channel.external_id}`);
  return 0;
}

async function syncOrdersFromERP(channel: any): Promise<number> {
  // TODO: Implement ERP order import
  console.log(`Syncing orders from ERP: ${channel.type}`);
  return 0;
}