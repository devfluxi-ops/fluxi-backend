import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { supabase } from "../supabaseClient";
import { getUserFromRequest, validateAccountAccess } from "../utils/auth";
import { sendSuccess, sendError, sendNotFound } from "../utils/responses";

export async function productRoutes(app: FastifyInstance) {
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

      // Always fetch products first
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('*')
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

      if (include_channels === 'true' && products.length > 0) {
        const productIds = products.map((p) => p.id);

        const { data: channelLinks, error: channelError } = await supabase
          .from('channel_products')
          .select(`
            product_id,
            channel_id,
            external_id,
            external_sku,
            synced_at,
            sync_status,
            status,
            last_sync_at,
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

        if (channelError) {
          request.log.error(channelError);
          return reply.status(500).send({
            success: false,
            message: 'Error fetching channels for products',
            error: channelError.message
          });
        }

        const channelsByProduct = new Map<string, any[]>();

        for (const link of channelLinks || []) {
          const channelInfo: any = (link as any).channels || {};
          const channelTypeRelation = channelInfo.channel_types;
          const channelTypeDetails = Array.isArray(channelTypeRelation)
            ? channelTypeRelation[0]
            : channelTypeRelation;

          const channelType =
            channelInfo.channel_type_id ||
            channelInfo.type ||
            channelTypeDetails?.id ||
            channelTypeDetails?.name ||
            null;

          const existing = channelsByProduct.get(link.product_id) || [];
          existing.push({
            channel_id: link.channel_id,
            channel_name: channelInfo.name ?? null,
            channel_type: channelType,
            external_id: link.external_id,
            external_sku: link.external_sku,
            synced_at: (link as any).synced_at || (link as any).last_sync_at || null,
            sync_status: (link as any).sync_status || (link as any).status || null
          });
          channelsByProduct.set(link.product_id, existing);
        }

        products = products.map(product => ({
          ...product,
          channels: channelsByProduct.get(product.id) || []
        }));
      } else {
        // Add empty channels array for consistency
        products = products.map(product => ({
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
