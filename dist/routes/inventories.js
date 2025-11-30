"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoriesRoutes = inventoriesRoutes;
const supabaseClient_1 = require("../supabaseClient");
const auth_1 = require("../utils/auth");
async function inventoriesRoutes(app) {
    // PUT /inventories - Actualizar stock
    app.put("/inventories", async (req, reply) => {
        try {
            const user = (0, auth_1.getUserFromRequest)(req);
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
            await (0, auth_1.validateAccountAccess)(user, product.account_id);
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
