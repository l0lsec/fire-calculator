// Progress you can see: a bar with "2 of 4 done" and a numbered step list
// with done marks. Server-safe (no client state).
import Link from "next/link";

export interface StepItem {
  n: number;
  title: string;
  done: boolean;
  href?: string;
  current?: boolean;
}

export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pctDone = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-ink-3">
        <span>{label}</span>
        <span className="num" data-testid="progress-count">
          {done} of {total} done
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total} done`}
      >
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pctDone}%` }} />
      </div>
    </div>
  );
}

export function StepList({ steps }: { steps: StepItem[] }) {
  return (
    <ol className="flex flex-col gap-1" data-testid="step-list">
      {steps.map((s) => {
        const body = (
          <>
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                s.done
                  ? "bg-accent text-accent-ink"
                  : s.current
                    ? "border-2 border-accent text-accent"
                    : "border border-line text-ink-3"
              }`}
            >
              {s.done ? "✓" : s.n}
            </span>
            <span className={s.done ? "text-ink-3 line-through decoration-ink-3/40" : "text-ink"}>
              {s.title}
            </span>
            <span className="sr-only">{s.done ? " (done)" : s.current ? " (current step)" : " (to do)"}</span>
          </>
        );
        const cls = `flex min-h-10 items-center gap-3 rounded-lg px-2 text-sm pointer-coarse:min-h-11 ${
          s.current ? "bg-surface-2 font-medium" : ""
        }`;
        return (
          <li key={s.n} data-done={s.done ? "true" : "false"}>
            {s.href ? (
              <Link
                href={s.href}
                className={`${cls} hover:bg-surface-2`}
                aria-current={s.current ? "step" : undefined}
              >
                {body}
              </Link>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
