"use client";
import { ActionForm, FormInput } from "@/components/action-form";
import { deleteEverythingAction } from "./actions";

export function DeleteEverything() {
  return (
    <ActionForm action={deleteEverythingAction} submitLabel="Delete all my data" variant="danger">
      <FormInput name="confirm" label='Type "DELETE" to confirm' autoComplete="off" />
    </ActionForm>
  );
}
