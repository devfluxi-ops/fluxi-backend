import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { supabase } from "../supabaseClient";
import { getUserFromRequest, validateAccountAccess } from "../utils/auth";
import { sendSuccess, sendError, sendNotFound } from "../utils/responses";

export async function productRoutes(app: FastifyInstance) {
  // GET /products - List products with variants and stock
  app.get(
    "/products",
    async (
      req: FastifyRequest<{ Querystring: { account_id: string; search?: string; status?: string; limit?: number } }>,
      reply: FastifyReply,
    ) => {
      try {
        const user = getUserFromRequest(req);
        const { account_id, search, status, limit = 50 } = req.query;

        if (!account_id) {
          return sendError(reply, "account_id is required", 400);
        }

        // Validate account access
        await validateAccountAccess(user, account_id);

        // Use the product_catalog view for comprehensive data
        let query = supabase
          .from("product_catalog")
          .select("*")
          .eq("account_id", account_id);

        if (search && search.trim() !== "") {
          query = query.or(`name.ilike.%${search}%,internal_sku.ilike.%${search}%`);
        }

        if (status) {
          query = query.eq("status", status);
        }

        const { data, error } = await query
          .order("name")
          .limit(limit);

        if (error) {
          return sendError(reply, error.message, 400);
        }

        return sendSuccess(reply, { products: data || [] });
      } catch (err: any) {
        return sendError(reply, err.message, 401);
      }
    },
  );

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
        attributes = {},
        barcode,
        weight,
        dimensions,
        stock = 0,
        status = 'active'
      } = req.body;

      // Validate account access
      await validateAccountAccess(user, account_id);

      if (!name || !internal_sku) {
        return sendError(reply, "name and internal_sku are required", 400);
      }

      // Create product
      const { data: product, error: productError } = await supabase
        .from("products")
        .insert({
          account_id,
          name,
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
        const { error: stockError } = await supabase
          .from("inventory_stock_items")
          .insert({
            inventory_id: 1, // Default inventory - this should be configurable
            product_variant_id: variant.id,
            quantity: stock
          });

        if (stockError) {
          return sendError(reply, stockError.message, 400);
        }
      }

      return sendSuccess(reply, {
        product: {
          id: product.id,
          account_id: product.account_id,
          name: product.name,
          description: product.description,
          status: product.status,
          variant: {
            id: variant.id,
            internal_sku: variant.internal_sku,
            attributes: variant.attributes,
            barcode: variant.barcode,
            stock: stock
          },
          created_at: product.created_at
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
          const { error: stockError } = await supabase
            .from("inventory_stock_items")
            .upsert({
              inventory_id: 1, // Default inventory
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
