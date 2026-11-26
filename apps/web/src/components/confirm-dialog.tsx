"use client";
// A confirmation step for actions that cannot be undone or stop something
// working. Built on the native <dialog> element: it traps focus, Escape and a
// click outside cancel, and focus starts on Cancel when the action is
// destructive so Enter alone never destroys anything.
import { useEffect, useId, useRef } from "react";
import { Button } from "./ui";

export interface ConfirmSpec {
  /** Names the thing: "Delete Chase Visa?" */
  title: string;
  /** Names the consequence: "Its balance leaves your net worth. This cannot be undone." */
  body?: string;
  /** The verb on the button: "Delete". */
  confirmLabel?: string;
  /** Red button and focus on Cancel. */
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  spec,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  spec: ConfirmSpec;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      (spec.destructive ? cancelRef : confirmRef).current?.focus();
    } else if (!open && d.open) d.close();
  }, [open, spec.destructive]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only catches the backdrop; Escape cancels natively
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={spec.body ? bodyId : undefined}
      data-testid="confirm-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === ref.current) onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 id={titleId} className="text-base font-semibold">
          {spec.title}
        </h2>
        {spec.body ? (
          <p id={bodyId} className="text-sm text-ink-2">
            {spec.body}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            variant={spec.destructive ? "danger" : "primary"}
            onClick={onConfirm}
            data-testid="confirm-dialog-confirm"
          >
            {spec.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** Reads a short confirm string as a dialog: the label is the verb, the string the question. */
export function toConfirmSpec(confirm: string | ConfirmSpec, label: string, danger: boolean): ConfirmSpec {
  if (typeof confirm !== "string") return { confirmLabel: label, destructive: danger, ...confirm };
  // "Disconnect Chase? Its accounts stay..." -> title "Disconnect Chase?", body the rest.
  const i = confirm.indexOf("? ");
  const title = i > 0 ? confirm.slice(0, i + 1) : confirm;
  const body = i > 0 ? confirm.slice(i + 2) : undefined;
  return { title, ...(body ? { body } : {}), confirmLabel: label, destructive: danger };
}
