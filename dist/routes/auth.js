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
    // Register user
    app.post('/auth/register', async (req, reply) => {
        const { email, password } = req.body;
        // 1. Crear user
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const { data: user, error: userError } = await supabaseClient_1.supabase
            .from('users')
            .insert({ email, password_hash: passwordHash })
            .select('*')
            .single();
        if (userError)
            return reply.code(400).send({ error: userError.message });
        // 2. Crear account
        const accountSlug = `${email.split('@')[0]}-account`.toLowerCase().replace(/[^a-z0-9-]/g, '');
        const { data: account, error: accountError } = await supabaseClient_1.supabase
            .from('accounts')
            .insert({
            name: `${email} Account`,
            slug: accountSlug
        })
            .select('*')
            .single();
        if (accountError)
            return reply.code(400).send({ error: accountError.message });
        // 3. Vincular en account_users
        const { error: linkError } = await supabaseClient_1.supabase.from('account_users').insert({
            account_id: account.id,
            user_id: user.id,
            role: 'owner'
        });
        if (linkError)
            return reply.code(400).send({ error: linkError.message });
        // 4. Crear token con claims para RLS
        const token = jsonwebtoken_1.default.sign({
            userId: user.id,
            email: user.email,
            account_id: account.id,
            role: 'owner'
        }, process.env.JWT_SECRET, { expiresIn: '7d' });
        // 5. Respuesta
        return reply.send({
            user: { id: user.id, email: user.email, created_at: user.created_at },
            account: { id: account.id, name: account.name },
            token,
        });
    });
    // Login user
    app.post('/auth/login', async (req, reply) => {
        const { email, password } = req.body;
        // 1. Buscar user
        const { data: user, error: userError } = await supabaseClient_1.supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();
        if (userError || !user)
            return reply.code(401).send({ error: 'Invalid credentials' });
        const isValid = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!isValid)
            return reply.code(401).send({ error: 'Invalid credentials' });
        // 2. Obtener account_id y role desde account_users
        const { data: accountUser, error: auError } = await supabaseClient_1.supabase
            .from('account_users')
            .select('account_id, role')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true })
            .limit(1)
            .single();
        if (auError || !accountUser) {
            return reply.code(400).send({
                error: 'User has no account linked in account_users',
            });
        }
        // 3. Obtener datos de la cuenta
        const { data: account, error: accountError } = await supabaseClient_1.supabase
            .from('accounts')
            .select('id, name, slug')
            .eq('id', accountUser.account_id)
            .single();
        if (accountError || !account) {
            return reply.code(400).send({ error: 'Account not found' });
        }
        // 4. Crear token con claims para RLS
        const token = jsonwebtoken_1.default.sign({
            userId: user.id,
            email: user.email,
            account_id: account.id,
            role: accountUser.role
        }, process.env.JWT_SECRET, { expiresIn: '7d' });
        // 5. Actualizar last_login_at
        await supabaseClient_1.supabase
            .from('users')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', user.id);
        // 6. Respuesta
        return reply.send({
            user: {
                id: user.id,
                email: user.email,
                created_at: user.created_at,
                last_login_at: user.last_login_at
            },
            account: {
                id: account.id,
                name: account.name,
                slug: account.slug
            },
            token,
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
            // Get full user data from database
            const { data: user, error: userError } = await supabaseClient_1.supabase
                .from('users')
                .select('id, email, full_name, created_at, last_login_at')
                .eq('id', decoded.userId)
                .single();
            if (userError || !user) {
                return reply.status(401).send({ error: "User not found" });
            }
            // Get account data
            const { data: account, error: accountError } = await supabaseClient_1.supabase
                .from('accounts')
                .select('id, name, slug, default_currency, timezone')
                .eq('id', decoded.account_id)
                .single();
            return reply.send({
                user,
                account,
                token_info: {
                    role: decoded.role,
                    expires_at: decoded.exp
                }
            });
        }
        catch (err) {
            return reply.status(401).send({ error: "Invalid or expired token" });
        }
    });
}
