import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@fire/engine", "@fire/spending", "@fire/plaid", "@fire/db"],
  logging: { fetches: { fullUrl: false } },
};

export default config;
