import { createRequire } from "node:module";
import type { Page } from "@playwright/test";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

interface Violation {
  id: string;
  impact: string;
  targets: string[];
}

/** Serious and critical axe violations on the current page. */
export async function seriousViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: axePath });
  const violations: Violation[] = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            d: Document,
            o: object,
          ) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }>;
        };
      }
    ).axe;
    const r = await axe.run(document, { resultTypes: ["violations"] });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    }));
  });
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.impact} ${v.id}: ${v.targets.join(", ")}`);
}
