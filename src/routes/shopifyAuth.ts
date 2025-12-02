import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "crypto";
import { upsertShop } from "../services/shopifyService";

type InstallQuery = {
  shop: string;              // dominio .myshopify.com
};

type CallbackQuery = {
  shop: string;
  code: string;
  hmac: string;
  state?: string;
  host?: string;
  [key: string]: any;
};

export async function registerShopifyAuthRoutes(app: FastifyInstance) {
  const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
  const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
  const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES;
  const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL;

  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !SHOPIFY_SCOPES || !SHOPIFY_APP_URL) {
    app.log.warn("Shopify environment variables not configured - Shopify routes disabled");
    return; // Skip registration if env vars are missing
  }

  // 🔹 1. Iniciar instalación: redirigir a Shopify OAuth
  // GET /auth/shopify?shop=enohfit.myshopify.com
  app.get(
    "/auth/shopify",
    async (
      request: FastifyRequest<{ Querystring: InstallQuery }>,
      reply: FastifyReply
    ) => {
      const { shop } = request.query;

      if (!shop || !shop.endsWith(".myshopify.com")) {
        return reply.code(400).send({ success: false, message: "Parámetro 'shop' inválido" });
      }

      // TODO: Store state in database/session for CSRF protection
      const state = crypto.randomBytes(16).toString("hex");

      const redirectUri = `${SHOPIFY_APP_URL}/auth/shopify/callback`;
      const installUrl =
        `https://${shop}/admin/oauth/authorize` +
        `?client_id=${SHOPIFY_API_KEY}` +
        `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${state}`;

      return reply.redirect(installUrl);
    }
  );

  // 🔹 2. Callback de Shopify: aquí llega el code
  // GET /auth/shopify/callback?shop=...&code=...&hmac=...&host=...
  app.get(
    "/auth/shopify/callback",
    async (
      request: FastifyRequest<{ Querystring: CallbackQuery }>,
      reply: FastifyReply
    ) => {
      const query = request.query;
      const { shop, code, hmac, host } = query;

      if (!shop || !code || !hmac) {
        return reply
          .code(400)
          .send({ success: false, message: "Faltan parámetros requeridos: shop, code, hmac" });
      }

      try {
        // ✅ Validar HMAC de Shopify (seguridad)
        const { hmac: _hmac, ...paramsToVerify } = query as any;

        const message = Object.keys(paramsToVerify)
          .sort()
          .map((key) => `${key}=${paramsToVerify[key]}`)
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
          request.log.error({ text }, "Error obteniendo access_token de Shopify");
          return reply
            .code(500)
            .send({ success: false, message: "No se pudo obtener access_token de Shopify" });
        }

        const tokenJson = (await tokenRes.json()) as {
          access_token: string;
          scope: string;
        };

        const accessToken = tokenJson.access_token;
        const scope = tokenJson.scope;

        // 💾 Guardar / actualizar tienda en Supabase
        await upsertShop({
          shopDomain: shop,
          accessToken,
          scope,
        });

        // ✅ Redirigir a la app embebida
        const appUrl = `${SHOPIFY_APP_URL}/app?shop=${shop}${host ? `&host=${host}` : ''}`;
        return reply.redirect(appUrl);

      } catch (error: any) {
        request.log.error(error, "Error en callback de Shopify");
        return reply
          .code(500)
          .send({ success: false, message: "Error interno del servidor" });
      }
    }
  );

  // 🔹 RUTA PARA EL FRONT EMBEBIDO EN SHOPIFY
  app.get('/app', async (request: FastifyRequest, reply: FastifyReply) => {
    const { shop } = request.query as { shop?: string };

    reply.type('text/html; charset=utf-8');

    const html = `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <title>Fluxi – Multichannel Sync</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body {
              margin: 0;
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              background: #020617;
              color: #e5e7eb;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
            }
            .card {
              background: radial-gradient(circle at top left, #1d4ed8, #020617);
              border-radius: 16px;
              padding: 24px 28px;
              max-width: 520px;
              width: 100%;
              box-shadow: 0 18px 45px rgba(15, 23, 42, 0.8);
              border: 1px solid rgba(148, 163, 184, 0.35);
            }
            h1 {
              font-size: 22px;
              margin: 0 0 8px 0;
            }
            p {
              margin: 6px 0;
              font-size: 14px;
              color: #cbd5f5;
            }
            .badge {
              display: inline-flex;
              align-items: center;
              padding: 2px 8px;
              border-radius: 999px;
              font-size: 11px;
              background: rgba(22, 163, 74, 0.1);
              color: #4ade80;
              border: 1px solid rgba(34, 197, 94, 0.3);
              margin-bottom: 10px;
            }
            .actions {
              margin-top: 18px;
              display: flex;
              gap: 10px;
            }
            .btn {
              padding: 8px 14px;
              border-radius: 999px;
              border: none;
              cursor: pointer;
              font-size: 13px;
              font-weight: 500;
            }
            .btn-primary {
              background: #22c55e;
              color: #022c22;
            }
            .btn-secondary {
              background: transparent;
              color: #e5e7eb;
              border: 1px solid rgba(148, 163, 184, 0.5);
            }
          </style>
        </head>
        <body>
          <main class="card">
            <div class="badge">Fluxi conectado</div>
            <h1>Fluxi – Multichannel Sync</h1>
            <p>La tienda <strong>${shop ?? 'Shopify store'}</strong> está conectada correctamente a Fluxi.</p>
            <p>Desde aquí vas a poder sincronizar productos, inventario y órdenes entre tus canales.</p>

            <div class="actions">
              <button class="btn btn-primary" onclick="window.location.reload()">
                Actualizar estado
              </button>
              <button class="btn btn-secondary" onclick="window.open('https://app.fluxi.com', '_blank')">
                Abrir panel Fluxi
              </button>
            </div>
          </main>
        </body>
      </html>
    `;

    return reply.send(html);
  });
}