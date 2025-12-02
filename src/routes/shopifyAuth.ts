import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "crypto";
import { supabase } from "../supabaseClient";

type InstallQuery = {
  shop: string;              // dominio .myshopify.com
};

type CallbackQuery = {
  shop: string;
  code: string;
  hmac: string;
  state?: string;
  [key: string]: any;
};

export async function registerShopifyAuthRoutes(app: FastifyInstance) {
  const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
  const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;
  const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES!;
  const SHOPIFY_REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI!;

  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !SHOPIFY_SCOPES || !SHOPIFY_REDIRECT_URI) {
    app.log.error("Faltan variables de entorno de Shopify");
  }

  // 🔹 1. Iniciar instalación: redirigir a Shopify OAuth
  // GET /auth/shopify/install?shop=enohfit.myshopify.com
  app.get(
    "/auth/shopify/install",
    async (
      request: FastifyRequest<{ Querystring: InstallQuery }>,
      reply: FastifyReply
    ) => {
      const { shop } = request.query;

      if (!shop || !shop.endsWith(".myshopify.com")) {
        return reply.code(400).send({ success: false, message: "Parámetro 'shop' inválido" });
      }

      const state = crypto.randomBytes(16).toString("hex"); // para CSRF si luego quieres guardarlo

      const installUrl =
        `https://${shop}/admin/oauth/authorize` +
        `?client_id=${SHOPIFY_API_KEY}` +
        `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
        `&redirect_uri=${encodeURIComponent(SHOPIFY_REDIRECT_URI)}` +
        `&state=${state}`;

      return reply.redirect(installUrl);
    }
  );

  // 🔹 2. Callback de Shopify: aquí llega el code
  // GET /auth/shopify/callback?shop=...&code=...&hmac=...
  app.get(
    "/auth/shopify/callback",
    async (
      request: FastifyRequest<{ Querystring: CallbackQuery }>,
      reply: FastifyReply
    ) => {
      const query = request.query;
      const { shop, code, hmac } = query;

      if (!shop || !code || !hmac) {
        return reply
          .code(400)
          .send({ success: false, message: "Faltan parámetros 'shop', 'code' o 'hmac'" });
      }

      // ✅ Validar HMAC de Shopify (seguridad)
      const { hmac: _hmac, signature, ...rest } = query as any;

      const message = Object.keys(rest)
        .sort()
        .map((key) => `${key}=${rest[key]}`)
        .join("&");

      const generatedHmac = crypto
        .createHmac("sha256", SHOPIFY_API_SECRET)
        .update(message)
        .digest("hex");

      if (generatedHmac !== hmac) {
        request.log.error({ hmac, generatedHmac }, "HMAC inválido en callback de Shopify");
        return reply.code(400).send({ success: false, message: "HMAC inválido" });
      }

      // 🔁 Intercambiar code por access_token
      const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: SHOPIFY_API_KEY,
          client_secret: SHOPIFY_API_SECRET,
          code,
        }),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        request.log.error({ text }, "Error al obtener access_token de Shopify");
        return reply
          .code(500)
          .send({ success: false, message: "No se pudo obtener access_token de Shopify" });
      }

      const tokenJson = (await tokenRes.json()) as {
        access_token: string;
        scope: string;
      };

      const accessToken = tokenJson.access_token;
      const scopes = tokenJson.scope;

      // 💾 Guardar / actualizar en Supabase
      const { data, error } = await supabase
        .from("shopify_shops")
        .upsert(
          {
            shop_domain: shop,
            access_token: accessToken,
            scopes,
            status: "active",
          },
          { onConflict: "shop_domain" }
        )
        .select("*")
        .single();

      if (error) {
        request.log.error(error, "Error guardando tienda Shopify en BD");
        return reply
          .code(500)
          .send({ success: false, message: "Error guardando tienda Shopify en BD" });
      }

      // 👌 Respuesta simple (luego puedes redirigir al panel de Fluxi)
      return reply.send({
        success: true,
        message: "Tienda Shopify conectada correctamente",
        shop: data.shop_domain,
      });
    }
  );
}