import type { CashFlowItem, FlowKind } from "@fire/spending";
import { ActionForm, FormInput } from "@/components/action-form";
import { CashChart } from "@/components/charts/cash-chart";
import { ButtonLink, Card, Disclaimer, Notice } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { usdCents } from "@/lib/format";
import { loadInsights } from "@/server/insights";
import { saveCushionAction } from "./actions";

export const metadata = { title: "Safe to spend | FIRE Planner" };

const KIND: Record<FlowKind, string> = {
  income: "Pay",
  bill: "Bill",
  "card-payment": "Card payment",
  transfer: "Transfer",
  subscription: "Subscription",
  other: "Other",
};

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
const signed = (cents: number) => `${cents > 0 ? "+" : ""}${usdCents(cents)}`;
const dollarsIn = (cents: number) => (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default async function SafeToSpendPage() {
  const ctx = await requireContext();
  const { cash, connected } = await loadInsights(ctx);
  const sp = cash.spendable;
  const names = new Map(
    cash.accounts.map((f) => [
      f.account.id,
      `${f.account.name}${f.account.mask ? ` ...${f.account.mask}` : ""}`,
    ]),
  );

  if (!connected || !sp) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Safe to spend</h1>
        <Card>
          <p className="text-sm text-ink-2">
            Connect the checking account you spend from. The app then finds your bills and paydays and tells
            you how much you can spend before the next paycheck without going negative.
          </p>
          <div className="mt-3">
            <ButtonLink href="/connect" variant="primary">
              Connect a bank
            </ButtonLink>
          </div>
        </Card>
        <Disclaimer />
      </div>
    );
  }

  const until = sp.nextPayday
    ? `until ${short(sp.nextPayday.date)}`
    : `over the next ${cash.horizonDays} days`;
  const shortAccounts = cash.accounts.filter((f) => f.role === "spending" && f.shortfall);
  const upcomingItems = cash.upcoming;
  const chart = sp.days.map((d) => ({
    label: short(d.date),
    scheduled: d.committedCents / 100,
    pace: d.paceCents / 100,
  }));
  const groups = [
    { title: "Spending accounts", rows: cash.accounts.filter((f) => f.role === "spending") },
    { title: "Savings", rows: cash.accounts.filter((f) => f.role === "savings") },
    { title: "Business", rows: cash.accounts.filter((f) => f.role === "business") },
  ].filter((g) => g.rows.length);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Safe to spend</h1>
        <p className="text-sm text-ink-3">
          What you can spend from checking before money comes in, after every bill due and a cushion you keep
          back. It updates each time your accounts sync.
        </p>
      </div>

      <Card>
        <div className="flex flex-col gap-2" data-testid="safe-headline">
          <p className="text-sm text-ink-3">Safe to spend {until}</p>
          <p
            className={`num text-4xl font-semibold ${sp.safeToSpendCents > 0 ? "text-ink" : "text-bad"}`}
            data-testid="safe-amount"
          >
            {usdCents(sp.safeToSpendCents)}
          </p>
          <p className="text-sm text-ink-2">
            {sp.safeToSpendCents > 0 ? (
              <>
                That is <span className="num font-medium">{usdCents(sp.perDayCents)}</span> a day for{" "}
                {sp.daysToPayday} {sp.daysToPayday === 1 ? "day" : "days"}, a pace that also covers the bills
                after payday.{" "}
              </>
            ) : null}
            {sp.billsBeforePaydayCents > 0
              ? `${usdCents(sp.billsBeforePaydayCents)} in bills and payments come out first, and `
              : "No bills come out before then, and "}
            {usdCents(cash.cushionCents)} stays as your cushion. Lowest point:{" "}
            <span className="num font-medium">{usdCents(sp.low.cents)}</span> on {short(sp.low.date)}.
          </p>
          {sp.maxTodayCents > sp.safeToSpendCents ? (
            <p className="text-xs text-ink-3" data-testid="safe-max-today">
              In one go, at most {usdCents(sp.maxTodayCents)} could leave today without dipping under your
              cushion later, and then nothing more until after {short(sp.low.date)}.
            </p>
          ) : null}
          {shortAccounts.map((f) => {
            const s = f.shortfall as NonNullable<typeof f.shortfall>;
            const move = cash.transfers.find((t) => t.toAccountId === f.account.id);
            return (
              <Notice key={f.account.id} tone="bad">
                {names.get(f.account.id)} goes to {usdCents(s.cents)} on {short(s.date)}
                {s.cause ? ` when ${s.cause} comes out` : ""}
                {s.worstCents < s.cents ? `, and to ${usdCents(s.worstCents)} by ${short(s.worstDate)}` : ""}.{" "}
                {move
                  ? `Move ${usdCents(move.cents)} from ${names.get(move.fromAccountId)} by ${short(move.byDate)} to avoid an overdraft.`
                  : "Hold off on spending from it until money comes in."}
              </Notice>
            );
          })}
          {!shortAccounts.length && sp.paceRunsOut ? (
            <Notice tone="warn">
              At your usual spending ({usdCents(sp.paceDailyCents)} a day) you would run out around{" "}
              {short(sp.paceRunsOut)}. Keeping to {usdCents(sp.perDayCents)} a day avoids it.
            </Notice>
          ) : null}
          {cash.feesCents > 0 ? (
            <p className="text-xs text-ink-3" data-testid="safe-fees">
              You paid {usdCents(cash.feesCents)} in overdraft, returned-payment and late fees in the last 12
              months.
            </p>
          ) : null}
        </div>
      </Card>

      <Card title="Next 30 days">
        <CashChart data={chart} cushion={cash.cushionCents / 100} />
      </Card>

      <Card title="Coming up">
        {upcomingItems.length ? (
          <ul className="divide-y divide-line" data-testid="safe-upcoming">
            {upcomingItems.map((i: CashFlowItem & { balanceAfterCents: number }) => (
              <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="text-ink-3">{day(i.date)}</span>{" "}
                  <span className="font-medium">{i.name}</span>{" "}
                  <span className="text-xs text-ink-3">
                    {KIND[i.kind]}
                    {i.late ? ", was due earlier" : ""}
                    {i.confidence === "likely" ? ", seen twice" : ""} · {names.get(i.accountId)}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className={`num ${i.deltaCents > 0 ? "text-accent" : ""}`}>
                    {signed(i.deltaCents)}
                  </span>
                  <span
                    className={`num w-24 text-right text-xs ${
                      i.balanceAfterCents < 0
                        ? "font-semibold text-bad"
                        : i.balanceAfterCents < cash.cushionCents
                          ? "text-warn"
                          : "text-ink-3"
                    }`}
                  >
                    {usdCents(i.balanceAfterCents)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">No repeating bills or pay found for the next 30 days yet.</p>
        )}
        <p className="mt-2 text-xs text-ink-3">
          Right-hand figure: your spending accounts together after each item. Bills and pay are the ones that
          repeat in your history; one-off charges cannot be predicted.
        </p>
      </Card>

      <Card title="By account">
        <div className="flex flex-col gap-4" data-testid="safe-accounts">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="mb-1 text-xs font-medium text-ink-3">{g.title}</p>
              {g.title === "Business" ? (
                <p className="mb-1 text-xs text-ink-3">
                  Business income that does not arrive on a schedule is not counted, so its lowest point is
                  the worst case.
                </p>
              ) : null}
              <ul className="divide-y divide-line">
                {g.rows.map((f) => (
                  <li
                    key={f.account.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{names.get(f.account.id)}</span>
                    <span className="flex items-center gap-3 text-xs text-ink-3">
                      <span>
                        now <span className="num text-sm text-ink">{usdCents(f.startCents)}</span>
                      </span>
                      <span className={f.low.cents < 0 ? "font-semibold text-bad" : ""}>
                        lowest <span className="num">{usdCents(f.low.cents)}</span> on {short(f.low.date)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Your cushion">
        <ActionForm
          action={saveCushionAction}
          submitLabel="Save cushion"
          variant="secondary"
          testId="cushion-form"
        >
          <FormInput
            name="cushion"
            label="Always keep at least ($)"
            hint="Safe to spend never counts this money. It is also the level for your low-balance alert."
            inputMode="decimal"
            defaultValue={dollarsIn(cash.cushionCents)}
          />
        </ActionForm>
      </Card>

      <details className="text-sm text-ink-2">
        <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-accent pointer-coarse:min-h-11">
          How this is worked out
        </summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-ink-3">
          <li>
            It starts from the available balance of your personal checking accounts. Savings and business
            accounts are shown but not counted as spending money.
          </li>
          <li>
            Bills, card payments and transfers that repeat in each account&apos;s history are placed on their
            next dates. A bill that is late is assumed due today; one that varies is assumed at its higher
            recent amount.
          </li>
          <li>
            Pay counts only after it has arrived three times on a steady schedule, at its lower recent amount,
            and pay that is late is not assumed.
          </li>
          <li>
            The daily allowance is the most you can spend every day and still stay above your cushion on every
            one of the next {cash.horizonDays} days, bills after payday included. Safe to spend is that
            allowance up to your next payday. The dashed line adds your usual day-to-day spending from the
            last 90 days.
          </li>
        </ul>
      </details>
      <Disclaimer />
    </div>
  );
}
