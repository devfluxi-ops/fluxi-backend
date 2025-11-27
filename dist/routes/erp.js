"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.erpRoutes = erpRoutes;
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
async function erpRoutes(app) {
    // POST /erp/connect - Connect ERP system
    app.post("/erp/connect", async (req, reply) => {
        try {
            getUserFromRequest(req);
            const { account_id, type, api_key, username, password } = req.body;
            if (!account_id || !type) {
                return reply.status(400).send({
                    success: false,
                    error: "account_id and type are required"
                });
            }
            if (type !== 'siigo' && type !== 'erp') {
                return reply.status(400).send({
                    success: false,
                    error: "Type must be 'siigo' or 'erp'"
                });
            }
            // For Siigo, we need API credentials
            let config = {};
            let accessToken;
            if (type === 'siigo') {
                if (!api_key) {
                    return reply.status(400).send({
                        success: false,
                        error: "api_key is required for Siigo connection"
                    });
                }
                // Test Siigo connection
                const testResult = await testSiigoConnection(api_key);
                if (!testResult.success) {
                    return reply.status(400).send({
                        success: false,
                        error: `Siigo connection failed: ${testResult.message}`
                    });
                }
                accessToken = api_key;
                config = { api_key: api_key };
            }
            else {
                // Generic ERP connection
                if (!username || !password) {
                    return reply.status(400).send({
                        success: false,
                        error: "username and password are required for ERP connection"
                    });
                }
                config = { username, password };
                accessToken = Buffer.from(`${username}:${password}`).toString('base64');
            }
            // Create ERP channel
            const { data: channel, error: channelError } = await supabaseClient_1.supabase
                .from("channels")
                .insert([{
                    account_id,
                    type: type === 'siigo' ? 'siigo' : 'erp',
                    external_id: type === 'siigo' ? 'siigo_api' : 'erp_system',
                    access_token: accessToken,
                    config,
                    status: 'connected'
                }])
                .select()
                .single();
            if (channelError) {
                return reply.status(400).send({ success: false, error: channelError.message });
            }
            // Log successful connection
            await supabaseClient_1.supabase
                .from("sync_logs")
                .insert([{
                    account_id,
                    event_type: `${type}_connection_established`,
                    status: "completed",
                    payload: { channel_id: channel.id, type }
                }]);
            return reply.send({
                success: true,
                channel: channel,
                message: `${type.toUpperCase()} connection established successfully`
            });
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
    // POST /erp/sync/products - Sync products from ERP
    app.post("/erp/sync/products", async (req, reply) => {
        try {
            getUserFromRequest(req);
            const { account_id, channel_id } = req.body;
            if (!account_id || !channel_id) {
                return reply.status(400).send({
                    success: false,
                    error: "account_id and channel_id are required"
                });
            }
            // Get channel details
            const { data: channel, error: channelError } = await supabaseClient_1.supabase
                .from("channels")
                .select("*")
                .eq("id", channel_id)
                .eq("account_id", account_id)
                .single();
            if (channelError || !channel) {
                return reply.status(404).send({ success: false, error: "Channel not found" });
            }
            if (channel.status !== 'connected') {
                return reply.status(400).send({ success: false, error: "Channel is not connected" });
            }
            // Start sync process
            const syncResult = await syncERPProducts(channel);
            // Log sync result
            await supabaseClient_1.supabase
                .from("sync_logs")
                .insert([{
                    account_id,
                    event_type: "erp_product_sync",
                    status: syncResult.success ? "completed" : "error",
                    payload: {
                        channel_id,
                        products_synced: syncResult.products_count || 0,
                        error: syncResult.error
                    }
                }]);
            return reply.send({
                success: syncResult.success,
                message: syncResult.message,
                data: syncResult
            });
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
    // POST /erp/sync/inventory - Sync inventory from ERP
    app.post("/erp/sync/inventory", async (req, reply) => {
        try {
            getUserFromRequest(req);
            const { account_id, channel_id } = req.body;
            if (!account_id || !channel_id) {
                return reply.status(400).send({
                    success: false,
                    error: "account_id and channel_id are required"
                });
            }
            // Get channel details
            const { data: channel, error: channelError } = await supabaseClient_1.supabase
                .from("channels")
                .select("*")
                .eq("id", channel_id)
                .eq("account_id", account_id)
                .single();
            if (channelError || !channel) {
                return reply.status(404).send({ success: false, error: "Channel not found" });
            }
            // Start inventory sync
            const syncResult = await syncERPInventory(channel);
            // Log sync result
            await supabaseClient_1.supabase
                .from("sync_logs")
                .insert([{
                    account_id,
                    event_type: "erp_inventory_sync",
                    status: syncResult.success ? "completed" : "error",
                    payload: {
                        channel_id,
                        inventory_updated: syncResult.updated_count || 0,
                        error: syncResult.error
                    }
                }]);
            return reply.send({
                success: syncResult.success,
                message: syncResult.message,
                data: syncResult
            });
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
}
// Helper functions for ERP operations
async function testSiigoConnection(apiKey) {
    try {
        const apiUrl = process.env.ERP_API_BASE_URL || 'https://api.siigo.com';
        // Test Siigo API connection
        const response = await fetch(`${apiUrl}/v1/companies`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        if (response.ok) {
            return { success: true, message: "Siigo connection successful" };
        }
        else if (response.status === 401) {
            return { success: false, message: "Invalid API key" };
        }
        else {
            return { success: false, message: `Siigo API error: ${response.status}` };
        }
    }
    catch (error) {
        return { success: false, message: `Connection error: ${error.message}` };
    }
}
async function syncERPProducts(channel) {
    try {
        let productsSynced = 0;
        if (channel.type === 'siigo') {
            // Sync products from Siigo
            const apiUrl = process.env.ERP_API_BASE_URL || 'https://api.siigo.com';
            const apiKey = channel.access_token;
            // Get products from Siigo
            const response = await fetch(`${apiUrl}/v1/products`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`Siigo API error: ${response.status}`);
            }
            const siigoProducts = await response.json();
            // Process and sync each product
            for (const siigoProduct of siigoProducts) {
                const product = {
                    account_id: channel.account_id,
                    name: siigoProduct.name,
                    sku: siigoProduct.code,
                    price: Math.round(siigoProduct.price * 100), // Convert to cents
                    external_id: siigoProduct.id.toString()
                };
                // Upsert product
                const { error: upsertError } = await supabaseClient_1.supabase
                    .from("products")
                    .upsert([product], {
                    onConflict: 'account_id,external_id',
                    ignoreDuplicates: false
                });
                if (!upsertError) {
                    productsSynced++;
                }
            }
        }
        return {
            success: true,
            message: `Successfully synced ${productsSynced} products`,
            products_count: productsSynced
        };
    }
    catch (error) {
        console.error('ERP product sync error:', error);
        return {
            success: false,
            message: `Product sync failed: ${error.message}`,
            error: error.message
        };
    }
}
async function syncERPInventory(channel) {
    try {
        let inventoryUpdated = 0;
        if (channel.type === 'siigo') {
            // Sync inventory from Siigo
            const apiUrl = process.env.ERP_API_BASE_URL || 'https://api.siigo.com';
            const apiKey = channel.access_token;
            // Get inventory from Siigo
            const response = await fetch(`${apiUrl}/v1/inventory`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) {
                throw new Error(`Siigo API error: ${response.status}`);
            }
            const siigoInventory = await response.json();
            // Process and update inventory
            for (const item of siigoInventory) {
                // Find corresponding product
                const { data: product } = await supabaseClient_1.supabase
                    .from("products")
                    .select("id")
                    .eq("account_id", channel.account_id)
                    .eq("external_id", item.product_id.toString())
                    .single();
                if (product) {
                    // Update or insert inventory
                    const { error: inventoryError } = await supabaseClient_1.supabase
                        .from("inventories")
                        .upsert([{
                            product_id: product.id,
                            warehouse: 'default',
                            quantity: item.quantity,
                            updated_at: new Date().toISOString()
                        }], {
                        onConflict: 'product_id,warehouse'
                    });
                    if (!inventoryError) {
                        inventoryUpdated++;
                    }
                }
            }
        }
        return {
            success: true,
            message: `Successfully updated ${inventoryUpdated} inventory items`,
            updated_count: inventoryUpdated
        };
    }
    catch (error) {
        console.error('ERP inventory sync error:', error);
        return {
            success: false,
            message: `Inventory sync failed: ${error.message}`,
            error: error.message
        };
    }
}
