"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.productRoutes = productRoutes;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const supabaseClient_1 = require("../supabaseClient");
function getUserFromRequest(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        throw new Error("Missing Authorization header");
    }
    const token = authHeader.replace("Bearer ", "");
    const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
    return decoded;
}
async function productRoutes(app) {
    app.get("/products", async (req, reply) => {
        try {
            getUserFromRequest(req);
            const { account_id, search, limit } = req.query;
            if (!account_id) {
                return reply
                    .status(400)
                    .send({ success: false, error: "account_id is required" });
            }
            let query = supabaseClient_1.supabase
                .from("products")
                .select("id, account_id, name, sku, price, created_at")
                .eq("account_id", account_id)
                .order("created_at", { ascending: false });
            if (search && search.trim() !== "") {
                query = query.ilike("name", `%${search}%`);
            }
            const finalLimit = limit && Number(limit) > 0 && Number(limit) <= 100
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
        }
        catch (err) {
            return reply.status(401).send({ success: false, error: err.message });
        }
    });
}
