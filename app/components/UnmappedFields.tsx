"use client";

// "⚠ 3 unmapped": the target fields no mapping writes on the current screen.
// Each can get a decision (keep its example value, leave it out, send null)
// or be tagged as a constant, so nothing is left to the implementer's guess.

import { useEffect, useRef, useState } from "react";
import type { Path } from "@/lib/json-tree";
import { type FieldDecision, type UnmappedField, UNMAPPED_OPTIONS, UNMAPPED_SHORT as short, type UnmappedPolicy } from "@/lib/spec";

export function UnmappedChip({
  fields,
  open,
  onToggle,
  onClose,
  rule,
  onDecide,
  onQuestion,
  onMakeConstant,
  onShow,
  onOpenRules,
  onStep,
  onHover,
  highlight,
  onToggleHighlight,
}: {
  fields: UnmappedField[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** The document rule for unmapped fields. */
  rule: UnmappedPolicy;
  onDecide: (path: Path, decision: FieldDecision | null) => void;
  /** The question / who to ask, for a field marked "ask". */
  onQuestion: (path: Path, question: string) => void;
  onMakeConstant: (path: Path) => void;
  onShow: (path: Path) => void;
  onOpenRules: () => void;
  /** Jump to the previous / next unmapped field in the tree. */
  onStep: (dir: -1 | 1) => void;
  /** Hovering the button lights the unmapped fields up in the tree. */
  onHover: (on: boolean) => void;
  /** Whether undecided unmapped fields stay highlighted in the tree. */
  highlight: boolean;
  onToggleHighlight: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const hover = (on: boolean) => {
    setHovered(on);
    onHover(on);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open, onClose]);

  const undecided = fields.filter((f) => !f.decision).length;
  const asks = fields.filter((f) => f.effective === "ask").length;
  if (fields.length === 0) {
    return (
      <span
        className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
        title="Every target field has a mapping or a constant"
      >
        ✓ All fields mapped
      </span>
    );
  }
  return (
    <div ref={ref} className="relative flex items-center gap-0.5">
      <button
        onClick={onToggle}
        onMouseEnter={() => hover(true)}
        onMouseLeave={() => hover(false)}
        onFocus={() => hover(true)}
        onBlur={() => hover(false)}
        aria-expanded={open}
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          undecided
            ? "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300"
            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
        }`}
        title="Target fields with no mapping on this screen"
      >
        {undecided ? "⚠" : "✓"} {fields.length} unmapped{undecided && undecided < fields.length ? ` · ${undecided} undecided` : ""}
        {asks > 0 && ` · ❓ ${asks} open question${asks === 1 ? "" : "s"}`}
      </button>
      <button
        onClick={onToggleHighlight}
        aria-pressed={highlight}
        aria-label={highlight ? "Turn off unmapped highlighting" : "Turn on unmapped highlighting"}
        title={highlight ? "Highlighting unmapped fields in the tree (click to turn off)" : "Unmapped fields aren't highlighted in the tree (click to turn on)"}
        className={`rounded px-1 text-xs ${highlight ? "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950" : "text-zinc-400 line-through hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
      >
        ◐
      </button>
      {fields.length > 1 && (
        <>
          <button onClick={() => onStep(-1)} aria-label="Previous unmapped field" title="Previous unmapped field" className="rounded px-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
            ‹
          </button>
          <button onClick={() => onStep(1)} aria-label="Next unmapped field" title="Next unmapped field" className="rounded px-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
            ›
          </button>
        </>
      )}
      {hovered && !open && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-amber-200 bg-white p-2 text-xs shadow-lg dark:border-amber-900 dark:bg-zinc-900"
        >
          <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">No mapping yet (lit up in the tree):</p>
          <ul className="flex flex-col gap-0.5">
            {fields.slice(0, 12).map((f) => (
              <li key={f.label} className="flex justify-between gap-2">
                <span className="truncate font-mono">{f.label}</span>
                <span className={f.decision ? "shrink-0 text-zinc-500" : "shrink-0 text-amber-700 dark:text-amber-400"}>
                  {f.effective === "ask" ? "❓ ask an expert" : f.decision ? short[f.effective] : "undecided"}
                </span>
              </li>
            ))}
            {fields.length > 12 && <li className="text-zinc-500">…and {fields.length - 12} more</li>}
          </ul>
          <p className="mt-1.5 text-zinc-500">Click to decide what each gets.</p>
        </div>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Unmapped fields"
          className="absolute left-0 top-full z-30 mt-1 flex max-h-[70vh] w-[30rem] max-w-[90vw] flex-col gap-2 overflow-auto rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <p className="text-zinc-600 dark:text-zinc-400">
            {fields.length} target field{fields.length === 1 ? " has" : "s have"} no mapping here. Decide what each gets so the
            implementer doesn&apos;t have to guess. Without a decision, the document rule applies:{" "}
            <button onClick={onOpenRules} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
              {short[rule]}
            </button>
            .
          </p>
          <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
            {fields.map((f) => (
              <li key={f.label} className="flex flex-wrap items-center gap-2 py-1.5">
                <button
                  onClick={() => onShow(f.path)}
                  className="min-w-0 flex-1 truncate text-left font-mono text-zinc-800 hover:underline dark:text-zinc-200"
                  title="Show this field"
                >
                  {f.label}
                </button>
                <select
                  value={f.decision ?? ""}
                  onChange={(e) => onDecide(f.path, (e.target.value || null) as FieldDecision | null)}
                  aria-label={`What ${f.label} gets`}
                  className={`rounded-md border px-1 py-0.5 ${
                    f.decision
                      ? "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"
                      : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
                  }`}
                >
                  <option value="">Document rule ({short[rule]})</option>
                  {UNMAPPED_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => onMakeConstant(f.path)}
                  className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950"
                  title="Tag this field as a constant (a fixed value written every time)"
                >
                  📌 Constant
                </button>
                {f.effective === "ask" && (
                  <input
                    defaultValue={f.question ?? ""}
                    onChange={(e) => onQuestion(f.path, e.target.value)}
                    placeholder="The question, and who to ask (e.g. Is this the order or invoice date? — Finance, Priya)"
                    aria-label={`Question about ${f.label}`}
                    className={`basis-full rounded-md border px-2 py-1 ${
                      f.question
                        ? "border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40"
                        : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
                    }`}
                  />
                )}
              </li>
            ))}
          </ul>
          <p className="text-zinc-500">
            Or map them: click a source field, then the target field. Fields still needing a decision stay tinted amber in the tree; ‹ › next to the button steps through them.
          </p>
        </div>
      )}
    </div>
  );
}

/** Label shown on an unmapped row in the tree. */
export const unmappedTag = (f: UnmappedField) =>
  f.effective === "ask"
    ? "❓ ask an expert"
    : !f.decision
      ? "⚠ unmapped"
      : { example: "unmapped · default", omit: "unmapped · left out", null: "unmapped · null", ask: "" }[f.effective];
