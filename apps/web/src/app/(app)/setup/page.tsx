import { ProgressBar, StepList } from "@/components/steps";
import { ButtonLink, Card, Disclaimer } from "@/components/ui";
import { requireContext } from "@/lib/auth/context";
import { age, duration, usd } from "@/lib/format";
import { dashboardModel } from "@/server/dashboard";
import { plaidConfigured } from "@/server/plaid/config";
import { currentStep, type SetupStepId, setupSteps } from "@/server/setup";
import { hasConnectedAccounts, planForScenario } from "@/server/snapshot";
import { AccountForm } from "../accounts/account-form";
import { IncomeForm, PersonForm, SpendingForm } from "../plan/forms";

export const metadata = { title: "Set up your plan | FIRE Planner" };

// Money as people type it: "60,000" or "1,234.50" (the parsers accept commas).
const centsIn = (c: number | null | undefined) =>
  c
    ? (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })
    : "";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const ctx = await requireContext();
  const { step: asked } = await searchParams;
  const plan = await planForScenario(ctx);
  const data = plan.data;
  const steps = setupSteps(data);
  const step = asked === "done" ? null : currentStep(steps, asked);
  const done = steps.filter((s) => s.done).length;
  const next = step ? steps.find((s) => s.n > step.n && !s.done) : undefined;
  const connected = hasConnectedAccounts(data);

  if (!step) {
    // The end of the flow: the payoff, and the one next thing to do.
    const h = dashboardModel(plan).headline;
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <h1 className="text-2xl font-semibold">
          {done === steps.length ? "You are set up" : "Where you stand"}
        </h1>
        <Card>
          <div className="flex flex-col gap-3" data-testid="setup-done">
            <ProgressBar done={done} total={steps.length} label="Setup" />
            {h?.fiWhen ? (
              <p className="text-lg">
                On your current path you reach FI in{" "}
                <span className="num font-semibold" data-testid="setup-fi-when">
                  {h.fiWhen}
                </span>
                {h.fiAge !== null ? ` at age ${age(h.fiAge)}` : ""}
                {h.fiMonths ? `, ${duration(h.fiMonths)} from now` : ""}.
              </p>
            ) : (
              <p className="text-lg">
                Your plan is ready. On these numbers FI is not reached within the plan yet; the dashboard
                shows what moves it.
              </p>
            )}
            {h ? (
              <p className="text-sm text-ink-3">
                Your FI number is {usd(h.fiTarget)} in today&apos;s dollars.
                {done < steps.length
                  ? ` ${steps.length - done} setup ${steps.length - done === 1 ? "step is" : "steps are"} still open; finishing them makes this more accurate.`
                  : ""}
              </p>
            ) : (
              <p className="text-sm text-ink-3">Finish the open steps to see an FI date.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/dashboard" variant="primary">
                See your dashboard
              </ButtonLink>
              <ButtonLink href="/plan">Fine-tune assumptions</ButtonLink>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const body: Record<SetupStepId, React.ReactNode> = {
    people: (
      <>
        {data.people.length ? (
          <p className="text-sm text-ink-2" data-testid="setup-people">
            In your plan: {data.people.map((p) => p.name).join(" and ")}.{" "}
            {data.people.length < 2 ? "Add a partner below, or go on." : ""}
          </p>
        ) : null}
        {data.people.length < 2 ? <PersonForm /> : null}
      </>
    ),
    spending: (
      <div className="flex flex-col gap-4">
        {plaidConfigured() ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-2">
              Fastest and most accurate: connect your bank and the app measures 24 months of spending for you.
            </p>
            <div>
              <ButtonLink href="/connect" variant={step.done ? "secondary" : "primary"}>
                {connected ? "Connect another bank" : "Connect a bank"}
              </ButtonLink>
            </div>
            <p className="text-xs text-ink-3">Or enter an estimate now and connect later:</p>
          </div>
        ) : null}
        <SpendingForm
          plaidAvailable={connected}
          variant={plaidConfigured() ? "secondary" : "primary"}
          v={{
            source: data.spendingSource,
            annual: centsIn(data.spendingProfile?.manualAnnualCents),
            essential: centsIn(data.spendingProfile?.manualEssentialCents),
          }}
        />
      </div>
    ),
    income: data.people.length ? (
      <>
        {data.income.length ? (
          <p className="text-sm text-ink-2">Added: {data.income.map((i) => i.name).join(", ")}.</p>
        ) : null}
        <IncomeForm people={data.people.map((p) => ({ id: p.id, name: p.name }))} />
      </>
    ) : (
      <p className="text-sm text-ink-2">
        Add yourself in step 1 first, so the income has someone to belong to.
      </p>
    ),
    savings: (
      <>
        <p className="text-sm text-ink-2">
          Retirement accounts, brokerage, savings. A connected bank adds its accounts for you; add others by
          hand. Debts go on the Debts page.
        </p>
        <AccountForm />
      </>
    ),
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Set up your plan</h1>
        <p className="text-sm text-ink-3">Four steps, about five minutes. You can leave and come back.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <div className="flex flex-col gap-3">
          <ProgressBar done={done} total={steps.length} label="Setup" />
          <StepList
            steps={steps.map((s) => ({
              n: s.n,
              title: s.title,
              done: s.done,
              current: s.id === step.id,
              href: `/setup?step=${s.id}`,
            }))}
          />
        </div>
        <Card
          title={
            <span data-testid="setup-step">
              Step {step.n} of {steps.length}: {step.title}
            </span>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-3">{step.why}</p>
            {body[step.id]}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              {step.n > 1 ? (
                <ButtonLink href={`/setup?step=${steps[step.n - 2]!.id}`} variant="ghost">
                  Back
                </ButtonLink>
              ) : (
                <span />
              )}
              {next ? (
                <ButtonLink href={`/setup?step=${next.id}`} variant={step.done ? "primary" : "ghost"}>
                  {step.done ? `Next: ${next.title}` : "Skip for now"}
                </ButtonLink>
              ) : (
                <ButtonLink href="/setup?step=done" variant={step.done ? "primary" : "ghost"}>
                  {done === steps.length ? "Finish" : "See where you stand"}
                </ButtonLink>
              )}
            </div>
          </div>
        </Card>
      </div>
      <Disclaimer />
    </div>
  );
}
