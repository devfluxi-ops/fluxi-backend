import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { supabase } from "../supabaseClient";
import { getUserFromRequest } from "../utils/auth";

export async function accountsRoutes(app: FastifyInstance) {
  // POST /accounts - Create new account (for new users)
  app.post("/accounts", async (req: FastifyRequest<{ Body: { name: string; slug?: string } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { name, slug } = req.body;

      if (!name) {
        return reply.code(400).send({ success: false, message: "Account name is required" });
      }

      // Check if user already has an account
      const { data: existingAccount } = await supabase
        .from('account_users')
        .select('account_id')
        .eq('user_id', user.userId)
        .single();

      if (existingAccount) {
        return reply.code(400).send({ success: false, message: "User already has an account" });
      }

      // Generate slug if not provided
      const accountSlug = slug || name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

      // Check if slug is unique
      const { data: existingSlug } = await supabase
        .from('accounts')
        .select('id')
        .eq('slug', accountSlug)
        .single();

      if (existingSlug) {
        return reply.code(400).send({ success: false, message: "Account slug already exists" });
      }

      // Create account
      const { data: account, error: accountError } = await supabase
        .from('accounts')
        .insert({
          name,
          slug: accountSlug,
          owner_id: user.userId
        })
        .select()
        .single();

      if (accountError) {
        return reply.code(500).send({ success: false, message: "Error creating account" });
      }

      // Create account-user relationship
      const { error: userError } = await supabase
        .from('account_users')
        .insert({
          account_id: account.id,
          user_id: user.userId,
          role: 'owner',
          is_owner: true
        });

      if (userError) {
        return reply.code(500).send({ success: false, message: "Error linking user to account" });
      }

      return reply.send({
        success: true,
        account: {
          id: account.id,
          name: account.name,
          slug: account.slug,
          role: 'owner'
        }
      });

    } catch (error: any) {
      if (error.message?.includes('Authentication required')) {
        return reply.code(401).send({ success: false, message: 'Authentication required' });
      }
      return reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // GET /accounts - List user's accounts
  app.get("/accounts", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);

      const { data, error } = await supabase
        .from('account_users')
        .select(`
          account_id,
          role,
          is_owner,
          accounts (
            id,
            name,
            slug
          )
        `)
        .eq('user_id', user.userId);

      if (error) {
        return reply.code(500).send({ success: false, message: "Error fetching accounts" });
      }

      const accounts = (data || []).map(item => ({
        id: (item.accounts as any)?.id,
        name: (item.accounts as any)?.name,
        slug: (item.accounts as any)?.slug,
        role: item.role
      }));

      return reply.send({ success: true, accounts });

    } catch (error: any) {
      if (error.message?.includes('Authentication required')) {
        return reply.code(401).send({ success: false, message: 'Authentication required' });
      }
      return reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // GET /accounts/{accountId}/members - List account members
  app.get("/accounts/:accountId/members", async (req: FastifyRequest<{ Params: { accountId: string } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { accountId } = req.params;

      // Verify user has access to this account
      const { data: userAccess } = await supabase
        .from('account_users')
        .select('role')
        .eq('account_id', accountId)
        .eq('user_id', user.userId)
        .single();

      if (!userAccess) {
        return reply.code(403).send({ success: false, message: "Access denied" });
      }

      const { data, error } = await supabase
        .from('account_users')
        .select(`
          id,
          role,
          is_owner,
          joined_at,
          users (
            id,
            email,
            full_name
          )
        `)
        .eq('account_id', accountId);

      if (error) {
        return reply.code(500).send({ success: false, message: "Error fetching members" });
      }

      const members = (data || []).map(item => ({
        id: item.id,
        account_id: accountId,
        user_id: (item.users as any)?.id,
        role: item.role,
        is_owner: item.is_owner,
        joined_at: item.joined_at,
        user: {
          id: (item.users as any)?.id,
          email: (item.users as any)?.email,
          full_name: (item.users as any)?.full_name
        }
      }));

      return reply.send({ success: true, data: members });

    } catch (error: any) {
      if (error.message?.includes('Authentication required')) {
        return reply.code(401).send({ success: false, message: 'Authentication required' });
      }
      return reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // POST /accounts/{accountId}/members/invite - Invite new member
  app.post("/accounts/:accountId/members/invite", async (req: FastifyRequest<{ Params: { accountId: string }, Body: { email: string; role: string } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { accountId } = req.params;
      const { email, role } = req.body;

      // Verify user has admin/owner access
      const { data: userAccess } = await supabase
        .from('account_users')
        .select('role')
        .eq('account_id', accountId)
        .eq('user_id', user.userId)
        .single();

      if (!userAccess || !['owner', 'admin'].includes(userAccess.role)) {
        return reply.code(403).send({ success: false, message: "Insufficient permissions" });
      }

      if (!email || !role) {
        return reply.code(400).send({ success: false, message: "Email and role are required" });
      }

      if (!['owner', 'admin', 'member'].includes(role)) {
        return reply.code(400).send({ success: false, message: "Invalid role" });
      }

      // Check if user exists
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .single();

      if (!existingUser) {
        return reply.code(400).send({ success: false, message: "User not found. They must register first." });
      }

      // Check if already a member
      const { data: existingMember } = await supabase
        .from('account_users')
        .select('id')
        .eq('account_id', accountId)
        .eq('user_id', existingUser.id)
        .single();

      if (existingMember) {
        return reply.code(400).send({ success: false, message: "User is already a member" });
      }

      // Add member
      const { data, error } = await supabase
        .from('account_users')
        .insert({
          account_id: accountId,
          user_id: existingUser.id,
          role,
          invited_by: user.userId
        })
        .select()
        .single();

      if (error) {
        return reply.code(500).send({ success: false, message: "Error inviting member" });
      }

      return reply.send({
        success: true,
        data: {
          id: data.id,
          email,
          role,
          invited_by: user.userId
        }
      });

    } catch (error: any) {
      if (error.message?.includes('Authentication required')) {
        return reply.code(401).send({ success: false, message: 'Authentication required' });
      }
      return reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // PATCH /accounts/{accountId}/members/{memberId} - Update member role
  app.patch("/accounts/:accountId/members/:memberId", async (req: FastifyRequest<{ Params: { accountId: string; memberId: string }, Body: { role: string } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { accountId, memberId } = req.params;
      const { role } = req.body;

      // Verify user has admin/owner access
      const { data: userAccess } = await supabase
        .from('account_users')
        .select('role')
        .eq('account_id', accountId)
        .eq('user_id', user.userId)
        .single();

      if (!userAccess || !['owner', 'admin'].includes(userAccess.role)) {
        return reply.code(403).send({ success: false, message: "Insufficient permissions" });
      }

      if (!role || !['owner', 'admin', 'member'].includes(role)) {
        return reply.code(400).send({ success: false, message: "Invalid role" });
      }

      // Update member role
      const { error } = await supabase
        .from('account_users')
        .update({ role })
        .eq('id', memberId)
        .eq('account_id', accountId);

      if (error) {
        return reply.code(500).send({ success: false, message: "Error updating member role" });
      }

      return reply.send({ success: true, message: "Member role updated" });

    } catch (error: any) {
      if (error.message?.includes('Authentication required')) {
        return reply.code(401).send({ success: false, message: 'Authentication required' });
      }
      return reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });

  // DELETE /accounts/{accountId}/members/{memberId} - Remove member
  app.delete("/accounts/:accountId/members/:memberId", async (req: FastifyRequest<{ Params: { accountId: string; memberId: string } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { accountId, memberId } = req.params;

      // Verify user has admin/owner access
      const { data: userAccess } = await supabase
        .from('account_users')
        .select('role')
        .eq('account_id', accountId)
        .eq('user_id', user.userId)
        .single();

      if (!userAccess || !['owner', 'admin'].includes(userAccess.role)) {
        return reply.code(403).send({ success: false, message: "Insufficient permissions" });
      }

      // Remove member
      const { error } = await supabase
        .from('account_users')
        .delete()
        .eq('id', memberId)
        .eq('account_id', accountId);

      if (error) {
        return reply.code(500).send({ success: false, message: "Error removing member" });
      }

      return reply.send({ success: true, message: "Member removed" });

    } catch (error: any) {
      if (error.message?.includes('Authentication required')) {
        return reply.code(401).send({ success: false, message: 'Authentication required' });
      }
      return reply.code(500).send({ success: false, message: "Internal server error" });
    }
  });
}