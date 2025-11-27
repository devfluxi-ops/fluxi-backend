import Fastify from "fastify";
import dotenv from "dotenv";
import cors from "@fastify/cors";
import { authRoutes } from "./routes/auth";
import { orderRoutes } from "./routes/orders";
import { productRoutes } from "./routes/products";
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

authRoutes(app);
orderRoutes(app);
productRoutes(app);
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