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
  type: ChannelType;
  external_id: string;
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string;
  config?: Record<string, any>;
}

export async function channelsRoutes(app: FastifyInstance) {
  // GET /channels - List channels for account
  app.get("/channels", async (req: FastifyRequest<{ Querystring: { account_id?: string } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const accountId = req.query.account_id;

      let query = supabase
        .from("channels")
        .select("*")
        .order("created_at", { ascending: false });

      if (accountId) {
        query = query.eq("account_id", accountId);
      }

      const { data, error } = await query;

      if (error) {
        return reply.status(400).send({ success: false, error: error.message });
      }

      return reply.send({ success: true, channels: data });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // POST /channels - Create new channel
  app.post("/channels", async (req: FastifyRequest<{ Body: ChannelInput & { account_id: string } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { account_id, name, description, type, external_id, access_token, refresh_token, token_expires_at, config } = req.body;

      if (!account_id || !type || !external_id) {
        return reply.status(400).send({
          success: false,
          error: "account_id, type, and external_id are required"
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
      if (!validTypes.includes(type)) {
        return reply.status(400).send({
          success: false,
          error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
        });
      }

      const { data, error } = await supabase
        .from("channels")
        .insert([{
          account_id,
          name,
          description,
          type,
          external_id,
          access_token,
          refresh_token,
          token_expires_at,
          config: config || {},
          status: access_token ? 'connected' : 'disconnected'
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
  app.put("/channels/:id", async (req: FastifyRequest<{ Params: { id: string }, Body: Partial<ChannelInput> }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const { id } = req.params;
      const updates = req.body;

      // Validate type if provided
      if (updates.type) {
        const validTypes: ChannelType[] = ['shopify', 'siigo', 'erp', 'woocommerce', 'prestashop'];
        if (!validTypes.includes(updates.type)) {
          return reply.status(400).send({
            success: false,
            error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
          });
        }
      }

      const { data, error } = await supabase
        .from("channels")
        .update({
          ...updates,
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

      let testResult = { success: false, message: "Test not implemented for this channel type" };

      // Test based on channel type
      switch (channel.type) {
        case 'shopify':
          testResult = await testShopifyConnection(channel);
          break;
        case 'siigo':
        case 'erp':
          testResult = await testERPConnection(channel);
          break;
        default:
          testResult = { success: false, message: `Test not implemented for ${channel.type}` };
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
}

// Helper functions for testing connections
async function testShopifyConnection(channel: any) {
  try {
    // Basic Shopify API test
    const shopDomain = channel.external_id;
    const accessToken = channel.access_token;

    if (!shopDomain || !accessToken) {
      return { success: false, message: "Missing shop domain or access token" };
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
    // Basic ERP API test (generic)
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