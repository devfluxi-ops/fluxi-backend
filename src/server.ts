import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import dotenv from "dotenv";
import cors from "@fastify/cors";
import { authRoutes } from "./routes/auth";
import { accountsRoutes } from "./routes/accounts";
import { orderRoutes } from "./routes/orders";
import { productRoutes } from "./routes/products";
import { inventoriesRoutes } from "./routes/inventories";
import { channelsRoutes } from "./routes/channels";
import { shopifyRoutes } from "./routes/shopify";
import { erpRoutes } from "./routes/erp";
import { syncRoutes } from "./routes/sync";
import { registerShopifyAuthRoutes } from "./routes/shopifyAuth";
import { registerShopifyTestRoutes } from "./routes/shopifyTest";
import { registerShopifyIntegrationRoutes } from "./routes/shopifyIntegration";
import { registerShopifyWebhooksRoutes } from "./routes/shopifyWebhooks";

dotenv.config();

const app = Fastify({ logger: true });

app.register(cors, {
  origin: "*", // en el futuro lo restringimos a tu dominio de Vercel
});

app.get("/health", async () => {
  return { status: "ok", service: "fluxi-backend" };
});

// Dashboard stats endpoint
app.get("/dashboard/stats", async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { supabase } = await import("./supabaseClient");
    const { account_id } = request.query as { account_id?: string };

    if (!account_id) {
      return reply.code(400).send({ success: false, message: "account_id requerido" });
    }

    // For now, skip auth validation for testing
    // TODO: Add proper auth validation
    // const { getUserFromRequest } = await import("./utils/auth");
    // const user = getUserFromRequest(request);
    // if (user.account_id !== account_id) {
    //   return reply.code(403).send({ success: false, message: "Acceso denegado" });
    // }

    // Get stats in parallel
    const [productsResult, ordersResult, channelsResult, recentSyncResult] = await Promise.all([
      supabase
        .from('products')
        .select('status', { count: 'exact' })
        .eq('account_id', account_id),
      supabase
        .from('orders')
        .select('status', { count: 'exact' })
        .eq('account_id', account_id),
      supabase
        .from('channels')
        .select('status', { count: 'exact' })
        .eq('account_id', account_id),
      supabase
        .from('sync_logs')
        .select('created_at')
        .eq('account_id', account_id)
        .order('created_at', { ascending: false })
        .limit(1)
    ]);

    // Calculate stats
    const totalProducts = productsResult.count || 0;
    const activeProducts = productsResult.data?.filter(p => p.status === 'active').length || 0;
    const totalOrders = ordersResult.count || 0;
    const pendingOrders = ordersResult.data?.filter(o => o.status === 'pending').length || 0;
    const totalChannels = channelsResult.count || 0;
    const activeChannels = channelsResult.data?.filter(c => c.status === 'connected' || c.status === 'active').length || 0;
    const lastSync = recentSyncResult.data?.[0]?.created_at || null;

    return reply.send({
      success: true,
      stats: {
        total_products: totalProducts,
        active_products: activeProducts,
        total_orders: totalOrders,
        pending_orders: pendingOrders,
        channels: totalChannels,
        active_channels: activeChannels,
        last_sync: lastSync
      }
    });

  } catch (error: any) {
    request.log.error(error, "Error getting dashboard stats");
    return reply.code(500).send({
      success: false,
      message: "Error obteniendo estadísticas del dashboard"
    });
  }
});

// Temporary admin route to add stock column
app.post("/admin/add-stock-column", async (req, reply) => {
  try {
    const { supabase } = await import("./supabaseClient");

    // Test if stock column exists by trying to select it
    const { data, error } = await supabase
      .from('products')
      .select('id, stock')
      .eq('account_id', '725bc8b2-25c0-40a3-b0cb-4315dce06097')
      .limit(5);

    if (error) {
      return reply.status(500).send({
        success: false,
        error: error.message,
        message: "Stock column may not exist. Please run this SQL manually in Supabase dashboard:",
        sql: "ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0;"
      });
    }

    return reply.send({
      success: true,
      message: "Stock column exists. Sample data:",
      sample_data: data
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, error: error.message });
  }
});

// Admin route to sync stock and price from staging
app.post("/admin/sync-stock-price", async (req, reply) => {
  try {
    const { action } = req.body as { action: string };

    if (action === 'update_stock_price') {
      return reply.send({
        success: true,
        message: "Please run this SQL manually in Supabase dashboard:",
        sql: `
-- Sincronizar stock y precio desde staging a products
UPDATE products p
SET stock = cps.stock,
    price = cps.price
FROM channel_products_staging cps
WHERE p.id = cps.imported_product_id
  AND p.account_id = cps.account_id
  AND cps.status = 'imported';
        `.trim()
      });

    } else if (action === 'verify_sync') {
      return reply.send({
        success: true,
        message: "Please run this SQL manually in Supabase dashboard:",
        sql: `
-- Verificar que el stock se actualizó
SELECT p.name, p.sku, p.stock, p.price, cps.stock as staging_stock, cps.price as staging_price
FROM products p
JOIN channel_products_staging cps ON p.id = cps.imported_product_id AND p.account_id = cps.account_id
WHERE p.account_id = '725bc8b2-25c0-40a3-b0cb-4315dce06097'
LIMIT 10;
        `.trim()
      });
    }

    return reply.status(400).send({ success: false, error: "Invalid action" });

  } catch (error: any) {
    return reply.status(500).send({ success: false, error: error.message });
  }
});

authRoutes(app);
accountsRoutes(app);
orderRoutes(app);
productRoutes(app);
inventoriesRoutes(app);
channelsRoutes(app);
shopifyRoutes(app);
erpRoutes(app);
syncRoutes(app);
registerShopifyAuthRoutes(app);
registerShopifyTestRoutes(app);
registerShopifyIntegrationRoutes(app);
registerShopifyWebhooksRoutes(app);

const port = Number(process.env.PORT) || 4000;

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    console.log(`🚀 Fluxi backend running on port ${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });