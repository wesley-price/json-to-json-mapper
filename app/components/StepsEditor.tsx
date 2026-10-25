"use client";

// Value transformations for one mapping: a chain of steps (dates, text,
// numbers, defaults, if/then/else, conversions) with a live preview of the
// sample value going through them. Steps run before the translation table.

import type { Json } from "@/lib/json-tree";
import { DATE_PATTERNS, STEP_KINDS, type Step, applySteps, describeStep } from "@/lib/steps";

const input =
  "rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900";
const show = (v: Json | undefined) => (v === undefined ? "(missing)" : JSON.stringify(v));

export function StepsEditor({
  steps,
  sample,
  onChange,
  onClose,
}: {
  steps: Step[];
  /** A sample value the mapping reads (for the preview). */
  sample: Json | undefined;
  onChange: (steps: Step[]) => void;
  onClose: () => void;
}) {
  const update = (i: number, patch: Partial<Step>) => onChange(steps.map((s, j) => (j === i ? ({ ...s, ...patch } as Step) : s)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

  const fields = (s: Step, i: number) => {
    switch (s.op) {
      case "date":
        return (
          <>
            from
            <input list="date-patterns" value={s.from} onChange={(e) => update(i, { from: e.target.value })} aria-label="Date pattern in" className={`${input} w-40`} />
            to
            <input list="date-patterns" value={s.to} onChange={(e) => update(i, { to: e.target.value })} aria-label="Date pattern out" className={`${input} w-40`} />
          </>
        );
      case "substring":
        return (
          <>
            from character
            <input type="number" min={1} value={s.start + 1} onChange={(e) => update(i, { start: Math.max(0, (Number(e.target.value) || 1) - 1) })} aria-label="Start" className={`${input} w-16`} />
            length
            <input type="number" min={0} value={s.length ?? ""} onChange={(e) => update(i, { length: num(e.target.value) })} placeholder="rest" aria-label="Length" className={`${input} w-16`} />
          </>
        );
      case "replace":
        return (
          <>
            <input value={s.find} onChange={(e) => update(i, { find: e.target.value })} placeholder="find" aria-label="Find" className={`${input} w-32`} />
            with
            <input value={s.with} onChange={(e) => update(i, { with: e.target.value })} placeholder="(nothing)" aria-label="Replace with" className={`${input} w-32`} />
          </>
        );
      case "prefix":
      case "suffix":
        return <input value={s.text} onChange={(e) => update(i, { text: e.target.value })} placeholder="text" aria-label="Text" className={`${input} w-40`} />;
      case "number":
        return (
          <>
            ×
            <input value={s.multiply ?? ""} onChange={(e) => update(i, { multiply: num(e.target.value) })} placeholder="1" aria-label="Multiply by" className={`${input} w-16`} />
            +
            <input value={s.add ?? ""} onChange={(e) => update(i, { add: num(e.target.value) })} placeholder="0" aria-label="Add" className={`${input} w-16`} />
            decimals
            <input value={s.decimals ?? ""} onChange={(e) => update(i, { decimals: num(e.target.value) })} placeholder="any" aria-label="Decimals" className={`${input} w-14`} />
          </>
        );
      case "default":
        return <input value={s.value} onChange={(e) => update(i, { value: e.target.value })} placeholder="value when empty" aria-label="Default value" className={`${input} w-40`} />;
      case "if":
        return (
          <>
            <select value={s.test} onChange={(e) => update(i, { test: e.target.value as typeof s.test })} aria-label="Test" className={input}>
              <option value="equals">=</option>
              <option value="not-equals">≠</option>
              <option value="contains">contains</option>
              <option value="gt">&gt;</option>
              <option value="lt">&lt;</option>
              <option value="empty">is empty</option>
            </select>
            {s.test !== "empty" && <input value={s.value} onChange={(e) => update(i, { value: e.target.value })} aria-label="Compare with" className={`${input} w-24`} />}
            then
            <input value={s.then} onChange={(e) => update(i, { then: e.target.value })} placeholder="keep" aria-label="Then" className={`${input} w-24`} />
            else
            <input value={s.else} onChange={(e) => update(i, { else: e.target.value })} placeholder="keep" aria-label="Else" className={`${input} w-24`} />
          </>
        );
      default:
        return null;
    }
  };

  // The sample after each step.
  const trail = steps.map((_, i) => applySteps(sample ?? null, steps.slice(0, i + 1)));

  return (
    <div className="ml-6 mr-2 my-1 flex flex-col gap-2 rounded-md border border-dashed border-sky-300 bg-sky-50/50 p-2 text-xs dark:border-sky-900 dark:bg-sky-950/20">
      <datalist id="date-patterns">
        {DATE_PATTERNS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div className="flex items-center gap-2">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Transform the value</span>
        <span className="text-zinc-500">steps run top to bottom, before any translation table</span>
        <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          Done
        </button>
      </div>
      {steps.length === 0 && <p className="text-zinc-500">No steps yet: the value is copied as it is.</p>}
      <ol className="flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1.5">
            <span className="w-4 text-right text-zinc-400">{i + 1}.</span>
            <span className="font-medium">{STEP_KINDS.find((k) => k.op === s.op)?.label}</span>
            {fields(s, i)}
            <span className="font-mono text-zinc-500" title={describeStep(s)}>
              → {show(trail[i])}
            </span>
            <span className="ml-auto flex gap-0.5">
              <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move step up" className="px-1 text-zinc-400 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100">
                ↑
              </button>
              <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Move step down" className="px-1 text-zinc-400 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100">
                ↓
              </button>
              <button onClick={() => onChange(steps.filter((_, j) => j !== i))} aria-label="Remove step" className="px-1 text-zinc-400 hover:text-red-600">
                ×
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value=""
          onChange={(e) => {
            const kind = STEP_KINDS.find((k) => k.op === e.target.value);
            if (kind) onChange([...steps, kind.make()]);
          }}
          aria-label="Add step"
          className={`${input} font-sans`}
        >
          <option value="">+ Add step…</option>
          {STEP_KINDS.map((k) => (
            <option key={k.op} value={k.op}>
              {k.label}
            </option>
          ))}
        </select>
        <span className="text-zinc-500">
          Sample: <span className="font-mono">{show(sample)}</span>
          {steps.length > 0 && (
            <>
              {" "}
              → <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">{show(trail[trail.length - 1])}</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
