"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const supabaseClient_1 = require("../supabaseClient");
async function authRoutes(app) {
    const JWT_SECRET = process.env.JWT_SECRET;
    // Register user
    app.post("/auth/register", async (req, reply) => {
        const { email, password } = req.body;
        if (!email || !password) {
            return reply.status(400).send({ error: "Email and password are required" });
        }
        const password_hash = bcryptjs_1.default.hashSync(password, 10);
        const { data, error } = await supabaseClient_1.supabase
            .from("users")
            .insert([{ email, password_hash }])
            .select()
            .single();
        if (error) {
            return reply.status(400).send({ error: error.message });
        }
        const token = jsonwebtoken_1.default.sign({ userId: data.id, email: data.email }, JWT_SECRET, { expiresIn: "7d" });
        // For this demo, assume user.id is the account_id
        // In production, you might have a separate accounts table
        return reply.send({
            user: data,
            account_id: data.id,
            token
        });
    });
    // Login user
    app.post("/auth/login", async (req, reply) => {
        const { email, password } = req.body;
        if (!email || !password) {
            return reply.status(400).send({ error: "Email and password are required" });
        }
        const { data: user, error } = await supabaseClient_1.supabase
            .from("users")
            .select("*")
            .eq("email", email)
            .maybeSingle();
        if (error || !user) {
            return reply.status(401).send({ error: "Invalid credentials" });
        }
        const isValid = bcryptjs_1.default.compareSync(password, user.password_hash);
        if (!isValid) {
            return reply.status(401).send({ error: "Invalid credentials" });
        }
        const token = jsonwebtoken_1.default.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
        // do not return password hash
        const { password_hash, ...safeUser } = user;
        // For this demo, assume user.id is the account_id
        // In production, you might have a separate accounts table
        return reply.send({
            user: safeUser,
            account_id: user.id,
            token
        });
    });
    // Me endpoint
    app.get("/auth/me", async (req, reply) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return reply.status(401).send({ error: "Missing Authorization header" });
            }
            const token = authHeader.replace("Bearer ", "");
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            return reply.send({ user: decoded });
        }
        catch (err) {
            return reply.status(401).send({ error: "Invalid or expired token" });
        }
    });
}
