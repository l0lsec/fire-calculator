// Creating, listing and revoking AI access keys (the AI access page).
import {
  type ApiTokenInfo,
  createApiToken,
  type Db,
  type HouseholdScope,
  isUuid,
  listApiTokens,
  restoreApiToken,
  revokeApiToken,
} from "@fire/db";
import { z } from "zod";
import { newApiKey } from "@/lib/auth/api-key";
import { type ActionResult, parseForm } from "../forms";

interface Ctx {
  db: Db;
  scope: HouseholdScope;
  userId: string;
}

export const MAX_KEYS = 20;

export const EXPIRY_CHOICES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
] as const;

export const CreateKeyForm = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name the key, for example Claude")
    .max(60, "Keep the name under 60 characters"),
  access: z.enum(["read", "write"]).default("read"),
  expires: z.enum(["30", "90", "365", "never"]).default("90"),
});

export interface CreatedKey {
  secret: string;
  key: ApiTokenInfo;
  message: string;
}

export async function createKey(ctx: Ctx, input: Record<string, string>): Promise<ActionResult<CreatedKey>> {
  const parsed = parseForm(CreateKeyForm, input);
  if ("result" in parsed) return parsed.result as ActionResult<CreatedKey>;
  const v = parsed.data;
  if ((await listApiTokens(ctx.db, ctx.scope)).length >= MAX_KEYS)
    return {
      ok: false,
      error: `You have ${MAX_KEYS} keys. Revoke one you no longer use, then create this one.`,
    };
  const { secret, hash, prefix } = await newApiKey();
  const expiresAt = v.expires === "never" ? null : new Date(Date.now() + Number(v.expires) * 86_400_000);
  const key = await createApiToken(ctx.db, ctx.scope, {
    userId: ctx.userId,
    name: v.name,
    access: v.access,
    tokenHash: hash,
    prefix,
    expiresAt,
  });
  return {
    ok: true,
    data: {
      secret,
      key,
      message: `Key "${key.name}" created. Copy it now: it is shown only once.`,
    },
  };
}

export function listKeys(ctx: Omit<Ctx, "userId">) {
  return listApiTokens(ctx.db, ctx.scope);
}

export async function revokeKey(
  ctx: Omit<Ctx, "userId">,
  id: string,
): Promise<ActionResult<{ message: string; undo: Record<string, string> }>> {
  if (!isUuid(id)) return { ok: false, error: "That key is gone; reload the page." };
  const row = await revokeApiToken(ctx.db, ctx.scope, id);
  if (!row) return { ok: false, error: "That key is gone; reload the page." };
  return {
    ok: true,
    data: { message: `Revoked "${row.name}". Assistants using it lose access now.`, undo: { id } },
  };
}

export async function restoreKey(ctx: Omit<Ctx, "userId">, id: string): Promise<ActionResult> {
  if (!isUuid(id) || !(await restoreApiToken(ctx.db, ctx.scope, id)))
    return { ok: false, error: "Too late to undo; create a new key instead." };
  return { ok: true, data: { message: "Key restored." } };
}
