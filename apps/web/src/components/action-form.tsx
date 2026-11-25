"use client";
// A server-action form with inline field errors and a pending state.
import {
  createContext,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";
import type { ActionResult, FieldErrors } from "@/server/forms";
import { Button, Field, Input, Notice, Select } from "./ui";

const Errors = createContext<FieldErrors>({});

export type FormAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  resetOnSuccess = false,
  className = "",
  variant = "primary",
  successMessage,
}: {
  action: FormAction;
  children?: ReactNode;
  submitLabel?: string;
  resetOnSuccess?: boolean;
  className?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  successMessage?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form ref={ref} action={formAction} className={`flex flex-col gap-3 ${className}`} noValidate>
      <Errors.Provider value={errors}>{children}</Errors.Provider>
      {state && !state.ok && state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state && !state.ok && !state.error && Object.keys(errors).length > 0 ? (
        <p className="sr-only" role="alert">
          Please fix the highlighted fields.
        </p>
      ) : null}
      {state?.ok && successMessage ? <Notice tone="good">{successMessage}</Notice> : null}
      <div>
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
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
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-ink-2">
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

/** A one-button form for deletes and toggles; confirms first when asked. */
export function ButtonForm({
  action,
  label,
  confirm,
  variant = "ghost",
  hidden,
}: {
  action: FormAction;
  label: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex items-center gap-2"
    >
      {hidden
        ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)
        : null}
      <Button type="submit" variant={variant} disabled={pending} className="min-h-8 px-2.5 text-xs">
        {label}
      </Button>
      {state && !state.ok && state.error ? <span className="text-xs text-bad">{state.error}</span> : null}
    </form>
  );
}
