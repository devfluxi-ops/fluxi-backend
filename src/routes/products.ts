import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { supabase } from "../supabaseClient";

function getUserFromRequest(req: FastifyRequest): any {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }
  const token = authHeader.replace("Bearer ", "");
  const decoded = jwt.verify(token, process.env.JWT_SECRET as string);
  return decoded;
}

interface ProductsQuery {
  account_id?: string;
  search?: string;
  limit?: number;
}

export async function productRoutes(app: FastifyInstance) {
  app.get(
    "/products",
    async (
      req: FastifyRequest<{ Querystring: ProductsQuery }>,
      reply: FastifyReply,
    ) => {
      try {
        getUserFromRequest(req);

        const { account_id, search, limit } = req.query;

        if (!account_id) {
          return reply
            .status(400)
            .send({ success: false, error: "account_id is required" });
        }

        let query = supabase
          .from("products")
          .select("id, account_id, name, sku, price, created_at")
          .eq("account_id", account_id)
          .order("created_at", { ascending: false });

        if (search && search.trim() !== "") {
          query = query.ilike("name", `%${search}%`);
        }

        const finalLimit =
          limit && Number(limit) > 0 && Number(limit) <= 100
            ? Number(limit)
            : 50;

        query = query.limit(finalLimit);

        const { data, error } = await query;

        if (error) {
          return reply
            .status(400)
            .send({ success: false, error: error.message });
        }

        return reply.send({ success: true, products: data || [] });
      } catch (err: any) {
        return reply.status(401).send({ success: false, error: err.message });
      }
    },
  );
}
