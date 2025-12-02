import Fastify from "fastify";
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

dotenv.config();

const app = Fastify({ logger: true });

app.register(cors, {
  origin: "*", // en el futuro lo restringimos a tu dominio de Vercel
});

app.get("/health", async () => {
  return { status: "ok", service: "fluxi-backend" };
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