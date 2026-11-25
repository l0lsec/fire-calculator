// HTTP wrapper around FakePlaid so a running app (PLAID_BASE_URL) can talk to
// it, plus /__fake/* control endpoints for end-to-end tests. Never used in
// production: the app only reaches it when PLAID_BASE_URL is set.
import { createServer, type Server } from "node:http";
import { type FakeOptions, FakePlaid } from "./index";

export interface FakeServer {
  url: string;
  fake: FakePlaid;
  close: () => Promise<void>;
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startFakePlaidServer(opts: FakeOptions & { port?: number } = {}): Promise<FakeServer> {
  const fake = new FakePlaid(opts);
  const server: Server = createServer(async (req, res) => {
    try {
      const body = await readBody(req);
      const path = req.url ?? "/";
      if (path.startsWith("/__fake/")) {
        const args = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        let out: unknown = { ok: true };
        switch (path) {
          case "/__fake/public_token":
            out = {
              public_token: fake.createPublicToken(args.webhook ? { webhook: String(args.webhook) } : {}),
            };
            break;
          case "/__fake/set_error":
            fake.setItemError(String(args.item_id), args.code ? String(args.code) : null);
            break;
          case "/__fake/fire_webhook":
            await fake.fireWebhook(
              String(args.item_id),
              String(args.webhook_type),
              String(args.webhook_code),
              (args.extra as Record<string, unknown>) ?? {},
            );
            break;
          case "/__fake/add_transactions":
            fake.addTransactions(String(args.item_id), args.transactions as never);
            break;
          case "/__fake/calls":
            out = Object.fromEntries(fake.calls);
            break;
          default:
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
        return;
      }
      const r = await fake.fetch(`http://fake${path}`, { method: "POST", body });
      res.writeHead(r.status, { "Content-Type": "application/json" }).end(await r.text());
    } catch (e) {
      res
        .writeHead(500, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: (e as Error).message }));
    }
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    fake,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
