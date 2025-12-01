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

      let products: any[] = [];

      if (include_channels === 'true') {
        // Use the view that includes channels
        const { data, error } = await supabase
          .from('view_products_with_channels')
          .select('*')
          .eq('account_id', account_id)
          .order('name', { ascending: true });

        if (error) {
          request.log.error(error);
          return reply.status(500).send({
            success: false,
            message: 'Error fetching products with channels',
            error: error.message
          });
        }

        products = data || [];
      } else {
        // Use products table directly
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('account_id', account_id)
          .order('name', { ascending: true });

        if (error) {
          request.log.error(error);
          return reply.status(500).send({
            success: false,
            message: 'Error fetching products',
            error: error.message
          });
        }

        // Add empty channels array for consistency
        products = (data || []).map(product => ({
          ...product,
          channels: []
        }));
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