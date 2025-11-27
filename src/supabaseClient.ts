import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL as string;
const serviceKey = process.env.SUPABASE_SERVICE_KEY as string;

if (!supabaseUrl || !serviceKey) {
  throw new Error("SUPABASE_URL or SUPABASE_SERVICE_KEY are not set in .env");
}

export const supabase = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});