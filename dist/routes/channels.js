"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.channelsRoutes = channelsRoutes;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const supabaseClient_1 = require("../supabaseClient");
function getUserFromRequest(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        throw new Error("Missing Authorization header");
    }
    const token = authHeader.replace("Bearer ", "");
    const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
    return decoded;
}
async function channelsRoutes(app) {
    // GET /channels - List channels for account
    app.get("/channels", async (req, reply) => {
        try {
            getUserFromRequest(req);
            const accountId = req.query.account_id;
            let query = supabaseClient_1.supabase
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
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
    // POST /channels - Create new channel
    app.post("/channels", async (req, reply) => {
        try {
            getUserFromRequest(req);
            const { account_id, type, external_id, access_token, refresh_token, token_expires_at, config } = req.body;
            if (!account_id || !type || !external_id) {
                return reply.status(400).send({
                    success: false,
                    error: "account_id, type, and external_id are required"
                });
            }
            const validTypes = ['shopify', 'siigo', 'erp', 'woocommerce', 'prestashop'];
            if (!validTypes.includes(type)) {
                return reply.status(400).send({
                    success: false,
                    error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
                });
            }
            const { data, error } = await supabaseClient_1.supabase
                .from("channels")
                .insert([{
                    account_id,
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
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
    // PUT /channels/:id - Update channel
    app.put("/channels/:id", async (req, reply) => {
        try {
            getUserFromRequest(req);
            const { id } = req.params;
            const updates = req.body;
            const { data, error } = await supabaseClient_1.supabase
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
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
    // DELETE /channels/:id - Delete channel
    app.delete("/channels/:id", async (req, reply) => {
        try {
            getUserFromRequest(req);
            const { id } = req.params;
            const { error } = await supabaseClient_1.supabase
                .from("channels")
                .delete()
                .eq("id", id);
            if (error) {
                return reply.status(400).send({ success: false, error: error.message });
            }
            return reply.send({ success: true, message: "Channel deleted" });
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
    // POST /channels/:id/test - Test channel connection
    app.post("/channels/:id/test", async (req, reply) => {
        try {
            getUserFromRequest(req);
            const { id } = req.params;
            // Get channel details
            const { data: channel, error: channelError } = await supabaseClient_1.supabase
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
            await supabaseClient_1.supabase
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
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
}
// Helper functions for testing connections
async function testShopifyConnection(channel) {
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
        }
        else {
            return { success: false, message: `Shopify API error: ${response.status}` };
        }
    }
    catch (error) {
        return { success: false, message: `Connection error: ${error.message}` };
    }
}
async function testERPConnection(channel) {
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
    }
    catch (error) {
        return { success: false, message: `ERP connection error: ${error.message}` };
    }
}
