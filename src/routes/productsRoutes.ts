import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { supabase } from "../supabaseClient";

export async function registerProductsRoutes(app: FastifyInstance) {
  // GET /products - List products for account
  app.get('/products', async (request: FastifyRequest<{ Querystring: { account_id: string; include_channels?: string } }>, reply: FastifyReply) => {
    try {
      const { account_id, include_channels } = request.query;

      if (!account_id) {
        return reply.status(400).send({
          success: false,
          message: 'account_id is required'
        });
      }

      // 1) Fetch products
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('id, account_id, name, sku, description, price, currency, status, created_at, updated_at')
        .eq('account_id', account_id)
        .order('created_at', { ascending: false });

      if (productsError) {
        request.log.error(productsError);
        return reply.status(500).send({
          success: false,
          message: 'Error fetching products',
          error: productsError.message
        });
      }

      let products = productsData || [];

      // 2) If include_channels, fetch links from channel_products
      if (include_channels === 'true' && products.length > 0) {
        const productIds = products.map((p) => p.id);

        const { data: links, error: linksError } = await supabase
          .from('channel_products')
          .select(`
            product_id,
            channel_id,
            external_id,
            external_sku,
            synced_at,
            sync_status,
            channels (
              name,
              channel_type_id,
              channel_types (
                id,
                name
              )
            )
          `)
          .in('product_id', productIds);

        if (linksError) {
          request.log.error(linksError);
          return reply.status(500).send({
            success: false,
            message: 'Error fetching channels for products',
            error: linksError.message
          });
        }

        const byProduct = new Map<string, any[]>();
        for (const link of links || []) {
          const channelInfo: any = (link as any).channels || {};
          const channelType = channelInfo?.channel_type_id || channelInfo?.channel_types?.[0]?.id || channelInfo?.channel_types?.[0]?.name || null;
          const list = byProduct.get(link.product_id) || [];
          list.push({
            channel_id: link.channel_id,
            channel_name: channelInfo?.name ?? null,
            channel_type: channelType,
            external_id: link.external_id,
            external_sku: link.external_sku,
            synced_at: (link as any).synced_at || null,
            sync_status: (link as any).sync_status || null
          });
          byProduct.set(link.product_id, list);
        }

        products = products.map((p) => ({
          ...p,
          channels: byProduct.get(p.id) || []
        }));
      } else {
        products = products.map((p) => ({ ...p, channels: [] }));
      }

      return reply.send({
        success: true,
        products,
        total: products.length
      });
    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  });
}
