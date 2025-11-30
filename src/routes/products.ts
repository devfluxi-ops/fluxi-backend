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

// Middleware helper - updated for RLS
async function assertAccountBelongsToUser(
  user: any,
  accountId: string
) {
  // Since JWT now includes account_id and we have RLS policies,
  // we can rely on the database policies for security
  // But we still validate the account_id matches the JWT claim
  if (user.account_id !== accountId) {
    throw new Error('Account access denied');
  }
}

interface ProductsQuery {
  account_id?: string;
  search?: string;
  limit?: number;
}

export async function productRoutes(app: FastifyInstance) {
  app.get(
    "/products",
    async (
      req: FastifyRequest<{ Querystring: { account_id: string; search?: string; status?: string; limit?: number } }>,
      reply: FastifyReply,
    ) => {
      try {
        const user = getUserFromRequest(req);
        const { account_id, search, status, limit = 50 } = req.query;

        if (!account_id) {
          return reply
            .status(400)
            .send({ success: false, error: "account_id is required" });
        }

        // Validate account belongs to user (RLS handles this now)
        await assertAccountBelongsToUser(user, account_id);

        let query = supabase
          .from("products")
          .select(`
            id, account_id, name, status, created_at, updated_at
          `)
          .eq("account_id", account_id);

        if (search && search.trim() !== "") {
          query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
        }

        if (status) {
          query = query.eq("status", status);
        }

        const { data, error } = await query
          .order("name")
          .limit(limit);

        if (error) {
          return reply
            .status(400)
            .send({ success: false, error: error.message });
        }

        return reply.send({ success: true, products: data || [] });
      } catch (err: any) {
        return reply.status(401).send({ success: false, error: err.message });
      }
    },
  );

  // GET /products/:productId - Get single product
  app.get("/products/:productId", async (req: FastifyRequest<{ Params: { productId: string } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { productId } = req.params;

      const { data, error } = await supabase
        .from("products")
        .select(`
          id,
          account_id,
          name,
          sku,
          price,
          status,
          external_id,
          created_at,
          updated_at,
          inventories (
            warehouse,
            quantity
          )
        `)
        .eq("id", productId)
        .single();

      if (error || !data) {
        return reply.status(404).send({ success: false, error: "Product not found" });
      }

      // Validate account access (RLS handles this now)
      await assertAccountBelongsToUser(user, data.account_id);

      // Calculate stock
      const stock = data.inventories?.reduce((sum: number, inv: any) => sum + inv.quantity, 0) || 0;

      return reply.send({
        success: true,
        data: {
          id: data.id,
          account_id: data.account_id,
          name: data.name,
          sku: data.sku,
          price: data.price,
          stock: stock,
          status: data.status,
          external_id: data.external_id,
          created_at: data.created_at,
          updated_at: data.updated_at
        }
      });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // POST /products - Create new product
  app.post("/products", async (req: FastifyRequest<{ Body: {
    account_id: string;
    name: string;
    sku: string;
    price: number;
    stock?: number;
    status?: string;
    channel_id?: string;
    external_id?: string;
  } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { account_id, name, sku, price, stock = 0, status = 'active', channel_id, external_id } = req.body;

      // Validate account access (RLS handles this now)
      await assertAccountBelongsToUser(user, account_id);

      if (!name || !sku || price === undefined) {
        return reply.status(400).send({
          success: false,
          error: "name, sku, and price are required"
        });
      }

      // Create product
      const { data: product, error: productError } = await supabase
        .from("products")
        .insert({
          account_id,
          name,
          sku,
          price,
          status,
          external_id
        })
        .select()
        .single();

      if (productError) {
        return reply.status(400).send({ success: false, error: productError.message });
      }

      // Create inventory if stock > 0
      if (stock > 0) {
        const { error: inventoryError } = await supabase
          .from("inventories")
          .insert({
            product_id: product.id,
            warehouse: 'default',
            quantity: stock
          });

        if (inventoryError) {
          return reply.status(400).send({ success: false, error: inventoryError.message });
        }
      }

      return reply.send({
        success: true,
        data: {
          id: product.id,
          account_id: product.account_id,
          name: product.name,
          sku: product.sku,
          price: product.price,
          stock: stock,
          status: product.status,
          external_id: product.external_id,
          created_at: product.created_at,
          updated_at: product.updated_at
        }
      });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // PUT /products/:productId - Update product
  app.put("/products/:productId", async (req: FastifyRequest<{
    Params: { productId: string },
    Body: Partial<{
      name: string;
      sku: string;
      price: number;
      stock: number;
      status: string;
      external_id: string;
    }>
  }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { productId } = req.params;
      const updates = req.body;

      // Get current product
      const { data: currentProduct, error: getError } = await supabase
        .from("products")
        .select("*")
        .eq("id", productId)
        .single();

      if (getError || !currentProduct) {
        return reply.status(404).send({ success: false, error: "Product not found" });
      }

      // Validate account access (RLS handles this now)
      await assertAccountBelongsToUser(user, currentProduct.account_id);

      // Update product
      const { data: product, error: productError } = await supabase
        .from("products")
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq("id", productId)
        .select()
        .single();

      if (productError) {
        return reply.status(400).send({ success: false, error: productError.message });
      }

      // Update inventory if stock provided
      if (updates.stock !== undefined) {
        const { error: inventoryError } = await supabase
          .from("inventories")
          .upsert({
            product_id: productId,
            warehouse: 'default',
            quantity: updates.stock,
            updated_at: new Date().toISOString()
          });

        if (inventoryError) {
          return reply.status(400).send({ success: false, error: inventoryError.message });
        }
      }

      // Get updated stock
      const { data: inventory } = await supabase
        .from("inventories")
        .select("quantity")
        .eq("product_id", productId)
        .eq("warehouse", 'default')
        .single();

      const stock = inventory?.quantity || 0;

      return reply.send({
        success: true,
        data: {
          id: product.id,
          account_id: product.account_id,
          name: product.name,
          sku: product.sku,
          price: product.price,
          stock: stock,
          status: product.status,
          external_id: product.external_id,
          created_at: product.created_at,
          updated_at: product.updated_at
        }
      });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // DELETE /products/:productId - Delete product
  app.delete("/products/:productId", async (req: FastifyRequest<{ Params: { productId: string } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { productId } = req.params;

      // Get current product
      const { data: currentProduct, error: getError } = await supabase
        .from("products")
        .select("*")
        .eq("id", productId)
        .single();

      if (getError || !currentProduct) {
        return reply.status(404).send({ success: false, error: "Product not found" });
      }

      // Validate account access (RLS handles this now)
      await assertAccountBelongsToUser(user, currentProduct.account_id);

      // Delete inventory first
      await supabase
        .from("inventories")
        .delete()
        .eq("product_id", productId);

      // Delete product
      const { error: productError } = await supabase
        .from("products")
        .delete()
        .eq("id", productId);

      if (productError) {
        return reply.status(400).send({ success: false, error: productError.message });
      }

      return reply.send({ success: true });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });
}
