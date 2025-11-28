"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoriesRoutes = inventoriesRoutes;
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
// Middleware helper
async function assertAccountBelongsToUser(supabase, userId, accountId) {
    const { data, error } = await supabase
        .from('account_users')
        .select('id')
        .eq('user_id', userId)
        .eq('account_id', accountId)
        .maybeSingle();
    if (error || !data) {
        throw new Error('Account not found for this user');
    }
}
async function inventoriesRoutes(app) {
    // PUT /inventories - Actualizar stock
    app.put("/inventories", async (req, reply) => {
        try {
            const user = getUserFromRequest(req);
            const { product_id, warehouse = 'default', quantity } = req.body;
            if (quantity < 0) {
                return reply.status(400).send({
                    success: false,
                    error: "quantity must be non-negative"
                });
            }
            // Verificar que el producto pertenece al usuario
            const { data: product, error: productError } = await supabaseClient_1.supabase
                .from('products')
                .select('account_id')
                .eq('id', product_id)
                .single();
            if (productError || !product) {
                return reply.status(404).send({ success: false, error: "Product not found" });
            }
            await assertAccountBelongsToUser(supabaseClient_1.supabase, user.userId, product.account_id);
            // Insert/Update inventory
            const { data, error } = await supabaseClient_1.supabase
                .from('inventories')
                .upsert({
                product_id,
                warehouse,
                quantity,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'product_id,warehouse'
            })
                .select()
                .single();
            if (error) {
                return reply.status(400).send({ success: false, error: error.message });
            }
            return reply.send({
                success: true,
                data: {
                    product_id: data.product_id,
                    warehouse: data.warehouse,
                    quantity: data.quantity,
                    updated_at: data.updated_at
                }
            });
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
}
