import jwt from "jsonwebtoken";
import { supabase } from "../supabaseClient";

export interface UserClaims {
  userId: string;
  email: string;
  account_id: string;
  role: string;
  iat: number;
  exp: number;
}

/**
 * Extract and validate JWT token from request headers
 */
export function getUserFromRequest(req: any): UserClaims {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }
  const token = authHeader.replace("Bearer ", "");
  const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as UserClaims;
  return decoded;
}

/**
 * Validate that user has access to the specified account
 */
export async function validateAccountAccess(
  user: UserClaims,
  accountId: string
): Promise<void> {
  // Since JWT includes account_id and we have RLS policies,
  // we validate the account_id matches the JWT claim
  if (user.account_id !== accountId) {
    throw new Error('Account access denied');
  }
}

/**
 * Check if user is a member of the account (for cross-account operations)
 */
export async function isAccountMember(
  userId: string,
  accountId: string
): Promise<boolean> {
  const { data, error } = await supabase
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
export async function validateOwnerPermissions(
  user: UserClaims,
  accountId: string
): Promise<void> {
  if (user.role !== 'owner') {
    throw new Error('Only account owners can perform this action');
  }

  await validateAccountAccess(user, accountId);
}