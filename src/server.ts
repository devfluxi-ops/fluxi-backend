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
    const { supabaseAdmin } = await import("./supabaseClient");

    // Try to execute raw SQL using admin client
    // Note: This might not work, but let's try
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('id')
      .limit(1);

    if (error) {
      return reply.status(500).send({ success: false, error: error.message });
    }

    return reply.send({
      success: true,
      message: "Database connection OK. Please run this SQL manually in Supabase dashboard:",
      sql: "ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0;"
    });
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