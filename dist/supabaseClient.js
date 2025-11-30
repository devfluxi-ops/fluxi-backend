"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseAdmin = exports.supabase = void 0;
exports.createAuthenticatedClient = createAuthenticatedClient;
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_KEY are not set in .env");
}
// Client for authenticated user operations (respects RLS)
exports.supabase = (0, supabase_js_1.createClient)(supabaseUrl, serviceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
// Client for server-side operations (bypasses RLS - use carefully!)
exports.supabaseAdmin = (0, supabase_js_1.createClient)(supabaseUrl, serviceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
// Helper function to create authenticated client for specific user
function createAuthenticatedClient(jwt) {
    return (0, supabase_js_1.createClient)(supabaseUrl, serviceKey, {
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
