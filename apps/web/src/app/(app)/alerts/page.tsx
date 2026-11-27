import Link from "next/link";
import { ActionForm, ButtonForm, FormCheckbox, FormInput } from "@/components/action-form";
import { Card, Notice } from "@/components/ui";
import { ALERT_HREF } from "@/lib/alert-links";
import { requireContext } from "@/lib/auth/context";
import { usdCents } from "@/lib/format";
import { loadInsights } from "@/server/insights";
import { dismissAlertAction, restoreAlertAction, saveAlertSettingsAction } from "./actions";

export const metadata = { title: "Alerts | FIRE Planner" };

const TONE = { bad: "bad", warn: "warn", info: "info" } as const;

export default async function AlertsPage() {
  const ctx = await requireContext();
  const { alerts, settings } = await loadInsights(ctx);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Alerts</h1>
        <p className="text-sm text-ink-3">
          New subscriptions, price increases, large charges, budgets running over, low balances and bills
          coming due. Dismissed alerts stay dismissed; a new price or a new month raises a new one.
        </p>
      </div>
      <Card title={`Now (${alerts.length})`}>
        {alerts.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing needs a look.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {alerts.map((a) => (
              <li key={a.key} data-testid="alert">
                <Notice tone={TONE[a.severity]}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {ALERT_HREF[a.kind] ? (
                          <Link href={ALERT_HREF[a.kind]!} className="underline">
                            {a.title}
                          </Link>
                        ) : (
                          a.title
                        )}
                      </p>
                      <p className="text-xs">{a.detail}</p>
                    </div>
                    <ButtonForm
                      action={dismissAlertAction}
                      undo={restoreAlertAction}
                      label="Dismiss"
                      hidden={{ key: a.key }}
                    />
                  </div>
                </Notice>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Settings">
        <ActionForm action={saveAlertSettingsAction} submitLabel="Save settings" successMessage="Saved.">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormInput
              name="largeCharge"
              label="Large charge at or above"
              inputMode="decimal"
              defaultValue={(settings.largeChargeCents / 100).toLocaleString("en-US")}
              hint={`Now ${usdCents(settings.largeChargeCents)}`}
            />
            <FormInput
              name="lowBalance"
              label="Low balance under"
              inputMode="decimal"
              defaultValue={(settings.lowBalanceCents / 100).toLocaleString("en-US")}
              hint="Checking and savings accounts"
            />
            <FormInput
              name="billLeadDays"
              label="Remind me of bills (days ahead)"
              inputMode="numeric"
              defaultValue={String(settings.billLeadDays)}
            />
          </div>
          <FormCheckbox
            name="macNotifications"
            label="Show new alerts as Mac notifications (when the daily check runs)"
            defaultChecked={settings.macNotifications}
          />
          <FormCheckbox
            name="weeklySummary"
            label="Weekly summary notification on Sundays"
            defaultChecked={settings.weeklySummary}
          />
        </ActionForm>
        <p className="mt-3 text-xs text-ink-3">
          Mac notifications come from <code>pnpm notify</code>, which a daily scheduled job runs after syncing
          your banks. See docs/RUNBOOK.md to turn the schedule on or off.
        </p>
      </Card>
    </div>
  );
}
