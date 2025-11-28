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

// Middleware helper
async function assertAccountBelongsToUser(
  supabase: any,
  userId: string,
  accountId: string
) {
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

export async function accountsRoutes(app: FastifyInstance) {
  // GET /accounts - List user's accounts
  app.get("/accounts", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);

      const { data, error } = await supabase
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
        data: data.map((account: any) => ({
          id: account.id,
          name: account.name,
          slug: account.slug,
          owner_id: user.userId,
          created_at: account.created_at,
          updated_at: account.updated_at
        }))
      });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // POST /accounts - Create new account
  app.post("/accounts", async (req: FastifyRequest<{ Body: { name: string, slug?: string } }>, reply: FastifyReply) => {
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
      const { data: account, error: accountError } = await supabase
        .from("accounts")
        .insert({ name, slug })
        .select()
        .single();

      if (accountError) {
        return reply.status(400).send({ success: false, error: accountError.message });
      }

      // Add user as owner
      const { error: memberError } = await supabase
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
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // GET /accounts/:accountId/members - List account members
  app.get("/accounts/:accountId/members", async (req: FastifyRequest<{ Params: { accountId: string } }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { accountId } = req.params;

      // Validate user has access to account
      await assertAccountBelongsToUser(supabase, user.userId, accountId);

      const { data, error } = await supabase
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
        data: data.map((member: any) => ({
          id: member.id,
          account_id: member.account_id,
          user_id: member.user_id,
          role: member.role,
          invited_by: null, // TODO: implement invitations
          joined_at: member.created_at,
          user: member.users
        }))
      });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // POST /accounts/:accountId/members/invite - Invite member
  app.post("/accounts/:accountId/members/invite", async (req: FastifyRequest<{
    Params: { accountId: string },
    Body: { email: string, role: string }
  }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { accountId } = req.params;
      const { email, role } = req.body;

      // Validate user has access to account
      await assertAccountBelongsToUser(supabase, user.userId, accountId);

      if (!email || !role) {
        return reply.status(400).send({
          success: false,
          error: "email and role are required"
        });
      }

      // Check if user exists
      const { data: existingUser, error: userError } = await supabase
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
      const { data: existingMember } = await supabase
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
      const { data: member, error: memberError } = await supabase
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
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // PATCH /accounts/:accountId/members/:memberId - Update member role
  app.patch("/accounts/:accountId/members/:memberId", async (req: FastifyRequest<{
    Params: { accountId: string, memberId: string },
    Body: { role: string }
  }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { accountId, memberId } = req.params;
      const { role } = req.body;

      // Validate user has access to account
      await assertAccountBelongsToUser(supabase, user.userId, accountId);

      if (!role) {
        return reply.status(400).send({
          success: false,
          error: "role is required"
        });
      }

      const { data, error } = await supabase
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
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });

  // DELETE /accounts/:accountId/members/:memberId - Remove member
  app.delete("/accounts/:accountId/members/:memberId", async (req: FastifyRequest<{
    Params: { accountId: string, memberId: string }
  }>, reply: FastifyReply) => {
    try {
      const user = getUserFromRequest(req);
      const { accountId, memberId } = req.params;

      // Validate user has access to account
      await assertAccountBelongsToUser(supabase, user.userId, accountId);

      const { error } = await supabase
        .from("account_users")
        .delete()
        .eq("id", memberId)
        .eq("account_id", accountId);

      if (error) {
        return reply.status(400).send({ success: false, error: error.message });
      }

      return reply.send({ success: true });
    } catch (error: any) {
      return reply.status(401).send({ success: false, error: error.message });
    }
  });
}