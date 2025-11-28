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

// Middleware helper
async function assertAccountBelongsToUser(
  supabase: any,
  userId: string,
  accountId: string
) {
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

      await assertAccountBelongsToUser(supabase, user.userId, product.account_id);

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