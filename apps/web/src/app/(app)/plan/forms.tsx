"use client";
import { ActionForm, FormCheckbox, FormInput, FormSelect } from "@/components/action-form";
import {
  addAdjustmentAction,
  saveAssumptionsAction,
  saveContributionAction,
  saveIncomeAction,
  savePersonAction,
  saveSpendingAction,
} from "./actions";

export function PersonForm({ v }: { v?: { id: string; name: string; birth: string } }) {
  return (
    <ActionForm action={savePersonAction} submitLabel={v ? "Save" : "Add person"} resetOnSuccess={!v}>
      {v ? <input type="hidden" name="id" value={v.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormInput name="name" label="Name" defaultValue={v?.name} autoComplete="given-name" />
        <FormInput name="birth" label="Birth month" type="month" defaultValue={v?.birth} hint="YYYY-MM" />
      </div>
    </ActionForm>
  );
}

export function IncomeForm({ people }: { people: { id: string; name: string }[] }) {
  return (
    <ActionForm action={saveIncomeAction} submitLabel="Add income" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormSelect name="personId" label="Whose" defaultValue={people[0]?.id}>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </FormSelect>
        <FormInput name="name" label="Name" placeholder="Salary" />
        <FormSelect name="kind" label="Kind" defaultValue="takeHome">
          <option value="takeHome">Take-home pay</option>
          <option value="partTime">Part-time work</option>
          <option value="socialSecurity">Social Security</option>
          <option value="pension">Pension</option>
          <option value="other">Other</option>
        </FormSelect>
        <FormInput
          name="monthly"
          label="Monthly amount (after tax)"
          inputMode="decimal"
          placeholder="6,500"
        />
        <FormSelect name="phase" label="When" defaultValue="working">
          <option value="working">While working</option>
          <option value="retired">After retiring</option>
          <option value="always">Always</option>
        </FormSelect>
        <FormSelect name="growth" label="Grows with" defaultValue="raise">
          <option value="raise">Raises</option>
          <option value="inflation">Inflation</option>
          <option value="none">Stays flat</option>
        </FormSelect>
        <FormInput name="startAge" label="Starts at age (optional)" inputMode="decimal" />
        <FormInput name="endAge" label="Ends at age (optional)" inputMode="decimal" />
      </div>
    </ActionForm>
  );
}

export function ContributionForm() {
  return (
    <ActionForm action={saveContributionAction} submitLabel="Add contribution" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormInput name="name" label="Name" placeholder="401(k) deferral" />
        <FormSelect name="bucket" label="Into" defaultValue="traditional">
          <option value="traditional">Traditional (401k, IRA)</option>
          <option value="roth">Roth</option>
          <option value="hsa">HSA</option>
          <option value="taxable">Taxable</option>
        </FormSelect>
        <FormInput
          name="monthly"
          label="Monthly, from your paycheck"
          inputMode="decimal"
          placeholder="1,000"
        />
      </div>
    </ActionForm>
  );
}

export function SpendingForm({
  v,
  plaidAvailable,
}: {
  v: { source: string; annual: string; essential: string };
  plaidAvailable: boolean;
}) {
  return (
    <ActionForm action={saveSpendingAction} submitLabel="Save spending" successMessage="Saved.">
      <FormSelect name="source" label="Measure spending from" defaultValue={v.source}>
        <option value="manual">My own estimate</option>
        <option value="plaid" disabled={!plaidAvailable}>
          Connected accounts{plaidAvailable ? "" : " (connect a bank first)"}
        </option>
      </FormSelect>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormInput
          name="annual"
          label="Annual living spending"
          inputMode="decimal"
          defaultValue={v.annual}
          hint="Exclude loan and card payments and mortgage escrow; those are counted from your debts."
        />
        <FormInput
          name="essential"
          label="Of which essentials"
          inputMode="decimal"
          defaultValue={v.essential}
          hint="Housing, food, utilities, insurance, transport. Sets your Lean FI number."
        />
      </div>
    </ActionForm>
  );
}

export interface AssumptionValues {
  scenarioId: string;
  nominalReturn: string;
  inflation: string;
  cashReturn: string;
  raiseRate: string;
  swr: string;
  retirementAge: string;
  lifeExpectancy: string;
  emergencyMonths: string;
  fatMultiplier: string;
  withdrawalTaxRate: string;
  retireMode: string;
  retireAge: string;
  partTimeAnnual: string;
  partTimeHealth: string;
  partTimeUntil: string;
  countGuaranteedIncome: boolean;
  policy: string;
  strategy: string;
  extraMonthly: string;
  hybridThreshold: string;
}

export function AssumptionsForm({ v }: { v: AssumptionValues }) {
  return (
    <ActionForm
      action={saveAssumptionsAction}
      submitLabel="Save assumptions"
      successMessage="Saved. The dashboard is updated."
    >
      <input type="hidden" name="scenarioId" value={v.scenarioId} />
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Markets</legend>
        <FormInput
          name="nominalReturn"
          label="Investment return (%/yr)"
          defaultValue={v.nominalReturn}
          inputMode="decimal"
        />
        <FormInput name="inflation" label="Inflation (%/yr)" defaultValue={v.inflation} inputMode="decimal" />
        <FormInput
          name="cashReturn"
          label="Cash return (%/yr)"
          defaultValue={v.cashReturn}
          inputMode="decimal"
        />
        <FormInput name="raiseRate" label="Raises (%/yr)" defaultValue={v.raiseRate} inputMode="decimal" />
        <FormInput
          name="swr"
          label="Withdrawal rate (%)"
          defaultValue={v.swr}
          inputMode="decimal"
          hint="4% comes from 30-year retirements; 3.25 to 3.5% suits 40 years or more."
        />
        <FormInput
          name="withdrawalTaxRate"
          label="Tax on withdrawals (%)"
          defaultValue={v.withdrawalTaxRate}
          inputMode="decimal"
        />
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Timeline</legend>
        <FormSelect name="retireMode" label="Stop working" defaultValue={v.retireMode}>
          <option value="fi">When FI is reached</option>
          <option value="age">At a chosen age</option>
        </FormSelect>
        <FormInput
          name="retireAge"
          label="Chosen age (if fixed)"
          defaultValue={v.retireAge}
          inputMode="decimal"
        />
        <FormInput
          name="retirementAge"
          label="Traditional retirement age"
          defaultValue={v.retirementAge}
          inputMode="decimal"
          hint="Coast FI is measured against this age."
        />
        <FormInput
          name="lifeExpectancy"
          label="Plan to age"
          defaultValue={v.lifeExpectancy}
          inputMode="decimal"
        />
        <FormInput
          name="emergencyMonths"
          label="Emergency fund (months of essentials)"
          defaultValue={v.emergencyMonths}
          inputMode="decimal"
        />
        <FormInput
          name="fatMultiplier"
          label="Fat FI spending multiple"
          defaultValue={v.fatMultiplier}
          inputMode="decimal"
        />
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Barista FI (part-time work)</legend>
        <FormInput
          name="partTimeAnnual"
          label="Part-time income ($/yr, net)"
          defaultValue={v.partTimeAnnual}
          inputMode="decimal"
        />
        <FormInput
          name="partTimeHealth"
          label="Extra health cost ($/yr)"
          defaultValue={v.partTimeHealth}
          inputMode="decimal"
        />
        <FormInput
          name="partTimeUntil"
          label="Until age (blank: indefinitely)"
          defaultValue={v.partTimeUntil}
          inputMode="decimal"
        />
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Debt</legend>
        <FormSelect name="policy" label="Debt at FI" defaultValue={v.policy}>
          <option value="payoffAtFI">Pay everything off at FI (count balances in the target)</option>
          <option value="keepMortgage">Keep the mortgage (count its payments at expected returns)</option>
          <option value="debtFreeFirst">Not FI until consumer debt is gone</option>
        </FormSelect>
        <FormSelect name="strategy" label="Payoff strategy" defaultValue={v.strategy}>
          <option value="avalanche">Avalanche (highest rate first)</option>
          <option value="snowball">Snowball (smallest balance first)</option>
          <option value="hybrid">Hybrid (only debts above the threshold)</option>
          <option value="custom">Custom order</option>
          <option value="minimum">Minimum payments only</option>
        </FormSelect>
        <FormInput
          name="extraMonthly"
          label="Extra toward debt ($/mo)"
          defaultValue={v.extraMonthly}
          inputMode="decimal"
        />
        <FormInput
          name="hybridThreshold"
          label="High-interest threshold (%)"
          defaultValue={v.hybridThreshold}
          inputMode="decimal"
        />
      </fieldset>
      <FormCheckbox
        name="countGuaranteedIncome"
        label="Count Social Security and pensions in FI targets (from their start age)"
        defaultChecked={v.countGuaranteedIncome}
      />
    </ActionForm>
  );
}

export function AdjustmentForm({ scenarioId }: { scenarioId: string }) {
  return (
    <ActionForm action={addAdjustmentAction} submitLabel="Add line" resetOnSuccess>
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <FormInput name="label" label="What changes" placeholder="Travel" />
        <FormInput name="annual" label="$/yr (negative removes)" inputMode="decimal" placeholder="5,000" />
        <FormInput name="fromAge" label="From age" inputMode="decimal" />
        <FormInput name="untilAge" label="Until age" inputMode="decimal" />
      </div>
      <FormCheckbox name="essential" label="Essential (counts toward Lean FI)" />
    </ActionForm>
  );
}
