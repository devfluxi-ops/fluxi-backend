import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { supabase } from "../supabaseClient";

interface ManualOrderItemInput {
  product_id: string;
  quantity: number;
}

interface ManualOrderInput {
  account_id: string;
  type: "manual" | "whatsapp";
  items: ManualOrderItemInput[];
  notes?: string;
}

function getUserFromRequest(req: FastifyRequest): any {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }
  const token = authHeader.replace("Bearer ", "");
  const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
  return decoded;
}

export async function orderRoutes(app: FastifyInstance) {
  app.post("/orders/manual", async (req: FastifyRequest<{ Body: ManualOrderInput }>, reply: FastifyReply) => {
    try {
      const body = req.body;

      // Validate body
      if (!body.account_id) {
        return reply.status(400).send({ success: false, error: "account_id is required" });
      }
      if (!["manual", "whatsapp"].includes(body.type)) {
        return reply.status(400).send({ success: false, error: "type must be 'manual' or 'whatsapp'" });
      }
      if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
        return reply.status(400).send({ success: false, error: "items must be a non-empty array" });
      }
      for (const item of body.items) {
        if (!item.product_id || typeof item.quantity !== "number" || item.quantity <= 0) {
          return reply.status(400).send({ success: false, error: "Each item must have product_id and quantity > 0" });
        }
      }

      // Authenticate
      getUserFromRequest(req);

      const productIds = body.items.map(i => i.product_id);

      // Fetch products
      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("id, account_id, name, price, sku")
        .in("id", productIds);

      if (productsError) {
        return reply.status(400).send({ success: false, error: productsError.message });
      }
      if (!products || products.length !== productIds.length) {
        return reply.status(400).send({ success: false, error: "Some products not found" });
      }

      // Check all products have same account_id
      const accountIds = [...new Set(products.map(p => p.account_id))];
      if (accountIds.length !== 1) {
        return reply.status(400).send({ success: false, error: "All products must belong to the same account" });
      }
      if (accountIds[0] !== body.account_id) {
        return reply.status(400).send({ success: false, error: "Products account_id does not match body.account_id" });
      }

      // Fetch inventories
      const { data: inventories, error: invError } = await supabase
        .from("inventories")
        .select("id, product_id, quantity")
        .in("product_id", productIds)
        .eq("warehouse", "default");

      if (invError) {
        return reply.status(400).send({ success: false, error: invError.message });
      }

      const inventoryMap = new Map(inventories?.map(inv => [inv.product_id, inv]) || []);

      // Check stock
      for (const item of body.items) {
        const inv = inventoryMap.get(item.product_id);
        const available = inv ? inv.quantity : 0;
        if (available < item.quantity) {
          return reply.status(400).send({ success: false, error: `Not enough stock for product ${item.product_id}` });
        }
      }

      // Create order
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert([{
          account_id: body.account_id,
          type: body.type,
          status: "created",
          notes: body.notes ?? null
        }])
        .select()
        .single();

      if (orderError) {
        // Log error
        await supabase.from("sync_logs").insert([{
          account_id: body.account_id,
          event_type: "manual_order_created",
          status: "error",
          payload: { body, errorMessage: orderError.message }
        }]);
        return reply.status(500).send({ success: false, error: orderError.message });
      }

      // Create order items and update inventory
      const createdOrderItems = [];
      for (const item of body.items) {
        const product = products.find(p => p.id === item.product_id)!;
        const { data: orderItem, error: itemError } = await supabase
          .from("order_items")
          .insert([{
            order_id: order.id,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: product.price
          }])
          .select()
          .single();

        if (itemError) {
          // Log error
          await supabase.from("sync_logs").insert([{
            account_id: body.account_id,
            event_type: "manual_order_created",
            status: "error",
            payload: { body, errorMessage: itemError.message }
          }]);
          return reply.status(500).send({ success: false, error: itemError.message });
        }

        createdOrderItems.push(orderItem);

        // Update inventory
        const inv = inventoryMap.get(item.product_id);
        if (inv) {
          const newQuantity = inv.quantity - item.quantity;
          const { error: updateError } = await supabase
            .from("inventories")
            .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
            .eq("id", inv.id);

          if (updateError) {
            // Log error
            await supabase.from("sync_logs").insert([{
              account_id: body.account_id,
              event_type: "manual_order_created",
              status: "error",
              payload: { body, errorMessage: updateError.message }
            }]);
            return reply.status(500).send({ success: false, error: updateError.message });
          }
        } else {
          // No inventory row, error
          await supabase.from("sync_logs").insert([{
            account_id: body.account_id,
            event_type: "manual_order_created",
            status: "error",
            payload: { body, errorMessage: "No inventory row for product" }
          }]);
          return reply.status(500).send({ success: false, error: "No inventory row for product" });
        }
      }

      // Log success
      await supabase.from("sync_logs").insert([{
        account_id: body.account_id,
        event_type: "manual_order_created",
        status: "success",
        payload: { order, items: createdOrderItems }
      }]);

      return reply.send({ success: true, order, items: createdOrderItems });
    } catch (error: any) {
      const body = req.body as ManualOrderInput;
      await supabase.from("sync_logs").insert([{
        account_id: body.account_id,
        event_type: "manual_order_created",
        status: "error",
        payload: { body, errorMessage: error.message }
      }]);
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  app.get("/orders", async (req: FastifyRequest<{ Querystring: { account_id?: string } }>, reply: FastifyReply) => {
    try {
      getUserFromRequest(req);

      const accountId = req.query.account_id;

      let query = supabase
        .from("orders")
        .select(`
          id,
          account_id,
          type,
          status,
          notes,
          created_at,
          order_items (
            id,
            product_id,
            quantity,
            unit_price,
            product:products (
              id,
              name,
              sku,
              price
            )
          )
        `)
        .order("created_at", { ascending: false })
        .limit(20);

      if (accountId) {
        query = query.eq("account_id", accountId);
      }

      const { data, error } = await query;

      if (error) {
        return reply.status(400).send({ success: false, error: error.message });
      }

      return reply.send({ success: true, orders: data });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });
}