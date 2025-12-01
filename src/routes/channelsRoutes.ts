import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { supabase } from "../supabaseClient";

export async function registerChannelsRoutes(app: FastifyInstance) {
  // GET /channels - List channels for account
  app.get('/channels', async (request: FastifyRequest<{ Querystring: { account_id: string } }>, reply: FastifyReply) => {
    try {
      const { account_id } = request.query;

      if (!account_id) {
        return reply.status(400).send({
          success: false,
          message: 'account_id is required'
        });
      }

      const { data, error } = await supabase
        .from('channels')
        .select(`
          id,
          account_id,
          name,
          status,
          channel_type_id,
          channel_types(name)
        `)
        .eq('account_id', account_id)
        .order('created_at', { ascending: false });

      if (error) {
        request.log.error(error);
        return reply.status(500).send({
          success: false,
          message: 'Error fetching channels',
          error: error.message
        });
      }

      // Map channel_types.name to channel_type_name
      const channels = (data || []).map(channel => ({
        id: channel.id,
        account_id: channel.account_id,
        name: channel.name,
        status: channel.status,
        channel_type_id: channel.channel_type_id,
        channel_type_name: channel.channel_types?.[0]?.name ?? "Unknown"
      }));

      return reply.send({
        success: true,
        channels,
        total: channels.length
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

  // POST /channels/:channelId/sync - Sync products from Siigo
  app.post('/channels/:channelId/sync', async (request: FastifyRequest<{ Params: { channelId: string } }>, reply: FastifyReply) => {
    try {
      const { channelId } = request.params;

      // Get channel details
      const { data: channel, error: channelError } = await supabase
        .from('channels')
        .select('id, account_id, channel_type_id, config')
        .eq('id', channelId)
        .single();

      if (channelError || !channel) {
        return reply.status(404).send({
          success: false,
          message: 'Channel not found'
        });
      }

      if (channel.channel_type_id !== 'siigo') {
        return reply.status(400).send({
          success: false,
          message: 'Only Siigo channels are supported for sync for now'
        });
      }

      const { username, api_key, partner_id } = channel.config || {};

      if (!username || !api_key) {
        return reply.status(400).send({
          success: false,
          message: 'Siigo credentials not configured'
        });
      }

      // Authenticate with Siigo
      const authResponse = await fetch('https://api.siigo.com/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username,
          access_key: api_key
        })
      });

      if (!authResponse.ok) {
        const errorText = await authResponse.text();
        await supabase
          .from('channels')
          .update({
            status: 'error',
            last_error: `Authentication failed: ${authResponse.status} ${errorText}`
          })
          .eq('id', channelId);

        await supabase
          .from('sync_logs')
          .insert({
            account_id: channel.account_id,
            channel_id: channelId,
            operation: 'product_sync',
            payload: { error: 'authentication_failed' },
            status: 'error'
          });

        return reply.status(502).send({
          success: false,
          message: 'Failed to authenticate with Siigo'
        });
      }

      const { access_token } = await authResponse.json();

      if (!access_token) {
        return reply.status(502).send({
          success: false,
          message: 'No access token received from Siigo'
        });
      }

      // Fetch products from Siigo
      const siigoResponse = await fetch('https://api.siigo.com/v1/products?page_size=100', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json',
          ...(partner_id ? { 'Partner-Id': partner_id } : {})
        }
      });

      if (!siigoResponse.ok) {
        const errorText = await siigoResponse.text();
        await supabase
          .from('channels')
          .update({
            status: 'error',
            last_error: `Products fetch failed: ${siigoResponse.status} ${errorText}`
          })
          .eq('id', channelId);

        await supabase
          .from('sync_logs')
          .insert({
            account_id: channel.account_id,
            channel_id: channelId,
            operation: 'product_sync',
            payload: { error: 'products_fetch_failed' },
            status: 'error'
          });

        return reply.status(502).send({
          success: false,
          message: 'Failed to fetch products from Siigo'
        });
      }

      const siigoData = await siigoResponse.json();
      const results = siigoData.results || [];
      let syncedCount = 0;

      // Process each Siigo product
      for (const sp of results) {
        try {
          // Extract price
          const price = sp?.prices?.[0]?.price_list?.[0]?.value != null
            ? Number(sp.prices[0].price_list[0].value)
            : 0;

          // Upsert product
          const { data: product, error: upsertError } = await supabase
            .from('products')
            .upsert(
              {
                account_id: channel.account_id,
                sku: sp.code,
                name: sp.name,
                price,
                description: sp.description,
                status: sp.active ? 'active' : 'inactive'
              },
              { onConflict: 'account_id,sku' }
            )
            .select('id')
            .single();

          if (upsertError) {
            console.error('Error upserting product:', upsertError);
            continue;
          }

          // Upsert channel product link
          const { error: linkError } = await supabase
            .from('channel_products')
            .upsert(
              {
                product_id: product.id,
                channel_id: channel.id,
                external_id: sp.id,
                external_sku: sp.code,
                synced_at: new Date().toISOString(),
                sync_status: 'synced',
                last_error: null
              },
              { onConflict: 'product_id,channel_id' }
            );

          if (linkError) {
            console.error('Error upserting channel product:', linkError);
            continue;
          }

          syncedCount++;
        } catch (productError) {
          console.error('Error processing Siigo product:', sp.id, productError);
          // Continue with next product
        }
      }

      // Update channel status
      await supabase
        .from('channels')
        .update({
          status: 'connected',
          last_error: null
        })
        .eq('id', channelId);

      // Log successful sync
      await supabase
        .from('sync_logs')
        .insert({
          account_id: channel.account_id,
          channel_id: channelId,
          operation: 'product_sync',
          payload: { source: 'siigo', synced_count: syncedCount },
          status: 'success'
        });

      return reply.send({
        success: true,
        synced_count: syncedCount,
        message: `${syncedCount} productos sincronizados desde Siigo`
      });
    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send({
        success: false,
        message: 'Internal server error during sync',
        error: error.message
      });
    }
  });
}