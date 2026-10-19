"use client";

// More values for one field of a source (multi-source mode): other messages,
// codes… the same field can carry that should all club to the same error.
// Each value is run through the cases, and the case it lands in is shown.

import { useRef, useState } from "react";
import type { Json } from "@/lib/json-tree";

/** Typed text -> a value of the same kind as the sample's (numbers stay numbers when they parse). */
export function parseLike(text: string, base: Json): Json {
  if (typeof base === "number" && text.trim() !== "" && !Number.isNaN(Number(text))) return Number(text);
  if (typeof base === "boolean" && /^(true|false)$/i.test(text.trim())) return text.trim().toLowerCase() === "true";
  return text;
}

const show = (v: Json) => (typeof v === "string" ? v : JSON.stringify(v));

/** The case a value lands in; a leading "!" marks a different case than the sample's. */
function CaseLabel({ name }: { name?: string }) {
  if (!name) return null;
  return name.startsWith("!") ? (
    <span className="shrink-0 text-amber-700 dark:text-amber-400" title="This value doesn't land in the same case as the sample">
      ⚠ {name.slice(1)}
    </span>
  ) : (
    <span className="shrink-0 text-emerald-700 dark:text-emerald-400">● {name}</span>
  );
}

export function MoreValuesEditor({
  sample,
  values,
  cases,
  sampleCase,
  onChange,
  onDone,
  indent,
}: {
  /** The field's value in the sample. */
  sample: Json;
  values: Json[];
  /** The case each value uses (same order as values), when known. */
  cases?: string[];
  /** The case the sample itself uses. */
  sampleCase?: string;
  onChange: (values: Json[]) => void;
  onDone: () => void;
  indent: number;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [paste, setPaste] = useState<string | null>(null);

  const add = () => {
    onChange([...values, typeof sample === "number" ? 0 : ""]);
    requestAnimationFrame(() => {
      const inputs = listRef.current?.querySelectorAll<HTMLInputElement>("input");
      inputs?.[inputs.length - 1]?.focus();
    });
  };
  const addPasted = () => {
    const extra = (paste ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => parseLike(l, sample));
    if (extra.length) onChange([...values, ...extra]);
    setPaste(null);
  };

  return (
    <div
      className="my-1 flex flex-col gap-1.5 rounded-md border border-dashed border-violet-300 bg-violet-50/50 py-1.5 pr-2 font-sans text-xs dark:border-violet-900 dark:bg-violet-950/20"
      style={{ paddingLeft: indent }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-baseline gap-2 text-zinc-600 dark:text-zinc-400">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">More values for this field</span>
        <span>
          Sample: <span className="font-mono">{show(sample)}</span> <CaseLabel name={sampleCase} />
        </span>
      </div>
      <div ref={listRef} className="flex flex-col gap-1">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={show(v)}
              onChange={(e) => onChange(values.map((x, j) => (j === i ? parseLike(e.target.value, sample) : x)))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (i === values.length - 1) add();
                }
              }}
              aria-label={`Value ${i + 2}`}
              className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <CaseLabel name={cases?.[i]} />
            <button
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              aria-label={`Remove value ${i + 2}`}
              className="text-zinc-400 hover:text-red-600"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {paste !== null && (
        <div className="flex flex-col gap-1">
          <textarea
            autoFocus
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="One value per line"
            aria-label="Paste values, one per line"
            rows={4}
            className="rounded border border-zinc-300 bg-white p-1.5 font-mono text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <div className="flex gap-2">
            <button onClick={addPasted} className="rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-700">
              Add these values
            </button>
            <button onClick={() => setPaste(null)} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button onClick={add} className="text-blue-600 hover:underline dark:text-blue-400">
          + Add value
        </button>
        <button
          onClick={() => setPaste((p) => (p === null ? "" : null))}
          aria-expanded={paste !== null}
          className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Paste a list…
        </button>
        <button
          onClick={() => {
            onChange(values.filter((v) => v !== ""));
            onDone();
          }}
          className="ml-auto text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Done
        </button>
      </div>
    </div>
  );
}
