import "server-only";
import {
  createHouseholdForUser,
  type Db,
  findHouseholdIdForUser,
  type HouseholdScope,
  scopeFor,
} from "@fire/db";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "../db";
import { aalOf } from "./access";
import { createSupabaseServerClient } from "./supabase";

export interface AppContext {
  userId: string;
  email: string | null;
  scope: HouseholdScope;
  db: Db;
}

type Claims = { sub: string; email?: string; aal?: string };

async function claims(): Promise<Claims | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return data.claims as unknown as Claims;
}

async function contextFor(c: Claims): Promise<AppContext> {
  const db = getDb();
  const householdId =
    (await findHouseholdIdForUser(db, c.sub)) ?? (await createHouseholdForUser(db, c.sub, "My household"));
  return { userId: c.sub, email: c.email ?? null, scope: scopeFor(householdId), db };
}

/**
 * The only way a page or server action obtains a household scope. Requires a
 * verified session at AAL2 (password plus TOTP); otherwise redirects.
 */
export const requireContext = cache(async (): Promise<AppContext> => {
  const c = await claims();
  const aal = aalOf(c as Record<string, unknown> | null);
  if (!c || aal === null) redirect("/sign-in");
  if (aal !== "aal2") redirect("/mfa");
  return contextFor(c);
});

/** Route-handler variant: returns a 401 Response instead of redirecting. */
export async function requireApiContext(): Promise<AppContext | Response> {
  const c = await claims();
  if (!c || aalOf(c as Record<string, unknown>) !== "aal2") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return contextFor(c);
}
