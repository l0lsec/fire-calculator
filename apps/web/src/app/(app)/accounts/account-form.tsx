"use client";
import { ActionForm, FormCheckbox, FormInput, FormSelect } from "@/components/action-form";
import { BUCKET_LABELS, BUCKETS } from "@/server/accounts/labels";
import { saveAccountAction } from "./actions";

export interface AccountFormValues {
  id?: string;
  name?: string;
  bucket?: string;
  balance?: string;
  costBasis?: string;
  rothBasis?: string;
  includeInFi?: boolean;
  plaid?: boolean;
}

export function AccountForm({ v = {} }: { v?: AccountFormValues }) {
  return (
    <ActionForm
      action={saveAccountAction}
      submitLabel={v.id ? "Save changes" : "Add account"}
      resetOnSuccess={!v.id}
    >
      {v.id ? <input type="hidden" name="id" value={v.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormInput name="name" label="Name" defaultValue={v.name} placeholder="Emergency savings" />
        <FormSelect name="bucket" label="Type" defaultValue={v.bucket ?? "cash"}>
          {BUCKETS.map((b) => (
            <option key={b} value={b}>
              {BUCKET_LABELS[b]}
            </option>
          ))}
        </FormSelect>
        {v.plaid ? (
          <input type="hidden" name="balance" value={v.balance ?? "0"} />
        ) : (
          <FormInput
            name="balance"
            label="Balance"
            inputMode="decimal"
            defaultValue={v.balance}
            placeholder="25,000"
          />
        )}
        <FormInput
          name="costBasis"
          label="Cost basis (taxable accounts, optional)"
          inputMode="decimal"
          defaultValue={v.costBasis}
          hint="What you paid in; used to estimate taxes on withdrawals."
        />
        <FormInput
          name="rothBasis"
          label="Roth contributions (optional)"
          inputMode="decimal"
          defaultValue={v.rothBasis}
          hint="Contributions can be withdrawn before 59.5 without penalty."
        />
      </div>
      <FormCheckbox
        name="includeInFi"
        label="Count toward financial independence"
        defaultChecked={v.includeInFi ?? true}
      />
    </ActionForm>
  );
}
