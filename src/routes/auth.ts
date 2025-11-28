import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../supabaseClient";

export async function authRoutes(app: FastifyInstance) {
  // Register user
  app.post('/auth/register', async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };

    // 1. Crear user
    const passwordHash = await bcrypt.hash(password, 10);
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({ email, password_hash: passwordHash })
      .select('*')
      .single();

    if (userError) return reply.code(400).send({ error: userError.message });

    // 2. Crear account
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .insert({ name: `${email} Account` })
      .select('*')
      .single();

    if (accountError) return reply.code(400).send({ error: accountError.message });

    // 3. Vincular en account_users
    await supabase.from('account_users').insert({
      account_id: account.id,
      user_id: user.id,
      role: 'owner',
    });

    // 4. Crear token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    // 5. Respuesta
    return reply.send({
      user: { id: user.id, email: user.email, created_at: user.created_at },
      account_id: account.id,
      token,
    });
  });

  // Login user
  app.post('/auth/login', async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };

    // 1. Buscar user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError || !user) return reply.code(401).send({ error: 'Invalid credentials' });

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return reply.code(401).send({ error: 'Invalid credentials' });

    // 2. Obtener account_id desde account_users
    const { data: accountUser, error: auError } = await supabase
      .from('account_users')
      .select('account_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (auError || !accountUser) {
      return reply.code(400).send({
        error: 'User has no account linked in account_users',
      });
    }

    const accountId = accountUser.account_id;

    // 3. Crear token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    // 4. Respuesta
    return reply.send({
      user: { id: user.id, email: user.email, created_at: user.created_at },
      account_id: accountId,
      token,
    });
  });

  // Me endpoint
  app.get("/auth/me", async (req: any, reply) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return reply.status(401).send({ error: "Missing Authorization header" });
      }

      const token = authHeader.replace("Bearer ", "");
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string);

      return reply.send({ user: decoded });
    } catch (err) {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }
  });
}