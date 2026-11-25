// Rate limiting for Plaid and export endpoints. On Workers, a Cloudflare
// Rate Limiting binding (RATE_LIMITER) enforces limits across isolates; in
// Node (dev, tests) an in-memory fixed window stands in.
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface Binding {
  limit: (opts: { key: string }) => Promise<{ success: boolean }>;
}

const windows = new Map<string, { start: number; count: number }>();

export function memoryLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= max;
}

export async function allow(key: string, max = 30, windowMs = 60_000): Promise<boolean> {
  try {
    const { env } = getCloudflareContext();
    const binding = (env as { RATE_LIMITER?: Binding }).RATE_LIMITER;
    if (binding) return (await binding.limit({ key })).success;
  } catch {
    // Not running on Workers.
  }
  return memoryLimit(key, max, windowMs);
}

export function tooMany(): Response {
  return Response.json(
    { error: "Too many requests. Try again in a minute." },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}
