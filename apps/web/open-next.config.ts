import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page reads live household data, so nothing is prerendered or cached.
export default defineCloudflareConfig({});
