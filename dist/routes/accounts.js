"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountsRoutes = accountsRoutes;
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
// Middleware helper
async function assertAccountBelongsToUser(supabase, userId, accountId) {
    const { data, error } = await supabase
        .from('account_users')
        .select('id')
        .eq('user_id', userId)
        .eq('account_id', accountId)
        .maybeSingle();
    if (error || !data) {
        throw new Error('Account not found for this user');
    }
}
async function accountsRoutes(app) {
    // GET /accounts - List user's accounts
    app.get("/accounts", async (req, reply) => {
        try {
            const user = getUserFromRequest(req);
            const { data, error } = await supabaseClient_1.supabase
                .from("accounts")
                .select(`
          id,
          name,
          slug,
          created_at,
          updated_at,
          account_users!inner(role)
        `)
                .eq("account_users.user_id", user.userId);
            if (error) {
                return reply.status(400).send({ success: false, error: error.message });
            }
            return reply.send({
                success: true,
                data: data.map((account) => ({
                    id: account.id,
                    name: account.name,
                    slug: account.slug,
                    owner_id: user.userId,
                    created_at: account.created_at,
                    updated_at: account.updated_at
                }))
            });
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
    // POST /accounts - Create new account
    app.post("/accounts", async (req, reply) => {
        try {
            const user = getUserFromRequest(req);
            const { name, slug } = req.body;
            if (!name) {
                return reply.status(400).send({
                    success: false,
                    error: "name is required"
                });
            }
            // Create account
            const { data: account, error: accountError } = await supabaseClient_1.supabase
                .from("accounts")
                .insert({ name, slug })
                .select()
                .single();
            if (accountError) {
                return reply.status(400).send({ success: false, error: accountError.message });
            }
            // Add user as owner
            const { error: memberError } = await supabaseClient_1.supabase
                .from("account_users")
                .insert({
                account_id: account.id,
                user_id: user.userId,
                role: 'owner'
            });
            if (memberError) {
                return reply.status(400).send({ success: false, error: memberError.message });
            }
            return reply.send({
                success: true,
                data: {
                    id: account.id,
                    name: account.name,
                    slug: account.slug,
                    owner_id: user.userId,
                    created_at: account.created_at,
                    updated_at: account.updated_at
                }
            });
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
    // GET /accounts/:accountId/members - List account members
    app.get("/accounts/:accountId/members", async (req, reply) => {
        try {
            const user = getUserFromRequest(req);
            const { accountId } = req.params;
            // Validate user has access to account
            await assertAccountBelongsToUser(supabaseClient_1.supabase, user.userId, accountId);
            const { data, error } = await supabaseClient_1.supabase
                .from("account_users")
                .select(`
          id,
          account_id,
          user_id,
          role,
          created_at,
          users (
            id,
            email,
            created_at
          )
        `)
                .eq("account_id", accountId);
            if (error) {
                return reply.status(400).send({ success: false, error: error.message });
            }
            return reply.send({
                success: true,
                data: data.map((member) => ({
                    id: member.id,
                    account_id: member.account_id,
                    user_id: member.user_id,
                    role: member.role,
                    invited_by: null, // TODO: implement invitations
                    joined_at: member.created_at,
                    user: member.users
                }))
            });
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
    // POST /accounts/:accountId/members/invite - Invite member
    app.post("/accounts/:accountId/members/invite", async (req, reply) => {
        try {
            const user = getUserFromRequest(req);
            const { accountId } = req.params;
            const { email, role } = req.body;
            // Validate user has access to account
            await assertAccountBelongsToUser(supabaseClient_1.supabase, user.userId, accountId);
            if (!email || !role) {
                return reply.status(400).send({
                    success: false,
                    error: "email and role are required"
                });
            }
            // Check if user exists
            const { data: existingUser, error: userError } = await supabaseClient_1.supabase
                .from("users")
                .select("id")
                .eq("email", email)
                .single();
            if (userError || !existingUser) {
                return reply.status(400).send({
                    success: false,
                    error: "User with this email does not exist"
                });
            }
            // Check if already member
            const { data: existingMember } = await supabaseClient_1.supabase
                .from("account_users")
                .select("id")
                .eq("account_id", accountId)
                .eq("user_id", existingUser.id)
                .single();
            if (existingMember) {
                return reply.status(400).send({
                    success: false,
                    error: "User is already a member of this account"
                });
            }
            // Add member
            const { data: member, error: memberError } = await supabaseClient_1.supabase
                .from("account_users")
                .insert({
                account_id: accountId,
                user_id: existingUser.id,
                role: role
            })
                .select()
                .single();
            if (memberError) {
                return reply.status(400).send({ success: false, error: memberError.message });
            }
            return reply.send({
                success: true,
                data: {
                    id: member.id,
                    account_id: member.account_id,
                    user_id: member.user_id,
                    role: member.role,
                    invited_by: user.userId,
                    joined_at: member.created_at
                }
            });
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
    // PATCH /accounts/:accountId/members/:memberId - Update member role
    app.patch("/accounts/:accountId/members/:memberId", async (req, reply) => {
        try {
            const user = getUserFromRequest(req);
            const { accountId, memberId } = req.params;
            const { role } = req.body;
            // Validate user has access to account
            await assertAccountBelongsToUser(supabaseClient_1.supabase, user.userId, accountId);
            if (!role) {
                return reply.status(400).send({
                    success: false,
                    error: "role is required"
                });
            }
            const { data, error } = await supabaseClient_1.supabase
                .from("account_users")
                .update({ role })
                .eq("id", memberId)
                .eq("account_id", accountId)
                .select()
                .single();
            if (error) {
                return reply.status(400).send({ success: false, error: error.message });
            }
            return reply.send({
                success: true,
                data: {
                    id: data.id,
                    account_id: data.account_id,
                    user_id: data.user_id,
                    role: data.role,
                    invited_by: null,
                    joined_at: data.created_at
                }
            });
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
    // DELETE /accounts/:accountId/members/:memberId - Remove member
    app.delete("/accounts/:accountId/members/:memberId", async (req, reply) => {
        try {
            const user = getUserFromRequest(req);
            const { accountId, memberId } = req.params;
            // Validate user has access to account
            await assertAccountBelongsToUser(supabaseClient_1.supabase, user.userId, accountId);
            const { error } = await supabaseClient_1.supabase
                .from("account_users")
                .delete()
                .eq("id", memberId)
                .eq("account_id", accountId);
            if (error) {
                return reply.status(400).send({ success: false, error: error.message });
            }
            return reply.send({ success: true });
        }
        catch (error) {
            return reply.status(401).send({ success: false, error: error.message });
        }
    });
}
