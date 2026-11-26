// Daily bank sync and Mac notifications on a schedule (macOS launchd).
//
//   node scripts/schedule.mjs install [HH:MM]   default 08:00
//   node scripts/schedule.mjs uninstall
//   node scripts/schedule.mjs status
//
// Installs a per-user LaunchAgent that runs `pnpm sync && pnpm notify` in this
// checkout once a day. Nothing runs as root and nothing listens on the network.
// Output goes to ~/Library/Logs/fire-planner.log.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LABEL = "com.showupshowout.fireplanner.daily";
const plist = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const log = join(homedir(), "Library", "Logs", "fire-planner.log");
const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const uid = process.getuid?.() ?? 501;
const domain = `gui/${uid}`;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const which = (bin) => execFileSync("/usr/bin/which", [bin], { encoding: "utf8" }).trim();

function launchctl(...args) {
  try {
    execFileSync("launchctl", args, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const [cmd = "status", at = "08:00"] = process.argv.slice(2);

if (process.platform !== "darwin") {
  console.error(
    "This schedules a macOS LaunchAgent; on other systems use cron to run `pnpm sync && pnpm notify`.",
  );
  process.exit(1);
}

if (cmd === "install") {
  const m = at.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error("time must be HH:MM");
  // launchd starts with a bare PATH: pin the node and pnpm this checkout uses today.
  const path = [
    ...new Set([dirname(which("node")), dirname(which("pnpm")), "/usr/bin", "/bin", "/usr/sbin", "/sbin"]),
  ].join(":");
  mkdirSync(dirname(plist), { recursive: true });
  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string><string>-c</string>
    <string>cd ${esc(repo)} &amp;&amp; pnpm -s sync; pnpm -s notify</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(path)}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${+m[1]}</integer><key>Minute</key><integer>${+m[2]}</integer></dict>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict>
</plist>
`,
    { mode: 0o644 },
  );
  launchctl("bootout", domain, plist);
  if (!launchctl("bootstrap", domain, plist)) throw new Error("launchctl bootstrap failed");
  console.log(`SCHEDULE_INSTALLED daily at ${at}; log: ${log}`);
} else if (cmd === "uninstall") {
  launchctl("bootout", domain, plist);
  if (existsSync(plist)) rmSync(plist);
  console.log("SCHEDULE_REMOVED");
} else if (cmd === "status") {
  const loaded = launchctl("print", `${domain}/${LABEL}`);
  console.log(
    existsSync(plist) ? `installed (${loaded ? "loaded" : "not loaded"}): ${plist}` : "not installed",
  );
} else {
  console.error("usage: node scripts/schedule.mjs install [HH:MM] | uninstall | status");
  process.exit(2);
}
