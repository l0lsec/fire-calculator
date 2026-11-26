// Small, shared UI primitives. Tokens come from globals.css.
import Link from "next/link";
import type { ComponentProps, ReactNode, SelectHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2",
  danger: "bg-bad text-white hover:opacity-90",
};

export function Button({
  variant = "primary",
  className = "",
  ...rest
}: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-10 items-center pointer-coarse:min-h-11 justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

/** A link that looks and sizes like a Button, for "go do this" calls to action. */
export function ButtonLink({
  variant = "secondary",
  className = "",
  ...rest
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors pointer-coarse:min-h-11 ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-ink-3">{hint}</p> : null}
      {error ? (
        <p className="text-xs text-bad" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className = "", ...rest }: ComponentProps<"input">) {
  return (
    <input
      className={`min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink pointer-coarse:min-h-11 placeholder:text-ink-3 focus:border-accent ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink pointer-coarse:min-h-11 focus:border-accent ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Anchor for links such as /plan#income. */
  id?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-20 rounded-2xl border border-line bg-surface p-5 ${className}`}>
      {title || action ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="text-base font-semibold text-ink">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "bad" | "good";
  children: ReactNode;
}) {
  const tones = {
    info: "bg-surface-2 text-ink-2",
    warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad",
    good: "bg-accent-soft text-accent",
  } as const;
  return <div className={`rounded-lg px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}

export function Disclaimer() {
  return (
    <p className="text-xs text-ink-3">
      Estimates for education and planning, based on your assumptions. Not financial advice.
    </p>
  );
}
