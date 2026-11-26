"use client";
// One polite status region for the whole app. A toast says what just happened
// and, only when the change can really be reversed, offers Undo.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

export interface ToastInput {
  message: string;
  tone?: "good" | "bad" | "info";
  /** Reverses the change. Offer it only for changes that can really be undone. */
  undo?: () => Promise<unknown> | unknown;
}

interface Toast extends ToastInput {
  id: number;
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

/** Shows a toast; a no-op outside the provider (the caller's inline feedback still shows). */
export function useToast(): (t: ToastInput) => void {
  return useContext(ToastContext) ?? noop;
}
function noop() {}

const LIFETIME_MS = 6000;
const UNDO_LIFETIME_MS = 10000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback((t: ToastInput) => {
    const id = next.current++;
    // One at a time keeps the region readable; the newest replaces the last.
    setToasts([{ ...t, id }]);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <section
        aria-label="Notifications"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => dismiss(t.id)} />
        ))}
      </section>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [undoing, setUndoing] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDone, toast.undo ? UNDO_LIFETIME_MS : LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [paused, toast.undo, onDone]);
  const tone =
    toast.tone === "bad"
      ? "border-bad/40 bg-bad-soft text-bad"
      : toast.tone === "info"
        ? "border-line bg-surface text-ink"
        : "border-accent/30 bg-accent-soft text-ink";
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only pause the timer so it can be read
    <div
      data-testid="toast"
      role={toast.tone === "bad" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-xl border px-4 py-2 text-sm shadow-lg ${tone}`}
    >
      <span>{toast.message}</span>
      <span className="flex shrink-0 items-center gap-1">
        {toast.undo ? (
          <button
            type="button"
            disabled={undoing}
            data-testid="toast-undo"
            className="min-h-10 rounded-lg px-3 font-medium text-accent hover:bg-surface-2 disabled:opacity-50 pointer-coarse:min-h-11"
            onClick={async () => {
              setUndoing(true);
              try {
                await toast.undo?.();
              } finally {
                onDone();
              }
            }}
          >
            {undoing ? "Undoing..." : "Undo"}
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Close notification"
          className="min-h-10 min-w-10 rounded-lg text-ink-3 hover:bg-surface-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          onClick={onDone}
        >
          ×
        </button>
      </span>
    </div>
  );
}
