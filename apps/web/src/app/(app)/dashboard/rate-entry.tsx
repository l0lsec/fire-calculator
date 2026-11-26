"use client";
// Inline "rate needed" boxes: type the APR right on the dashboard instead of
// going to the Debts page. The first box is focused on load, and saving one
// moves focus to the next, so several rates can be entered in a row.
import { startTransition, useActionState, useCallback, useEffect, useId, useRef } from "react";
import type { FormAction } from "@/components/action-form";
import { useToast } from "@/components/toast";
import { Button, Input } from "@/components/ui";
import { saveDebtRateAction } from "../debts/actions";

export interface RateNeeded {
  id: string;
  name: string;
  detail: string;
}

function RateRow({
  debt,
  autoFocus,
  onSubmit,
}: {
  debt: RateNeeded;
  autoFocus: boolean;
  onSubmit: () => void;
}) {
  const toast = useToast();
  // The row leaves the list once its rate is saved, so the result is a toast.
  const save = useCallback<FormAction>(
    async (prev, fd) => {
      const r = await saveDebtRateAction(prev, fd);
      const message = r.ok ? (r.data as { message?: string } | undefined)?.message : undefined;
      if (message) toast({ message: `${debt.name}: ${message}`, tone: "good" });
      return r;
    },
    [debt.name, toast],
  );
  const [state, action, pending] = useActionState(save, null);
  const inputId = useId();
  const errorId = useId();
  const error = state && !state.ok ? (state.fieldErrors?.apr ?? state.error) : undefined;

  return (
    <li>
      <form
        action={action}
        onSubmit={(e) => {
          // Our own transition: React then keeps a mistyped rate in the box to fix.
          e.preventDefault();
          onSubmit();
          const fd = new FormData(e.currentTarget);
          startTransition(() => action(fd));
        }}
        className="flex flex-wrap items-end gap-2"
        noValidate
      >
        <input type="hidden" name="id" value={debt.id} />
        <label htmlFor={inputId} className="min-w-0 flex-1 text-sm">
          <span className="block font-medium text-ink">{debt.name}</span>
          <span className="block text-xs text-ink-3">{debt.detail}</span>
        </label>
        <div className="relative w-28">
          <Input
            id={inputId}
            name="apr"
            data-rate
            inputMode="decimal"
            placeholder="APR"
            autoComplete="off"
            autoFocus={autoFocus}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="pr-7 text-right"
            disabled={pending || state?.ok}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-3">
            %
          </span>
        </div>
        <Button type="submit" variant="secondary" disabled={pending || state?.ok}>
          {pending ? "Saving..." : state?.ok ? "Saved" : "Save"}
        </Button>
      </form>
      {error ? (
        <p id={errorId} className="mt-1 text-xs text-bad" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function RateEntry({ debts, autoFocus }: { debts: RateNeeded[]; autoFocus: boolean }) {
  const list = useRef<HTMLUListElement>(null);
  const entering = useRef(false);
  const ids = debts.map((d) => d.id).join();

  // A saved row leaves the list when the page refreshes; keep the keyboard on the next empty box.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the set of rows changes
  useEffect(() => {
    if (!entering.current) return;
    entering.current = false;
    const next = Array.from(list.current?.querySelectorAll<HTMLInputElement>("input[data-rate]") ?? []).find(
      (el) => el.value === "",
    );
    next?.focus();
  }, [ids]);

  return (
    <ul ref={list} className="flex flex-col gap-3" data-testid="rate-entry">
      {debts.map((d, i) => (
        <RateRow
          key={d.id}
          debt={d}
          autoFocus={autoFocus && i === 0}
          onSubmit={() => {
            entering.current = true;
          }}
        />
      ))}
    </ul>
  );
}
