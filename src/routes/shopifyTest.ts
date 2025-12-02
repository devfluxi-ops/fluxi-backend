import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { supabase } from "../supabaseClient";
import { createShopifyClient } from "../services/shopifyClient";

export async function registerShopifyTestRoutes(app: FastifyInstance) {
  // GET /shopify/test?shop=enohfit.myshopify.com
  app.get(
    "/shopify/test",
    async (
      request: FastifyRequest<{ Querystring: { shop: string } }>,
      reply: FastifyReply
    ) => {
      const { shop } = request.query;

      const { data, error } = await supabase
        .from("shopify_shops")
        .select("*")
        .eq("shop_domain", shop)
        .single();

      if (error || !data) {
        return reply.code(404).send({ success: false, message: "Shopify shop no encontrada" });
      }

      const client = createShopifyClient(data.shop_domain, data.access_token);
      const products = await client.getProducts();

      return reply.send({ success: true, products });
    }
  );
}