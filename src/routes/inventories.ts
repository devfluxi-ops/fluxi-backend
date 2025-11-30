import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { supabase } from "../supabaseClient";
import { getUserFromRequest, validateAccountAccess } from "../utils/auth";
import { sendSuccess, sendError, sendNotFound } from "../utils/responses";

export async function inventoriesRoutes(app: FastifyInstance) {
  // PUT /inventories - Actualizar stock
  app.put("/inventories", async (req: FastifyRequest<{ Body: {
    product_id: string;
    warehouse?: string;
    quantity: number;
  } }>, reply: FastifyReply) => {
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
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('account_id')
        .eq('id', product_id)
        .single();

      if (productError || !product) {
        return reply.status(404).send({ success: false, error: "Product not found" });
      }

      await validateAccountAccess(user, product.account_id);

      // Insert/Update inventory
      const { data, error } = await supabase
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
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });
}