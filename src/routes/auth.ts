import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../supabaseClient";

export async function authRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env.JWT_SECRET as string;

  // Register user
  app.post("/auth/register", async (req, reply) => {
    const { email, password } = req.body as any;

    if (!email || !password) {
      return reply.status(400).send({ error: "Email and password are required" });
    }

    const password_hash = bcrypt.hashSync(password, 10);

    const { data, error } = await supabase
      .from("users")
      .insert([{ email, password_hash }])
      .select()
      .single();

    if (error) {
      return reply.status(400).send({ error: error.message });
    }

    const token = jwt.sign(
      { userId: data.id, email: data.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return reply.send({ user: data, token });
  });

  // Login user
  app.post("/auth/login", async (req, reply) => {
    const { email, password } = req.body as any;

    if (!email || !password) {
      return reply.status(400).send({ error: "Email and password are required" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (error || !user) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // do not return password hash
    const { password_hash, ...safeUser } = user;

    return reply.send({ user: safeUser, token });
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