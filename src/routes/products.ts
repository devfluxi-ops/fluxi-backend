import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { supabase } from "../supabaseClient";
import { getUserFromRequest, validateAccountAccess } from "../utils/auth";
import { sendSuccess, sendError, sendNotFound } from "../utils/responses";

export async function productRoutes(app: FastifyInstance) {
  // GET /products - List products for account with pagination
  app.get('/products', async (request: FastifyRequest<{ Querystring: { account_id: string; include_channels?: string; page?: string; limit?: string; search?: string; status?: string } }>, reply: FastifyReply) => {
    try {
      const { account_id, include_channels, page = '0', limit = '50', search, status } = request.query;

      if (!account_id) {
        return reply.status(400).send({
          success: false,
          message: 'account_id is required'
        });
      }

      const pageNum = parseInt(page) || 0;
      // Allow loading all products by default (no 50 limit)
      const limitNum = limit ? Math.min(parseInt(limit) || 10000, 10000) : 10000;
      const offset = pageNum * limitNum;

      // QUERY 1: Products with stock and price (simple, no JOINs)
      let query = supabase
        .from('products')
        .select('id, account_id, name, sku, description, price, stock, currency, status, created_at, updated_at', { count: 'exact' })
        .eq('account_id', account_id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limitNum - 1);

      if (search) {
        query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
      }
      if (status && status !== 'all') {
        query = query.eq('status', status);
      }

      const { data: products, count, error: err1 } = await query;
      if (err1) {
        request.log.error(err1);
        return reply.status(500).send({
          success: false,
          message: 'Error fetching products',
          error: err1.message
        });
      }

      let result = products || [];
      const total = count || 0;

      // QUERIES 2, 3, 4: Channels (only if requested and there are products)
      if (include_channels === 'true' && result.length > 0) {
        const productIds = result.map((p: any) => p.id);

        // Query 2: channel_products
        const { data: cpData, error: err2 } = await supabase
          .from('channel_products')
          .select('product_id, channel_id, external_id, external_sku, synced_at, sync_status')
          .in('product_id', productIds);

        if (err2) {
          request.log.error(err2);
          return reply.status(500).send({
            success: false,
            message: 'Error fetching channel products',
            error: err2.message
          });
        }

        if (cpData && cpData.length > 0) {
          const channelIds = [...new Set(cpData.map((cp: any) => cp.channel_id))];

          // Query 3: channels
          const { data: chData, error: err3 } = await supabase
            .from('channels')
            .select('id, name, channel_type_id')
            .in('id', channelIds);

          if (err3) {
            request.log.error(err3);
            return reply.status(500).send({
              success: false,
              message: 'Error fetching channels',
              error: err3.message
            });
          }

          // Map channels (use channel_type_id as type for now)
          const channelsMap: Record<string, any> = {};
          (chData || []).forEach((c: any) => {
            channelsMap[c.id] = { name: c.name, type: c.channel_type_id || 'unknown' };
          });

          // Map channel_products by product
          const cpByProduct: Record<string, any[]> = {};
          cpData.forEach((cp: any) => {
            if (!cpByProduct[cp.product_id]) cpByProduct[cp.product_id] = [];
            const ch = channelsMap[cp.channel_id] || {};
            cpByProduct[cp.product_id].push({
              channel_id: cp.channel_id,
              channel_name: ch.name || 'Unknown',
              channel_type: ch.type || 'unknown',
              external_id: cp.external_id,
              external_sku: cp.external_sku,
              synced_at: cp.synced_at,
              sync_status: cp.sync_status
            });
          });

          // Add channels to products
          result = result.map((p: any) => ({ ...p, channels: cpByProduct[p.id] || [] }));
        } else {
          result = result.map((p: any) => ({ ...p, channels: [] }));
        }
      } else {
        result = result.map((p: any) => ({ ...p, channels: [] }));
      }

      return reply.send({
        success: true,
        products: result,
        total,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum)
        }
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

  // GET /products/:productId - Get single product with variants and stock
  app.get("/products/:productId", async (req: FastifyRequest<{ Params: { productId: string } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { productId } = req.params;

      // Get product with variants and stock info
      const { data, error } = await supabase
        .from("product_catalog")
        .select("*")
        .eq("id", productId)
        .single();

      if (error || !data) {
        return sendNotFound(reply, "Product");
      }

      // Validate account access
      await validateAccountAccess(user, data.account_id);

      return sendSuccess(reply, { product: data });
    } catch (error: any) {
      return sendError(reply, error.message, 401);
    }
  });

  // POST /products - Create new product with variant
  app.post("/products", async (req: FastifyRequest<{ Body: {
    account_id: string;
    name: string;
    description?: string;
    internal_sku: string;
    price: number;
    attributes?: Record<string, any>;
    barcode?: string;
    weight?: number;
    dimensions?: Record<string, any>;
    stock?: number;
    status?: string;
  } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const {
        account_id,
        name,
        description,
        internal_sku,
        price,
        attributes = {},
        barcode,
        weight,
        dimensions,
        stock = 0,
        status = 'active'
      } = req.body;

      // Validate account access
      await validateAccountAccess(user, account_id);

      if (!name || !internal_sku || price === undefined) {
        return sendError(reply, "name, internal_sku, and price are required", 400);
      }

      // Create product
      const { data: product, error: productError } = await supabase
        .from("products")
        .insert({
          account_id,
          name,
          sku: internal_sku,
          price,
          description,
          status
        })
        .select()
        .single();

      if (productError) {
        return sendError(reply, productError.message, 400);
      }

      // Create product variant
      const { data: variant, error: variantError } = await supabase
        .from("product_variants")
        .insert({
          product_id: product.id,
          internal_sku,
          attributes,
          barcode,
          weight,
          dimensions
        })
        .select()
        .single();

      if (variantError) {
        return sendError(reply, variantError.message, 400);
      }

      // Create inventory stock if stock > 0
      if (stock > 0) {
        // Get or create default inventory for the account
        let { data: defaultInventory, error: inventoryError } = await supabase
          .from("inventories")
          .select("id")
          .eq("account_id", account_id)
          .eq("is_default", true)
          .single();

        if (inventoryError || !defaultInventory) {
          // Create default inventory
          const { data: newInventory, error: createError } = await supabase
            .from("inventories")
            .insert({
              account_id,
              name: "Inventario Principal",
              is_default: true
            })
            .select("id")
            .single();

          if (createError) {
            return sendError(reply, `Failed to create default inventory: ${createError.message}`, 400);
          }

          defaultInventory = newInventory;
        }

        const { error: stockError } = await supabase
          .from("inventory_stock_items")
          .insert({
            inventory_id: defaultInventory.id,
            product_variant_id: variant.id,
            quantity: stock
          });

        if (stockError) {
          return sendError(reply, stockError.message, 400);
        }
      }

      return sendSuccess(reply, {
        product: {
          ...product,
          variant: variant,
          stock: stock
        }
      });
    } catch (error: any) {
      return sendError(reply, error.message, 401);
    }
  });

  // PUT /products/:productId - Update product
  app.put("/products/:productId", async (req: FastifyRequest<{
    Params: { productId: string },
    Body: Partial<{
      name: string;
      description: string;
      status: string;
      internal_sku: string;
      attributes: Record<string, any>;
      barcode: string;
      weight: number;
      dimensions: Record<string, any>;
      stock: number;
    }>
  }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { productId } = req.params;
      const updates = req.body;

      // Get current product
      const { data: currentProduct, error: getError } = await supabase
        .from("products")
        .select("*")
        .eq("id", productId)
        .single();

      if (getError || !currentProduct) {
        return sendNotFound(reply, "Product");
      }

      // Validate account access
      await validateAccountAccess(user, currentProduct.account_id);

      // Separate product updates from variant updates
      const { internal_sku, attributes, barcode, weight, dimensions, stock, ...productUpdates } = updates;

      // Update product
      if (Object.keys(productUpdates).length > 0) {
        const { error: productError } = await supabase
          .from("products")
          .update({
            ...productUpdates,
            updated_at: new Date().toISOString()
          })
          .eq("id", productId);

        if (productError) {
          return sendError(reply, productError.message, 400);
        }
      }

      // Update variant if variant fields provided
      if (internal_sku || attributes || barcode || weight || dimensions !== undefined) {
        const variantUpdates: any = {};
        if (internal_sku) variantUpdates.internal_sku = internal_sku;
        if (attributes) variantUpdates.attributes = attributes;
        if (barcode !== undefined) variantUpdates.barcode = barcode;
        if (weight !== undefined) variantUpdates.weight = weight;
        if (dimensions) variantUpdates.dimensions = dimensions;

        const { error: variantError } = await supabase
          .from("product_variants")
          .update(variantUpdates)
          .eq("product_id", productId);

        if (variantError) {
          return sendError(reply, variantError.message, 400);
        }
      }

      // Update stock if provided
      if (stock !== undefined) {
        // Get the variant ID first
        const { data: variant } = await supabase
          .from("product_variants")
          .select("id")
          .eq("product_id", productId)
          .single();

        if (variant) {
          // Get or create default inventory for the account
          let { data: defaultInventory, error: inventoryError } = await supabase
            .from("inventories")
            .select("id")
            .eq("account_id", currentProduct.account_id)
            .eq("is_default", true)
            .single();

          if (inventoryError || !defaultInventory) {
            // Create default inventory
            const { data: newInventory, error: createError } = await supabase
              .from("inventories")
              .insert({
                account_id: currentProduct.account_id,
                name: "Inventario Principal",
                is_default: true
              })
              .select("id")
              .single();

            if (createError) {
              return sendError(reply, `Failed to create default inventory: ${createError.message}`, 400);
            }

            defaultInventory = newInventory;
          }

          const { error: stockError } = await supabase
            .from("inventory_stock_items")
            .upsert({
              inventory_id: defaultInventory.id,
              product_variant_id: variant.id,
              quantity: stock,
              updated_at: new Date().toISOString()
            });

          if (stockError) {
            return sendError(reply, stockError.message, 400);
          }
        }
      }

      // Return updated product data
      const { data: updatedProduct } = await supabase
        .from("product_catalog")
        .select("*")
        .eq("id", productId)
        .single();

      return sendSuccess(reply, { product: updatedProduct });
    } catch (error: any) {
      return sendError(reply, error.message, 401);
    }
  });

  // DELETE /products/:productId - Delete product and all related data
  app.delete("/products/:productId", async (req: FastifyRequest<{ Params: { productId: string } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { productId } = req.params;

      // Get current product
      const { data: currentProduct, error: getError } = await supabase
        .from("products")
        .select("*")
        .eq("id", productId)
        .single();

      if (getError || !currentProduct) {
        return sendNotFound(reply, "Product");
      }

      // Validate account access
      await validateAccountAccess(user, currentProduct.account_id);

      // Delete in correct order (respecting foreign keys)
      // 1. Delete inventory stock items
      await supabase
        .from("inventory_stock_items")
        .delete()
        .eq("product_variant_id", await supabase
          .from("product_variants")
          .select("id")
          .eq("product_id", productId)
        );

      // 2. Delete product variants
      await supabase
        .from("product_variants")
        .delete()
        .eq("product_id", productId);

      // 3. Delete product
      const { error: productError } = await supabase
        .from("products")
        .delete()
        .eq("id", productId);

      if (productError) {
        return sendError(reply, productError.message, 400);
      }

      return sendSuccess(reply, { message: "Product deleted successfully" });
    } catch (error: any) {
      return sendError(reply, error.message, 401);
    }
  });
}
