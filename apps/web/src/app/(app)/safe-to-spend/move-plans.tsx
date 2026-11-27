// The plan to keep each account above $0: the move, why, the fees it avoids,
// how it is worked out, and "I moved it". Shown on Safe to spend and the dashboard.

import { ButtonForm } from "@/components/action-form";
import { DrillButton } from "@/components/breakdown";
import { usdCents } from "@/lib/format";
import type { MovePlan } from "@/server/insights/breakdowns";
import { recordMoveAction, removeMoveAction } from "./actions";

/** "Thu, Dec 3" */
const day = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
/** "Dec 3" */
const short = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function MovePlans({
  plans,
  nameOf,
  primary = true,
}: {
  plans: MovePlan[];
  nameOf: (id: string) => string;
  /** Make the first "I moved it" the card's one primary action. */
  primary?: boolean;
}) {
  return (
    <>
      {plans.map(({ f, moves: ms, breakdown: b }, pi) => {
        const s = f.shortfall as NonNullable<typeof f.shortfall>;
        const first = ms[0] as (typeof ms)[number];
        const fees = ms.reduce((t, m) => t + m.feesAvoidedCents, 0);
        const count = ms.reduce((t, m) => t + m.overdrawn.length, 0);
        return (
          <div key={f.account.id} className="flex flex-col gap-2" data-testid="move-plan">
            <p className="font-medium">
              {ms.length === 1
                ? `Move ${usdCents(first.cents)} from ${nameOf(first.fromAccountId)} to ${nameOf(f.account.id)} by ${day(first.byDate)}`
                : `Move ${usdCents(ms.reduce((t, m) => t + m.cents, 0))} into ${nameOf(f.account.id)} by ${day(first.byDate)}`}
            </p>
            <p className="text-sm text-ink-2">
              It goes to {usdCents(first.coverDays ? -first.coverCents : s.worstCents)} by{" "}
              {short(first.worstDate)}
              {s.cause ? `, starting when ${s.cause} comes out on ${short(s.date)}` : ""}.{" "}
              {first.coverDays
                ? `This covers its bills for the next ${first.coverDays} days. Business income that does not arrive on a schedule is not counted, so check again after a deposit.`
                : "This covers that and your usual spending from it until then."}
              {first.uncoveredCents > 0
                ? ` It is still ${usdCents(first.uncoveredCents)} short: no other account can spare more, so hold off on spending from it.`
                : ""}
            </p>
            {fees > 0 ? (
              <p className="text-sm text-ink-2" data-testid="move-fees">
                Avoids about <span className="num font-medium text-accent">{usdCents(fees)}</span> in fees:{" "}
                {count} {count === 1 ? "charge" : "charges"} would come out below $0, at{" "}
                {usdCents(first.fee.perItemCents, { cents: true })} each (
                {first.fee.source === "history"
                  ? first.fee.ownAccount
                    ? "what this account was charged before"
                    : "what your other accounts were charged before"
                  : first.fee.source === "yours"
                    ? "the fee you set"
                    : "a typical bank fee"}
                ).
              </p>
            ) : null}
            {b ? <DrillButton breakdown={b} label="How this plan is worked out" testId="move-drill" /> : null}
            <ul className="flex flex-col gap-2">
              {ms.map((m, mi) => (
                <li
                  key={`${m.fromAccountId}-${m.toAccountId}`}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  {ms.length > 1 ? (
                    <span>
                      <span className="num font-medium">{usdCents(m.cents)}</span> from{" "}
                      {nameOf(m.fromAccountId)}
                    </span>
                  ) : null}
                  <ButtonForm
                    action={recordMoveAction}
                    label={ms.length > 1 ? "I moved this" : "I moved it"}
                    variant={primary && pi === 0 && mi === 0 ? "primary" : "secondary"}
                    hidden={{ fromAccountId: m.fromAccountId, toAccountId: m.toAccountId }}
                    undo={removeMoveAction}
                    testId="move-record"
                  />
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-3">
              Tap it once you have moved the money or scheduled it at your bank. The forecast then counts it
              until it shows up in your accounts.
            </p>
          </div>
        );
      })}
    </>
  );
}
