"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserFromRequest = getUserFromRequest;
exports.validateAccountAccess = validateAccountAccess;
exports.isAccountMember = isAccountMember;
exports.validateOwnerPermissions = validateOwnerPermissions;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const supabaseClient_1 = require("../supabaseClient");
/**
 * Extract and validate JWT token from request headers
 */
function getUserFromRequest(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        throw new Error("Missing Authorization header");
    }
    const token = authHeader.replace("Bearer ", "");
    const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
    return decoded;
}
/**
 * Validate that user has access to the specified account
 */
async function validateAccountAccess(user, accountId) {
    // Since JWT includes account_id and we have RLS policies,
    // we validate the account_id matches the JWT claim
    if (user.account_id !== accountId) {
        throw new Error('Account access denied');
    }
}
/**
 * Check if user is a member of the account (for cross-account operations)
 */
async function isAccountMember(userId, accountId) {
    const { data, error } = await supabaseClient_1.supabase
        .from('account_users')
        .select('id')
        .eq('user_id', userId)
        .eq('account_id', accountId)
        .maybeSingle();
    return !error && !!data;
}
/**
 * Validate owner permissions for account management
 */
async function validateOwnerPermissions(user, accountId) {
    if (user.role !== 'owner') {
        throw new Error('Only account owners can perform this action');
    }
    await validateAccountAccess(user, accountId);
}
