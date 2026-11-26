// The database calls for signing up, signing in and sessions: the
// server-only front door. The rules and answer checks are in
// lib/auth-db-core.ts; this file plugs in the real database, through the
// secret key, and so must never reach a visitor's browser.
import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  createHouseholdCall,
  endSessionRowCall,
  getAccessCodeMaterialCall,
  getSessionRowCall,
  signInWithCodeCall,
  type AccessCodeMaterial,
  type CreateHouseholdArgs,
  type CreateHouseholdResult,
  type Rpc,
  type SessionPerson,
  type SignInArgs,
  type SignInCallResult,
} from "./auth-db-core.ts";
import { getProfileCall, type ProfileAnswer } from "./auth-db-core.ts";

// How long to wait for the database before treating it as no answer.
const DATABASE_TIMEOUT_MS = 10000;

// Read one setting. If it is missing, say which one by name, never its
// value. (The error is caught by the core and becomes "unknown".)
function requireSetting(name: "SUPABASE_URL" | "SUPABASE_SECRET_KEY"): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`The server setting ${name} is missing.`);
  }
  return value.trim();
}

const realRpc: Rpc = async (functionName, args) => {
  const client = createClient(requireSetting("SUPABASE_URL"), requireSetting("SUPABASE_SECRET_KEY"), {
    // Server code with no Supabase user: no login session is saved,
    // refreshed or read from a web address.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error, status } = await client
    .rpc(functionName, args)
    .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
  return { data, error, status };
};

export async function createHousehold(args: CreateHouseholdArgs): Promise<CreateHouseholdResult> {
  return createHouseholdCall(args, realRpc);
}

export async function signInWithCode(args: SignInArgs): Promise<SignInCallResult> {
  return signInWithCodeCall(args, realRpc);
}

export async function getSessionRow(tokenHash: string): Promise<SessionPerson | null> {
  return getSessionRowCall(tokenHash, realRpc);
}

export async function endSessionRow(tokenHash: string): Promise<boolean> {
  return endSessionRowCall(tokenHash, realRpc);
}

export async function getAccessCodeMaterial(customerId: string): Promise<AccessCodeMaterial | null> {
  return getAccessCodeMaterialCall(customerId, realRpc);
}

export async function getProfile(customerId: string): Promise<ProfileAnswer | null> {
  return getProfileCall(customerId, realRpc);
}
