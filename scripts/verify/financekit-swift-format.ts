// Cross-language check of the iPhone sync format (macOS with Xcode only):
// compiles the iPhone app's own SyncFormat.swift for macOS, has it seal a
// sample snapshot, and requires the Mac importer to open and parse it.
// Run: pnpm verify:financekit
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Envelope,
  encodePairingCode,
  newPairing,
  openEnvelope,
  Snapshot,
} from "../../apps/web/src/server/financekit/format";

if (process.platform !== "darwin") {
  console.log("SKIP: needs macOS and swiftc");
  process.exit(0);
}
const root = new URL("../../ios/FIREPlannerSync/", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "fk-format-"));
try {
  const bin = join(dir, "format-check");
  execFileSync(
    "swiftc",
    ["-O", join(root, "Shared/SyncFormat.swift"), join(root, "FormatCheck/main.swift"), "-o", bin],
    {
      stdio: "inherit",
    },
  );
  const p = newPairing();
  const out = join(dir, "sample.fpsync");
  execFileSync(bin, [encodePairingCode(p.pairingId, p.key), out], { stdio: "inherit" });
  const env = Envelope.parse(JSON.parse(readFileSync(out, "utf8")));
  const snap = Snapshot.parse(JSON.parse(await openEnvelope(env, p.key)));
  if (snap.transactions[0]?.amount !== "12.3457") throw new Error("decimal rounding drifted");
  if (snap.transactions[0]?.merchant !== null || snap.deviceName !== null)
    throw new Error("omitted optionals not null");
  const wrong = newPairing();
  await openEnvelope(env, wrong.key).then(
    () => {
      throw new Error("a wrong key opened the file");
    },
    () => undefined,
  );
  console.log("FINANCEKIT_FORMAT_OK (Swift sealed, Mac opened and parsed; wrong key refused)");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
