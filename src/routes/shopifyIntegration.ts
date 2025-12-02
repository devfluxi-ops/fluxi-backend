import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getShopByDomain, shopifyRequest, updateShopLastSync } from "../services/shopifyService";

type ImportProductsBody = {
  shop: string;
};

type SyncInventoryBody = {
  shop: string;
};

export async function registerShopifyIntegrationRoutes(app: FastifyInstance) {
  // POST /shopify/products/import
  app.post(
    "/shopify/products/import",
    async (
      request: FastifyRequest<{ Body: ImportProductsBody }>,
      reply: FastifyReply
    ) => {
      const { shop } = request.body;

      if (!shop) {
        return reply.code(400).send({ success: false, message: "Parámetro 'shop' requerido" });
      }

      try {
        // 1. Buscar la tienda en Supabase
        const shopRecord = await getShopByDomain(shop);
        if (!shopRecord) {
          return reply.code(400).send({
            success: false,
            message: "Tienda no conectada. Instala la app primero."
          });
        }

        // 2. Llamar a Shopify API para obtener productos
        const productsResponse = await shopifyRequest<any>(
          shopRecord.shop_domain,
          shopRecord.access_token,
          'GET',
          '/products.json?limit=250'
        );

        const products = productsResponse.products || [];
        const count = products.length;

        // TODO: Mapear productos a las tablas internas de Fluxi
        // - Crear registros en channel_products_staging
        // - Mapear a products, product_variants, etc.
        // - Manejar imágenes, categorías, etc.

        // 3. Actualizar last_sync
        await updateShopLastSync(shopRecord.shop_domain);

        // 4. Responder con resumen
        return reply.send({
          success: true,
          count,
          products: products.slice(0, 5), // Mostrar primeros 5 como ejemplo
          message: `Se encontraron ${count} productos en Shopify`
        });

      } catch (error: any) {
        request.log.error(error, "Error importando productos de Shopify");
        return reply.code(500).send({
          success: false,
          message: "Error importando productos",
          error: error.message
        });
      }
    }
  );

  // POST /shopify/inventory/sync
  app.post(
    "/shopify/inventory/sync",
    async (
      request: FastifyRequest<{ Body: SyncInventoryBody }>,
      reply: FastifyReply
    ) => {
      const { shop } = request.body;

      if (!shop) {
        return reply.code(400).send({ success: false, message: "Parámetro 'shop' requerido" });
      }

      try {
        // 1. Buscar la tienda en Supabase
        const shopRecord = await getShopByDomain(shop);
        if (!shopRecord) {
          return reply.code(400).send({
            success: false,
            message: "Tienda no conectada. Instala la app primero."
          });
        }

        // 2. Llamar a Shopify API para obtener niveles de inventario
        const inventoryResponse = await shopifyRequest<any>(
          shopRecord.shop_domain,
          shopRecord.access_token,
          'GET',
          '/inventory_levels.json?limit=250'
        );

        const inventoryLevels = inventoryResponse.inventory_levels || [];
        const count = inventoryLevels.length;

        // TODO: Sincronizar inventario con las tablas internas de Fluxi
        // - Actualizar inventory_stock_items
        // - Mapear inventory_item_id a product_variant_id
        // - Manejar warehouses/inventories

        // 3. Actualizar last_sync
        await updateShopLastSync(shopRecord.shop_domain);

        // 4. Responder con resumen
        return reply.send({
          success: true,
          count,
          inventory: inventoryLevels.slice(0, 5), // Mostrar primeros 5 como ejemplo
          message: `Se encontraron ${count} niveles de inventario en Shopify`
        });

      } catch (error: any) {
        request.log.error(error, "Error sincronizando inventario de Shopify");
        return reply.code(500).send({
          success: false,
          message: "Error sincronizando inventario",
          error: error.message
        });
      }
    }
  );
}