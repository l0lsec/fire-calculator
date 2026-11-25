"use client";
import { ActionForm, FormInput } from "@/components/action-form";
import { createWhatIfAction } from "./actions";

export function NewWhatIf({ from }: { from: string }) {
  return (
    <ActionForm action={createWhatIfAction} submitLabel="Create what-if" variant="secondary">
      <input type="hidden" name="from" value={from} />
      <FormInput name="name" label="Name" placeholder="Retire at 50" />
    </ActionForm>
  );
}
