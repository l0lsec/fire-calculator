"use client";
// Inline monthly budget for one category: type an amount and press Enter.
import { useActionState } from "react";
import type { FormAction } from "@/components/action-form";

export function BudgetInput({
  category,
  label,
  current,
  action,
}: {
  category: string;
  label: string;
  current: number | null;
  action: FormAction;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const error = state && !state.ok ? (state.fieldErrors?.amount ?? state.error) : undefined;
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="category" value={category} />
      <label className="flex items-center gap-1">
        <span className="sr-only">Monthly budget for {label}</span>
        <span aria-hidden>$</span>
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={current !== null ? String(current / 100) : ""}
          placeholder="Budget"
          aria-invalid={error ? true : undefined}
          className="h-8 w-24 rounded-md border border-line bg-bg px-2 text-right text-sm tabular-nums"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="h-8 rounded-md border border-line px-2.5 text-xs hover:bg-surface-2 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Set"}
      </button>
      {error ? (
        <span className="text-xs text-bad">{error}</span>
      ) : state?.ok ? (
        <span className="text-xs text-accent">Saved</span>
      ) : null}
    </form>
  );
}
