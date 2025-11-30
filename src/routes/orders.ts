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

      // Authenticate and validate account access
      const user = getUserFromRequest(req);
      await assertAccountBelongsToUser(supabase, user.userId, body.account_id);

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

  app.get("/orders", async (req: FastifyRequest<{ Querystring: {
    account_id: string;
    status?: string;
    type?: string;
    limit?: number;
  } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { account_id, status, type, limit = 50 } = req.query;

      if (!account_id) {
        return reply.status(400).send({
          success: false,
          error: "account_id is required"
        });
      }

      // Validate account belongs to user
      await assertAccountBelongsToUser(supabase, user.userId, account_id);

      let query = supabase
        .from("orders")
        .select(`
          id, account_id, type, status, customer_name, customer_email,
          customer_phone, notes, total_amount, created_at, updated_at,
          order_items!inner(
            id, quantity, unit_price, total_price,
            products(id, name, sku)
          )
        `)
        .eq("account_id", account_id);

      if (status) {
        query = query.eq("status", status);
      }

      if (type) {
        query = query.eq("type", type);
      }

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        return reply.status(400).send({ success: false, error: error.message });
      }

      return reply.send({ success: true, orders: data });
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message });
    }
  });

  // GET /orders/:orderId - Get single order
  app.get("/orders/:orderId", async (req: FastifyRequest<{ Params: { orderId: string } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { orderId } = req.params;

      const { data, error } = await supabase
        .from("orders")
        .select(`
          id, account_id, type, status, customer_name, customer_email,
          customer_phone, notes, total_amount, created_at, updated_at,
          order_items(
            id, quantity, unit_price, total_price,
            products(id, name, sku)
          )
        `)
        .eq("id", orderId)
        .single();

      if (error || !data) {
        return reply.status(404).send({ success: false, error: "Order not found" });
      }

      // Validate account access
      await assertAccountBelongsToUser(supabase, user.userId, data.account_id);

      return reply.send({ success: true, data });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // POST /orders - Create general order
  app.post("/orders", async (req: FastifyRequest<{ Body: {
    account_id: string;
    type?: string;
    notes?: string;
    customer_name?: string;
    customer_phone?: string;
    customer_email?: string;
    items: Array<{
      product_id: string;
      quantity: number;
    }>;
  } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { account_id, type = 'manual', notes, customer_name, customer_phone, customer_email, items } = req.body;

      // Validate account access
      await assertAccountBelongsToUser(supabase, user.userId, account_id);

      if (!items || !Array.isArray(items) || items.length === 0) {
        return reply.status(400).send({
          success: false,
          error: "items must be a non-empty array"
        });
      }

      // Validate products and calculate total
      const productIds = items.map(i => i.product_id);
      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("id, account_id, name, price, sku")
        .in("id", productIds);

      if (productsError) {
        return reply.status(400).send({ success: false, error: productsError.message });
      }

      // Check all products exist and belong to account
      const productMap = new Map(products?.map(p => [p.id, p]) || []);
      let totalAmount = 0;

      for (const item of items) {
        const product = productMap.get(item.product_id);
        if (!product) {
          return reply.status(400).send({
            success: false,
            error: `Product ${item.product_id} not found`
          });
        }
        if (product.account_id !== account_id) {
          return reply.status(400).send({
            success: false,
            error: `Product ${item.product_id} does not belong to this account`
          });
        }
        totalAmount += product.price * item.quantity;
      }

      // Create order
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          account_id,
          type,
          status: "pending",
          notes,
          total_amount: totalAmount
        })
        .select()
        .single();

      if (orderError) {
        return reply.status(400).send({ success: false, error: orderError.message });
      }

      // Create order items
      const orderItems = [];
      for (const item of items) {
        const product = productMap.get(item.product_id)!;
        const { data: orderItem, error: itemError } = await supabase
          .from("order_items")
          .insert({
            order_id: order.id,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: product.price
          })
          .select()
          .single();

        if (itemError) {
          return reply.status(400).send({ success: false, error: itemError.message });
        }

        orderItems.push(orderItem);
      }

      return reply.send({
        success: true,
        data: {
          id: order.id,
          account_id: order.account_id,
          type: order.type,
          status: order.status,
          notes: order.notes,
          total: totalAmount,
          customer_name,
          customer_phone,
          customer_email,
          created_at: order.created_at,
          order_items: orderItems
        }
      });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // PATCH /orders/:orderId/status - Update order status
  app.patch("/orders/:orderId/status", async (req: FastifyRequest<{
    Params: { orderId: string },
    Body: { status: string }
  }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { orderId } = req.params;
      const { status } = req.body;

      // Get current order
      const { data: currentOrder, error: getError } = await supabase
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .single();

      if (getError || !currentOrder) {
        return reply.status(404).send({ success: false, error: "Order not found" });
      }

      // Validate account access
      await assertAccountBelongsToUser(supabase, user.userId, currentOrder.account_id);

      // Validate status transition
      const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return reply.status(400).send({
          success: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        });
      }

      // Update order
      const { data: order, error: updateError } = await supabase
        .from("orders")
        .update({
          status,
          updated_at: new Date().toISOString()
        })
        .eq("id", orderId)
        .select()
        .single();

      if (updateError) {
        return reply.status(400).send({ success: false, error: updateError.message });
      }

      return reply.send({
        success: true,
        data: {
          id: order.id,
          account_id: order.account_id,
          status: order.status,
          updated_at: order.updated_at
        }
      });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });
}