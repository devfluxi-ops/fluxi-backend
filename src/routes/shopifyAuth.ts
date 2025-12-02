import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "crypto";
import { upsertShop, getShopByDomain } from "../services/shopifyService";
import { getUserFromRequest } from "../utils/auth";

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
  const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test-key';
  const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test-secret';
  const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || 'read_products';
  const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL || 'https://fluxi-backend.onrender.com';
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'; // Default to localhost for development

  if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET || !process.env.SHOPIFY_SCOPES || !process.env.SHOPIFY_APP_URL) {
    app.log.warn("Shopify environment variables not configured - using defaults for testing");
    // Continue with defaults for testing, but routes will fail gracefully
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

        // ✅ Redirigir al panel principal de Fluxi (dashboard)
        // El dashboard debe manejar la configuración del canal Shopify
        const dashboardUrl = `${FRONTEND_URL}/channels/shopify/setup?shop=${shop}&token=${accessToken}`;
        return reply.redirect(dashboardUrl);

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
    const query = request.query as {
      shop?: string;
      embedded?: string;
      hmac?: string;
      host?: string;
      id_token?: string;
      locale?: string;
      session?: string;
      timestamp?: string;
      [key: string]: any;
    };

    const { shop } = query;

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
            .badge.error {
              background: rgba(239, 68, 68, 0.1);
              color: #ef4444;
              border: 1px solid rgba(239, 68, 68, 0.3);
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
              transition: all 0.2s;
            }
            .btn:hover {
              transform: translateY(-1px);
            }
            .btn:disabled {
              opacity: 0.5;
              cursor: not-allowed;
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
            .status {
              margin-top: 12px;
              padding: 8px;
              border-radius: 8px;
              font-size: 12px;
              display: none;
            }
            .status.success {
              background: rgba(34, 197, 94, 0.1);
              color: #4ade80;
              border: 1px solid rgba(34, 197, 94, 0.3);
            }
            .status.error {
              background: rgba(239, 68, 68, 0.1);
              color: #ef4444;
              border: 1px solid rgba(239, 68, 68, 0.3);
            }
            .loading {
              display: inline-block;
              width: 12px;
              height: 12px;
              border: 2px solid #e5e7eb;
              border-radius: 50%;
              border-top-color: #22c55e;
              animation: spin 1s ease-in-out infinite;
              margin-right: 8px;
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <main class="card">
            <div class="badge" id="statusBadge">Fluxi conectado</div>
            <h1>Fluxi – Multichannel Sync</h1>
            <p>La tienda <strong>${shop ?? 'Shopify store'}</strong> está conectada correctamente a Fluxi.</p>
            <p>Desde aquí vas a poder sincronizar productos, inventario y órdenes entre tus canales.</p>

            <div class="actions">
              <button class="btn btn-primary" onclick="syncProducts()">
                <span id="syncIcon" style="display:none;"><div class="loading"></div></span>
                Sincronizar Productos
              </button>
              <button class="btn btn-secondary" onclick="openFluxiPanel()">
                Abrir panel Fluxi
              </button>
            </div>

            <div id="statusMessage" class="status"></div>
          </main>

          <script>
            const shopDomain = '${shop ?? ''}';
            const baseUrl = window.location.origin;

            async function syncProducts() {
              if (!shopDomain) {
                showStatus('error', 'Dominio de tienda no disponible');
                return;
              }

              const btn = document.querySelector('.btn-primary');
              const icon = document.getElementById('syncIcon');
              const originalText = btn.innerHTML;

              // Show loading
              btn.disabled = true;
              icon.style.display = 'inline-block';
              btn.innerHTML = icon.outerHTML + 'Sincronizando...';

              try {
                const response = await fetch(\`\${baseUrl}/shopify/products/import\`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ shop: shopDomain })
                });

                const data = await response.json();

                if (data.success) {
                  showStatus('success', \`Se sincronizaron \${data.count} productos correctamente\`);
                  updateBadge('success', 'Sincronización exitosa');
                } else {
                  showStatus('error', data.message || 'Error en sincronización');
                  updateBadge('error', 'Error de sincronización');
                }
              } catch (error) {
                console.error('Sync error:', error);
                showStatus('error', 'Error de conexión');
                updateBadge('error', 'Error de conexión');
              } finally {
                // Reset button
                btn.disabled = false;
                icon.style.display = 'none';
                btn.innerHTML = originalText;
              }
            }

            function openFluxiPanel() {
              // Open main Fluxi panel with shop context
              const fluxiUrl = \`${FRONTEND_URL}?shop=\${encodeURIComponent(shopDomain)}\`;
              window.open(fluxiUrl, '_blank');
            }

            function showStatus(type, message) {
              const statusEl = document.getElementById('statusMessage');
              statusEl.className = \`status \${type}\`;
              statusEl.textContent = message;
              statusEl.style.display = 'block';

              // Auto-hide after 5 seconds
              setTimeout(() => {
                statusEl.style.display = 'none';
              }, 5000);
            }

            function updateBadge(type, message) {
              const badge = document.getElementById('statusBadge');
              badge.className = \`badge \${type === 'error' ? 'error' : ''}\`;
              badge.textContent = message;
            }

            // Check if shop is connected on load
            window.addEventListener('load', async () => {
              if (!shopDomain) {
                updateBadge('error', 'Tienda no conectada');
                showStatus('error', 'Esta tienda no está conectada a Fluxi aún');
                return;
              }

              try {
                // Test connection by checking if shop exists
                const response = await fetch(\`\${baseUrl}/shopify/test?shop=\${encodeURIComponent(shopDomain)}\`);
                const data = await response.json();

                if (data.success) {
                  updateBadge('success', 'Tienda conectada');
                } else {
                  updateBadge('error', 'Tienda no conectada');
                  showStatus('error', 'La tienda no está conectada. Contacta soporte.');
                }
              } catch (error) {
                updateBadge('error', 'Error de conexión');
                showStatus('error', 'Error verificando conexión');
              }
            });
          </script>
        </body>
      </html>
    `;

    return reply.send(html);
  });

  // 🔹 RUTA PARA GENERAR LINK DE INSTALACIÓN (desde dashboard)
  app.get('/channels/shopify/install-link', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Validate authentication
      const user = getUserFromRequest(request);

      const { shop } = request.query as { shop?: string };

      if (!shop) {
        return reply.code(400).send({ success: false, message: 'Parámetro shop requerido' });
      }

    // Verificar que la tienda no esté ya conectada
    try {
      const existingShop = await getShopByDomain(shop);
      if (existingShop) {
        return reply.send({
          success: true,
          shop,
          status: 'already_connected',
          message: 'Esta tienda ya está conectada',
          connected_at: existingShop.installed_at
        });
      }
    } catch (error) {
      // Ignorar errores de BD por ahora
    }

    // Generar URL de instalación
    const installUrl = `${request.protocol}://${request.hostname}/auth/shopify?shop=${shop}`;

    return reply.send({
      success: true,
      shop,
      install_url: installUrl,
      status: 'ready_to_install',
      message: 'Comparte este link con el propietario de la tienda Shopify'
    });
    } catch (error: any) {
      return reply.code(401).send({ success: false, message: 'Authentication required' });
    }
  });

  // 🔹 RUTA PARA VERIFICAR ESTADO DE CONEXIÓN
  app.get('/channels/shopify/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Validate authentication
      const user = getUserFromRequest(request);

      const { shop } = request.query as { shop?: string };

      if (!shop) {
        return reply.code(400).send({ success: false, message: 'Parámetro shop requerido' });
      }

    try {
      const shopRecord = await getShopByDomain(shop);

      if (shopRecord) {
        return reply.send({
          success: true,
          shop,
          status: 'connected',
          connected_at: shopRecord.installed_at,
          last_sync: shopRecord.last_sync,
          scopes: shopRecord.scope
        });
      } else {
        return reply.send({
          success: true,
          shop,
          status: 'not_connected',
          message: 'Tienda no conectada aún'
        });
      }
    } catch (error) {
      return reply.code(500).send({
        success: false,
        message: 'Error verificando estado de conexión'
      });
    }
    } catch (error: any) {
      return reply.code(401).send({ success: false, message: 'Authentication required' });
    }
  });
}