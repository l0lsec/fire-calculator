import "server-only";
import type { Db } from "@fire/db";
import { createClient } from "@fire/db/client";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cache } from "react";

/**
 * One database client per request. On Workers a socket opened for one request
 * cannot serve another, so there is deliberately no module-level pool;
 * Hyperdrive pools at the edge. In Node (dev, tests) DATABASE_URL is used.
 */
function connectionString(): string {
  try {
    const { env } = getCloudflareContext();
    const hd = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
    if (hd?.connectionString) return hd.connectionString;
  } catch {
    // Not running inside the Workers runtime.
  }
  const url = process.env.DATABASE_URL;
  if (!url || url === "via-hyperdrive-binding") throw new Error("no database configured");
  return url;
}

export const getDb = cache((): Db => createClient(connectionString()).db);
