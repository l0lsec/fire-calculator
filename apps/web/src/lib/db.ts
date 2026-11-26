import "server-only";
import type { Db } from "@fire/db";
import { createClient } from "@fire/db/client";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cache } from "react";

/**
 * On Workers: one database client per request. A socket opened for one
 * request cannot serve another there, so there is deliberately no
 * module-level pool; Hyperdrive pools at the edge.
 *
 * In Node (dev, tests) one shared pool serves every request instead. A client
 * per request there leaves each connection idle for 20 seconds after its
 * request, and a burst of page loads and link prefetches then runs Postgres
 * out of connection slots.
 */
function hyperdrive(): string | null {
  try {
    const { env } = getCloudflareContext();
    const hd = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
    if (hd?.connectionString) return hd.connectionString;
  } catch {
    // Not running inside the Workers runtime.
  }
  return null;
}

let nodePool: Db | null = null;

export const getDb = cache((): Db => {
  const hd = hyperdrive();
  if (hd) return createClient(hd).db;
  const url = process.env.DATABASE_URL;
  if (!url || url === "via-hyperdrive-binding") throw new Error("no database configured");
  nodePool ??= createClient(url, { max: 10 }).db;
  return nodePool;
});
