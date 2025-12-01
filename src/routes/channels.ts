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
          partner_id: partnerId, // Backend-managed
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
  try {
    // Validate Siigo credentials from config
    const apiKey = channel.config?.api_key;
    const username = channel.config?.username || channel.external_id;
    const partnerId = channel.config?.partner_id || process.env.SIIGO_PARTNER_ID;

    if (!apiKey || !username) {
      return {
        success: false,
        message: 'Missing Siigo credentials (username or API key) in config'
      };
    }

    // Get Siigo API configuration from environment
    const baseUrl = process.env.SIIGO_API_BASE_URL || 'https://api.siigo.com/v1';

    // Siigo requires OAuth authentication first
    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Add Partner-Id if configured
    if (partnerId && partnerId.trim()) {
      authHeaders['Partner-Id'] = partnerId;
    }

    const authUrl = `${baseUrl}/auth`;
    console.log('Siigo auth URL:', authUrl);
    console.log('Siigo auth headers:', JSON.stringify(authHeaders, null, 2));
    console.log('Siigo auth body:', JSON.stringify({ username, access_key: apiKey }, null, 2));

    const authResponse = await fetch(authUrl, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        username: username,
        access_key: apiKey
      })
    });

    console.log('Siigo auth status:', authResponse.status);
    console.log('Siigo auth response headers:', JSON.stringify(Object.fromEntries(authResponse.headers), null, 2));

    const responseText = await authResponse.text();
    console.log('Siigo auth response body:', responseText);

    if (!authResponse.ok) {
      let errorData;
      try {
        errorData = JSON.parse(responseText);
      } catch {
        errorData = { message: responseText };
      }
      return {
        success: false,
        message: `Siigo authentication failed: ${errorData.message || authResponse.statusText}`
      };
    }

    const authData = JSON.parse(responseText);
    const accessToken = authData.access_token;

    if (!accessToken) {
      return {
        success: false,
        message: 'No access token received from Siigo authentication'
      };
    }

    // Test connection with the obtained token
    const testHeaders: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };

    // Add Partner-Id if configured
    if (partnerId && partnerId.trim()) {
      testHeaders['Partner-Id'] = partnerId;
    }

    // Try to get account groups (simple endpoint to test connection)
    const testResponse = await fetch(`${baseUrl}/account-groups`, {
      method: 'GET',
      headers: testHeaders
    });

    if (!testResponse.ok) {
      return {
        success: false,
        message: `Siigo API test failed: ${testResponse.status} ${testResponse.statusText}`
      };
    }

    const accountGroupsData = await testResponse.json();
    return {
      success: true,
      message: 'Siigo connection successful',
      siigo_data: accountGroupsData
    };

  } catch (error: any) {
    return {
      success: false,
      message: `Siigo connection failed: ${error.message}`
    };
  }
}