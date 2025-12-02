import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export async function registerShopifyWebhooksRoutes(app: FastifyInstance) {
  // POST /webhooks/shopify/products_update
  app.post(
    "/webhooks/shopify/products_update",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = request.body as any;

      // TODO: Validar HMAC del webhook usando X-Shopify-Hmac-Sha256 header
      // const hmac = request.headers['x-shopify-hmac-sha256'] as string;
      // Validar usando crypto.createHmac('sha256', SHOPIFY_API_SECRET)

      request.log.info({ payload }, "Webhook products_update recibido");

      // TODO: Procesar actualización de producto
      // - Buscar producto por external_id
      // - Actualizar datos en products/product_variants
      // - Invalidar caches si existen

      return reply.send({ success: true });
    }
  );

  // POST /webhooks/shopify/orders_create
  app.post(
    "/webhooks/shopify/orders_create",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = request.body as any;

      request.log.info({ payload }, "Webhook orders_create recibido");

      // TODO: Procesar nueva orden
      // - Crear registro en orders
      // - Crear order_items
      // - Actualizar inventario si es necesario
      // - Notificar otros sistemas

      return reply.send({ success: true });
    }
  );

  // POST /webhooks/shopify/inventory_levels_update
  app.post(
    "/webhooks/shopify/inventory_levels_update",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = request.body as any;

      request.log.info({ payload }, "Webhook inventory_levels_update recibido");

      // TODO: Procesar actualización de inventario
      // - Actualizar inventory_stock_items
      // - Sincronizar con otros canales

      return reply.send({ success: true });
    }
  );

  // POST /webhooks/shopify/app_uninstalled
  app.post(
    "/webhooks/shopify/app_uninstalled",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = request.body as any;

      request.log.info({ payload }, "Webhook app_uninstalled recibido");

      // TODO: Manejar desinstalación de la app
      // - Marcar shop como inactivo
      // - Limpiar datos si es necesario
      // - Cancelar suscripciones

      return reply.send({ success: true });
    }
  );
}