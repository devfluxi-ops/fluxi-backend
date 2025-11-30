import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL as string;
const serviceKey = process.env.SUPABASE_SERVICE_KEY as string;

if (!supabaseUrl || !serviceKey) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_KEY are not set in .env");
}

// Client for authenticated user operations (respects RLS)
export const supabase = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Client for server-side operations (bypasses RLS - use carefully!)
export const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Helper function to create authenticated client for specific user
export function createAuthenticatedClient(jwt: string) {
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`
      }
    }
  });
}