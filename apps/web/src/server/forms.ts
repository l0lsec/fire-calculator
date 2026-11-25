// Form parsing shared by server actions: user-typed dollars and percents to
// cents and decimals, with field errors that read well in the UI.
import { z } from "zod";

export type FieldErrors = Record<string, string>;
export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error?: string; fieldErrors?: FieldErrors };

const clean = (s: string) => s.replace(/[$,\s]/g, "");

/** "$1,234.56" -> 123456 cents. Negative values are rejected unless allowed. */
export function dollars(
  opts: { min?: number; max?: number; optional?: boolean; allowNegative?: boolean } = {},
) {
  const base = z
    .string()
    .optional()
    .transform((s, ctx) => {
      const c = clean(s ?? "");
      if (c === "") {
        if (opts.optional) return null;
        ctx.addIssue({ code: "custom", message: "Enter an amount" });
        return z.NEVER;
      }
      if (!/^-?\d+(\.\d{0,2})?$/.test(c)) {
        ctx.addIssue({ code: "custom", message: "Enter a dollar amount like 1,250.00" });
        return z.NEVER;
      }
      const cents = Math.round(Number(c) * 100);
      if (!opts.allowNegative && cents < 0) {
        ctx.addIssue({ code: "custom", message: "Amount cannot be negative" });
        return z.NEVER;
      }
      if (opts.min !== undefined && cents < opts.min * 100) {
        ctx.addIssue({ code: "custom", message: `Must be at least ${opts.min}` });
        return z.NEVER;
      }
      if (opts.max !== undefined && cents > opts.max * 100) {
        ctx.addIssue({ code: "custom", message: `Must be at most ${opts.max.toLocaleString("en-US")}` });
        return z.NEVER;
      }
      return cents;
    });
  return base;
}

/** "24.99" (percent) -> 0.2499. */
export function percent(opts: { min?: number; max?: number; optional?: boolean } = {}) {
  const min = opts.min ?? 0;
  const max = opts.max ?? 100;
  return z
    .string()
    .optional()
    .transform((s, ctx) => {
      const c = (s ?? "").replace(/[%\s]/g, "");
      if (c === "") {
        if (opts.optional) return null;
        ctx.addIssue({ code: "custom", message: "Enter a rate" });
        return z.NEVER;
      }
      if (!/^-?\d+(\.\d+)?$/.test(c)) {
        ctx.addIssue({ code: "custom", message: "Enter a percentage like 6.5" });
        return z.NEVER;
      }
      const v = Number(c);
      if (v < min || v > max) {
        ctx.addIssue({ code: "custom", message: `Must be between ${min}% and ${max}%` });
        return z.NEVER;
      }
      return Math.round(v * 1e6) / 1e8;
    });
}

export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

/** Parse with a schema, returning either data or a field-error result. */
export function parseForm<T extends z.ZodType>(
  schema: T,
  input: Record<string, unknown>,
): { data: z.infer<T> } | { result: ActionResult } {
  const r = schema.safeParse(input);
  if (r.success) return { data: r.data };
  return { result: { ok: false, fieldErrors: fieldErrors(r.error) } };
}

/** Checkbox fields arrive as "on" or not at all. */
export const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");
