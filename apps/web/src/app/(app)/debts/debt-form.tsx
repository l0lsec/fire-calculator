"use client";
import { useState } from "react";
import { ActionForm, FormInput, FormSelect } from "@/components/action-form";
import { saveDebtAction } from "./actions";

const KINDS: [string, string][] = [
  ["credit_card", "Credit card"],
  ["student", "Student loan"],
  ["mortgage", "Mortgage"],
  ["auto", "Auto loan"],
  ["personal", "Personal loan"],
  ["heloc", "HELOC"],
  ["medical", "Medical debt"],
  ["other", "Other"],
];

export interface DebtFormValues {
  id?: string;
  name?: string;
  kind?: string;
  balance?: string;
  apr?: string;
  minType?: "fixed" | "card";
  minAmount?: string;
  cardFloor?: string;
  cardPct?: string;
  promoApr?: string;
  promoEnds?: string;
  escrow?: string;
}

export function DebtForm({ v = {} }: { v?: DebtFormValues }) {
  const [kind, setKind] = useState(v.kind ?? "credit_card");
  const [minType, setMinType] = useState<"fixed" | "card">(
    v.minType ?? (kind === "credit_card" ? "card" : "fixed"),
  );
  return (
    <ActionForm
      action={saveDebtAction}
      submitLabel={v.id ? "Save changes" : "Add debt"}
      resetOnSuccess={!v.id}
    >
      {v.id ? <input type="hidden" name="id" value={v.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormInput name="name" label="Name" defaultValue={v.name} placeholder="Visa" />
        <FormSelect
          name="kind"
          label="Kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setMinType(e.target.value === "credit_card" ? "card" : "fixed");
          }}
        >
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </FormSelect>
        <FormInput
          name="balance"
          label="Balance"
          inputMode="decimal"
          defaultValue={v.balance}
          placeholder="4,800"
        />
        <FormInput
          name="apr"
          label="Interest rate (APR %)"
          inputMode="decimal"
          defaultValue={v.apr}
          placeholder="24.99"
        />
        <FormSelect
          name="minType"
          label="Minimum payment"
          value={minType}
          onChange={(e) => setMinType(e.target.value as "fixed" | "card")}
        >
          <option value="fixed">Fixed amount</option>
          <option value="card">Card style (% of balance + interest)</option>
        </FormSelect>
        {minType === "fixed" ? (
          <FormInput
            name="minAmount"
            label="Minimum per month"
            inputMode="decimal"
            defaultValue={v.minAmount}
            placeholder="150"
          />
        ) : (
          <>
            <FormInput
              name="cardPct"
              label="Percent of balance"
              inputMode="decimal"
              defaultValue={v.cardPct ?? "1"}
            />
            <FormInput
              name="cardFloor"
              label="But at least ($)"
              inputMode="decimal"
              defaultValue={v.cardFloor ?? "35"}
            />
          </>
        )}
        <FormInput
          name="promoApr"
          label="Promo APR % (optional)"
          inputMode="decimal"
          defaultValue={v.promoApr}
        />
        <FormInput name="promoEnds" label="Promo ends (YYYY-MM)" type="month" defaultValue={v.promoEnds} />
        {kind === "mortgage" ? (
          <FormInput
            name="escrow"
            label="Escrow per month"
            inputMode="decimal"
            defaultValue={v.escrow}
            hint="Property tax and insurance. It continues after the loan is paid off."
          />
        ) : null}
      </div>
    </ActionForm>
  );
}
