// Starts the fake Plaid API for the e2e run. The app server (see
// playwright.config.ts) points PLAID_BASE_URL at it, so every e2e run uses the
// fake regardless of real keys in .env.
import { startFakePlaidServer } from "@fire/plaid/fake/server";

export const FAKE_PLAID_PORT = Number(process.env.FAKE_PLAID_PORT ?? 3298);

export default async function globalSetup() {
  const server = await startFakePlaidServer({
    port: FAKE_PLAID_PORT,
    clientId: "fake_client_id",
    secret: "fake_secret",
  });
  return async () => {
    await server.close();
  };
}
