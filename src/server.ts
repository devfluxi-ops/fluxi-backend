import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import dotenv from "dotenv";

dotenv.config();

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", service: "fluxi-backend", version: "3.0" });
});

// Placeholder routes - will be implemented
app.get("/auth/me", (c) => c.json({ message: "Auth endpoint - TODO" }));
app.get("/accounts", (c) => c.json({ message: "Accounts endpoint - TODO" }));
app.get("/products", (c) => c.json({ message: "Products endpoint - TODO" }));
app.get("/channels", (c) => c.json({ message: "Channels endpoint - TODO" }));

// Export for serverless deployment
export default app;

// For local development with Node adapter
import { serve } from "@hono/node-server";

const port = Number(process.env.PORT) || 4000;
console.log(`🚀 Fluxi 3.0 backend running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});