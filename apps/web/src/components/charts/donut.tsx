// A donut for "what is this number made of". At most four named slices plus a
// gray "Other" (foldSlices in lib/breakdown.ts does the folding), each slice in a
// fixed chart token by position, a 2 px surface gap between slices, and a legend
// that lists every slice with its value and share (the table view), so nothing
// rests on color alone. Each slice carries its own hover tooltip.
import type { Slice } from "@/lib/breakdown";
import { pct, usd } from "@/lib/format";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
const OTHER = "var(--chart-5)";
const R = 40;

const point = (a: number, r: number) =>
  `${(50 + r * Math.sin(a)).toFixed(3)} ${(50 - r * Math.cos(a)).toFixed(3)}`;

function arc(a0: number, a1: number): string {
  return `M${point(a0, R)} A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${point(a1, R)}`;
}

export function Donut({ title, slices, testId }: { title: string; slices: Slice[]; testId?: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (slices.length === 0 || total <= 0) return null;
  const colorOf = (s: Slice, i: number) => (s.other ? OTHER : (COLORS[i] ?? OTHER));
  const starts: number[] = [];
  let a = 0;
  for (const s of slices) {
    starts.push(a);
    a += (s.value / total) * Math.PI * 2;
  }
  const share = (v: number) => (v > 0 && v / total < 0.005 ? "<1%" : pct(v / total, 0));
  const tip = (s: Slice) => `${s.label}: ${usd(s.value)} (${share(s.value)})`;

  return (
    <figure className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5" data-testid={testId}>
      <svg viewBox="0 0 100 100" className="size-36 shrink-0 self-center" role="img" aria-label={title}>
        {slices.length === 1 ? (
          <circle cx="50" cy="50" r={R} fill="none" stroke={colorOf(slices[0]!, 0)} strokeWidth={14}>
            <title>{tip(slices[0]!)}</title>
          </circle>
        ) : (
          slices.map((s, i) => (
            <path
              key={s.label}
              d={arc(starts[i]!, starts[i + 1] ?? Math.PI * 2)}
              fill="none"
              stroke={colorOf(s, i)}
              strokeWidth={14}
              className="transition-[stroke-width] hover:[stroke-width:17]"
            >
              <title>{tip(s)}</title>
            </path>
          ))
        )}
        {/* 2 px surface gaps between slices. */}
        {slices.length > 1
          ? starts.map((st, i) => (
              <line
                key={`gap-${slices[i]?.label}`}
                x1={50 + 31 * Math.sin(st)}
                y1={50 - 31 * Math.cos(st)}
                x2={50 + 49 * Math.sin(st)}
                y2={50 - 49 * Math.cos(st)}
                stroke="var(--surface)"
                strokeWidth={2}
                pointerEvents="none"
              />
            ))
          : null}
        <text x="50" y="47" textAnchor="middle" className="fill-ink-3" fontSize="7">
          Total
        </text>
        <text x="50" y="58" textAnchor="middle" className="fill-ink" fontSize="9" fontWeight="600">
          {usd(total, { compact: true })}
        </text>
      </svg>
      <figcaption className="min-w-0 flex-1 sm:max-w-md">
        <span className="sr-only">{title}</span>
        <ul className="flex flex-col text-sm">
          {slices.map((s, i) => (
            <li key={s.label} className="grid grid-cols-[0.75rem_1fr_auto_3rem] items-center gap-x-2 py-1">
              <span className="size-3 rounded-sm" style={{ background: colorOf(s, i) }} aria-hidden="true" />
              <span className="min-w-0 truncate text-ink">{s.label}</span>
              <span className="num text-right text-ink">{usd(s.value)}</span>
              <span className="num text-right text-ink-3">{share(s.value)}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
