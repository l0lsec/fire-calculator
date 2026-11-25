import "server-only";
import { z } from "zod";

// Server configuration, validated on first use (never at import, so `next build`
// does not need production secrets).
const ServerEnv = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  PLAID_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  /** Test and local-dev seam: route Plaid calls to this base URL (the fake API). */
  PLAID_BASE_URL: z.string().url().optional().or(z.literal("")),
  TOKEN_ENCRYPTION_KEYS: z.string().optional(),
  CRON_SECRET: z.string().min(16).optional(),
});
export type ServerEnv = z.infer<typeof ServerEnv>;

export function serverEnv(): ServerEnv {
  return ServerEnv.parse(process.env);
}

export function requireEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const v = serverEnv()[key];
  if (v === undefined || v === null || v === "") throw new Error(`${String(key)} is not configured`);
  return v as NonNullable<ServerEnv[K]>;
}
