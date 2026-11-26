"use client";
// Inline monthly budget for one category: type an amount and press Enter.
import { startTransition, useActionState } from "react";
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
    <form
      action={formAction}
      onSubmit={(e) => {
        // Our own transition: React then keeps the typed amount if the save fails.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="flex items-center gap-2"
    >
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
          className="min-h-10 w-24 rounded-md border border-line bg-bg px-2 text-right text-sm tabular-nums pointer-coarse:min-h-11"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="min-h-10 rounded-md border border-line px-3 text-sm hover:bg-surface-2 disabled:opacity-50 pointer-coarse:min-h-11"
      >
        {pending ? "Saving..." : "Set"}
      </button>
      <span aria-live="polite" className="text-xs">
        {error ? (
          <span className="text-bad">{error}</span>
        ) : state?.ok ? (
          <span className="text-accent">Saved</span>
        ) : null}
      </span>
    </form>
  );
}
