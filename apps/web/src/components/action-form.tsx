"use client";
// Server-action forms: inline field errors, a pending state, and feedback when done.
import {
  createContext,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  startTransition,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ActionResult, FieldErrors } from "@/server/forms";
import { ConfirmDialog, type ConfirmSpec, toConfirmSpec } from "./confirm-dialog";
import { type ToastInput, useToast } from "./toast";
import { Button, Field, Input, Notice, Select } from "./ui";

const Errors = createContext<FieldErrors>({});

export type FormAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

/**
 * Submits through a transition we start ourselves (not `<form action>`), so
 * React does not reset the fields before the action runs: a save that fails
 * validation keeps everything the user typed. Fields clear only on success
 * when `resetOnSuccess` is set. After a failed submit the first invalid field
 * gets focus.
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  pendingLabel = "Saving...",
  resetOnSuccess = false,
  className = "",
  variant = "primary",
  successMessage,
  testId,
}: {
  action: FormAction;
  children?: ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  resetOnSuccess?: boolean;
  className?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  /** Shown after a save. A message the action returns (data.message) wins. */
  successMessage?: string;
  testId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state) return;
    if (state.ok && resetOnSuccess) ref.current?.reset();
    if (!state.ok) ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state, resetOnSuccess]);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const returned = state?.ok ? messageOf(state.data) : undefined;
  const done = returned ?? (state?.ok ? successMessage : undefined);
  return (
    <form
      ref={ref}
      action={formAction}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        const fd = new FormData(e.currentTarget, submitter instanceof HTMLElement ? submitter : null);
        startTransition(() => formAction(fd));
      }}
      className={`flex flex-col gap-3 ${className}`}
      data-testid={testId}
      noValidate
    >
      <Errors.Provider value={errors}>{children}</Errors.Provider>
      <div aria-live="polite" className="contents">
        {state && !state.ok && state.error ? <Notice tone="bad">{state.error}</Notice> : null}
        {state && !state.ok && !state.error && Object.keys(errors).length > 0 ? (
          <p className="sr-only" role="alert">
            Please fix the highlighted fields.
          </p>
        ) : null}
        {done ? <Notice tone="good">{done}</Notice> : null}
      </div>
      <div>
        <Button type="submit" variant={variant} disabled={pending} aria-busy={pending || undefined}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function messageOf(data: unknown): string | undefined {
  if (data && typeof data === "object" && "message" in data) {
    const m = (data as { message?: unknown }).message;
    return typeof m === "string" && m ? m : undefined;
  }
  return undefined;
}

function undoOf(data: unknown): Record<string, string> | undefined {
  if (data && typeof data === "object" && "undo" in data) {
    const u = (data as { undo?: unknown }).undo;
    if (u && typeof u === "object") return u as Record<string, string>;
  }
  return undefined;
}

export function FormInput({
  name,
  label,
  hint,
  ...rest
}: { name: string; label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const errors = useContext(Errors);
  const id = useId();
  const error = errors[name];
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <Input id={id} name={name} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export function FormSelect({
  name,
  label,
  hint,
  children,
  ...rest
}: {
  name: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const errors = useContext(Errors);
  const id = useId();
  const error = errors[name];
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <Select id={id} name={name} aria-invalid={error ? true : undefined} {...rest}>
        {children}
      </Select>
    </Field>
  );
}

export function FormCheckbox({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex min-h-10 items-center gap-2 text-sm text-ink-2 pointer-coarse:min-h-11"
    >
      <input
        id={id}
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

/**
 * A one-button form for row actions, deletes and toggles. Full size (40 px,
 * 44 px on touch), says it is working while pending, and says what happened
 * when done: `doneMessage` as a toast, or the action's own data.message. When
 * the action returns data.undo and `undo` is given, the toast offers Undo.
 * `confirm` opens a ConfirmDialog first; use it only for actions that cannot
 * be undone or stop something working.
 */
export function ButtonForm({
  action,
  label,
  confirm,
  variant = "ghost",
  hidden,
  pendingLabel,
  doneMessage,
  undo,
  testId,
}: {
  action: FormAction;
  label: string;
  confirm?: string | ConfirmSpec;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  hidden?: Record<string, string>;
  pendingLabel?: string;
  doneMessage?: string;
  undo?: FormAction;
  testId?: string;
}) {
  const toast = useToast();
  // The toast is raised inside the action, not in an effect: a delete or a
  // review choice removes its own row, so this form may unmount before any
  // effect of it runs. The provider stays mounted and shows it.
  const notifying = useCallback<FormAction>(
    async (prev, fd) => {
      const r = await action(prev, fd);
      const message = r.ok ? (messageOf(r.data) ?? doneMessage) : undefined;
      if (message) {
        const back = r.ok ? undoOf(r.data) : undefined;
        toast({
          message,
          tone: "good",
          ...(back && undo ? { undo: () => runUndo(undo, back, toast) } : {}),
        });
      }
      return r;
    },
    [action, doneMessage, undo, toast],
  );
  const [state, formAction, pending] = useActionState(notifying, null);
  const [asking, setAsking] = useState(false);
  const pendingData = useRef<FormData | null>(null);

  const run = (fd: FormData) => startTransition(() => formAction(fd));
  const spec = confirm
    ? toConfirmSpec(confirm, label, variant === "danger" || DESTRUCTIVE.test(label))
    : null;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (spec) {
          pendingData.current = fd;
          setAsking(true);
        } else run(fd);
      }}
      className="inline-flex flex-wrap items-center gap-2"
      data-testid={testId}
    >
      {hidden
        ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)
        : null}
      <Button type="submit" variant={variant} disabled={pending} aria-busy={pending || undefined}>
        {pending && pendingLabel ? pendingLabel : label}
        {pending && !pendingLabel ? <Spinner /> : null}
      </Button>
      <span aria-live="polite" className="text-xs">
        {state && !state.ok && state.error ? <span className="text-bad">{state.error}</span> : null}
      </span>
      {spec && asking ? (
        <ConfirmDialog
          open
          spec={spec}
          onCancel={() => {
            pendingData.current = null;
            setAsking(false);
          }}
          onConfirm={() => {
            setAsking(false);
            const fd = pendingData.current;
            pendingData.current = null;
            if (fd) run(fd);
          }}
        />
      ) : null}
    </form>
  );
}

const DESTRUCTIVE = /^(delete|remove|disconnect|unpair|erase)\b/i;

function runUndo(undo: FormAction, back: Record<string, string>, toast: (t: ToastInput) => void) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(back)) fd.set(k, v);
  return new Promise<void>((resolve) => {
    startTransition(async () => {
      const r = await undo(null, fd);
      toast(
        r.ok
          ? { message: "Undone.", tone: "info" }
          : { message: r.error ?? "Could not undo that.", tone: "bad" },
      );
      resolve();
    });
  });
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
