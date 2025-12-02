import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { syncShopifyProducts, syncShopifyInventory } from "../services/shopifySyncService";
import { getUserFromRequest } from "../utils/auth";

interface SyncBody {
  shop: string;      // fluxi-test-app.myshopify.com
  account_id: string; // id de la cuenta dueña del canal
}

export async function registerShopifyIntegrationRoutes(app: FastifyInstance) {
  // POST /shopify/products/import
  app.post(
    "/shopify/products/import",
    async (request: FastifyRequest<{ Body: SyncBody }>, reply: FastifyReply) => {
      try {
        // Validate authentication
        const user = getUserFromRequest(request);

        const { shop, account_id } = request.body;

        if (!shop || !account_id) {
          return reply.status(400).send({
            success: false,
            message: "shop y account_id son requeridos",
          });
        }

        // Verificar que el usuario pertenece a la cuenta
        if (user.account_id !== account_id) {
          return reply.status(403).send({
            success: false,
            message: "No tienes acceso a esta cuenta",
          });
        }

        const result = await syncShopifyProducts({
          accountId: account_id,
          shopDomain: shop,
        });

        return reply.send({
          success: true,
          imported: result.imported,
          products: result.products,
          message: `Se importaron ${result.imported} productos desde Shopify`,
        });
      } catch (error: any) {
        if (error.message?.includes('Authentication required')) {
          return reply.code(401).send({ success: false, message: 'Authentication required' });
        }
        request.log.error(error, "Error sincronizando productos de Shopify");
        return reply.code(500).send({
          success: false,
          message: "Error al sincronizar productos desde Shopify",
          error: error.message
        });
      }
    }
  );

  // POST /shopify/inventory/sync
  app.post(
    "/shopify/inventory/sync",
    async (request: FastifyRequest<{ Body: SyncBody }>, reply: FastifyReply) => {
      try {
        // Validate authentication
        const user = getUserFromRequest(request);

        const { shop, account_id } = request.body;

        if (!shop || !account_id) {
          return reply.status(400).send({
            success: false,
            message: "shop y account_id son requeridos",
          });
        }

        // Verificar que el usuario pertenece a la cuenta
        if (user.account_id !== account_id) {
          return reply.status(403).send({
            success: false,
            message: "No tienes acceso a esta cuenta",
          });
        }

        const result = await syncShopifyInventory({
          accountId: account_id,
          shopDomain: shop,
        });

        return reply.send({
          success: true,
          updated: result.updated,
          message: `Se actualizaron ${result.updated} niveles de inventario desde Shopify`,
        });
      } catch (error: any) {
        if (error.message?.includes('Authentication required')) {
          return reply.code(401).send({ success: false, message: 'Authentication required' });
        }
        request.log.error(error, "Error sincronizando inventario de Shopify");
        return reply.code(500).send({
          success: false,
          message: "Error al sincronizar inventario desde Shopify",
          error: error.message
        });
      }
    }
  );
}