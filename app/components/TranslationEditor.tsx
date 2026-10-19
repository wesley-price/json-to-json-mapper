"use client";

// Editors used in the Mappings tab: a value translation table for a mapping,
// and the form for adding a constant value to a target field.

import { useState } from "react";
import { type Path, pathId, pathLabel } from "@/lib/json-tree";
import { type DbRef, type Otherwise, type Translation, emptyTranslation } from "@/lib/transforms";
import { inferScalar } from "@/lib/formats/xml";
import type { Json } from "@/lib/json-tree";

const inputClass =
  "rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-950";

export function TranslationEditor({
  value,
  sampleValues,
  onChange,
  onClose,
}: {
  value: Translation | undefined;
  /** Distinct values seen in the source sample, for prefilling. */
  sampleValues: string[];
  onChange: (t: Translation | undefined) => void;
  onClose: () => void;
}) {
  const t = value ?? emptyTranslation();
  const set = (patch: Partial<Translation>) => onChange({ ...t, ...patch });
  const setPair = (i: number, k: 0 | 1, v: string) =>
    set({ pairs: t.pairs.map((p, j) => (j === i ? ((k === 0 ? [v, p[1]] : [p[0], v]) as [string, string]) : p)) });
  const missing = sampleValues.filter((v) => !t.pairs.some(([from]) => from.trim().toLowerCase() === v.trim().toLowerCase()));

  return (
    <div className="ml-6 mt-1 mb-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-950/40">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Translate values</span>
        <span className="text-zinc-500">matching ignores case and spaces</span>
        <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          Done
        </button>
      </div>
      <table className="w-full max-w-xl">
        <thead className="text-left text-zinc-500">
          <tr>
            <th className="pb-1 font-normal">Source value</th>
            <th />
            <th className="pb-1 font-normal">Becomes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {t.pairs.map(([from, to], i) => (
            <tr key={i}>
              <td className="py-0.5 pr-1">
                <input
                  value={from}
                  onChange={(e) => setPair(i, 0, e.target.value)}
                  aria-label={`Source value ${i + 1}`}
                  className={`${inputClass} w-full`}
                />
              </td>
              <td className="px-1 text-zinc-400">→</td>
              <td className="py-0.5 pr-1">
                <input
                  value={to}
                  onChange={(e) => setPair(i, 1, e.target.value)}
                  aria-label={`Becomes ${i + 1}`}
                  className={`${inputClass} w-full`}
                />
              </td>
              <td>
                <button
                  onClick={() => set({ pairs: t.pairs.filter((_, j) => j !== i) })}
                  aria-label="Remove row"
                  className="px-1 text-zinc-400 hover:text-red-600"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          onClick={() => set({ pairs: [...t.pairs, ["", ""]] })}
          className="rounded px-1.5 py-0.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
        >
          + Add row
        </button>
        {missing.length > 0 && (
          <button
            onClick={() => set({ pairs: [...t.pairs, ...missing.map((v): [string, string] => [v, ""])] })}
            className="rounded px-1.5 py-0.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
            title={missing.join(", ")}
          >
            + Add sample values ({missing.length})
          </button>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
          Anything else
          <select
            value={t.otherwise}
            onChange={(e) => set({ otherwise: e.target.value as Otherwise })}
            aria-label="Values not in the table"
            className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="keep">stays as it is</option>
            <option value="default">becomes</option>
            <option value="empty">becomes empty</option>
          </select>
          {t.otherwise === "default" && (
            <input
              value={t.defaultValue}
              onChange={(e) => set({ defaultValue: e.target.value })}
              aria-label="Default value"
              placeholder="default"
              className={`${inputClass} w-24`}
            />
          )}
        </span>
      </div>
      {(t.pairs.length > 0 || t.otherwise !== "keep") && (
        <button onClick={() => onChange(undefined)} className="mt-1 text-zinc-500 hover:text-red-600">
          Remove translation
        </button>
      )}
    </div>
  );
}

/** Add a fixed value to a target field. */
export function ConstantForm({
  fields,
  onAdd,
  onCancel,
}: {
  fields: Path[];
  onAdd: (target: Path, constant: { value: Json; db?: DbRef }) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState(fields[0] ? pathId(fields[0]) : "");
  const [draft, setDraft] = useState<ConstantDraft>({ kind: "value", value: "", table: "", column: "", where: "" });
  const submit = () => {
    if (target) onAdd(JSON.parse(target) as Path, fromDraft(draft));
  };
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-blue-300 bg-blue-50/40 p-2 text-xs dark:border-blue-900 dark:bg-blue-950/20">
      <span className="text-zinc-600 dark:text-zinc-400">Constant</span>
      <span
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
      >
        <ConstantFields draft={draft} onChange={setDraft} />
      </span>
      <span className="text-zinc-500">→</span>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        aria-label="Target field"
        className="max-w-72 rounded border border-zinc-300 bg-white px-1 py-0.5 font-mono dark:border-zinc-700 dark:bg-zinc-900"
      >
        {fields.map((f) => (
          <option key={pathId(f)} value={pathId(f)}>
            {pathLabel(f)}
          </option>
        ))}
      </select>
      <button onClick={submit} disabled={!target} className="rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-700 disabled:opacity-40">
        Add
      </button>
      <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        Cancel
      </button>
      <span className="w-full text-zinc-500">
        {draft.kind === "value"
          ? "Numbers and true/false are stored as such; anything else as text."
          : "Records which database table and column the value comes from. The sample is used in previews."}
      </span>
    </div>
  );
}

// ---------- Constant source: hardcoded value or database table/column ----------

export interface ConstantDraft {
  kind: "value" | "db";
  value: string;
  table: string;
  column: string;
  /** Which row to read (the lookup key), e.g. "code = errorCode". */
  where: string;
}

export function draftOf(value: Json | undefined, db?: DbRef): ConstantDraft {
  const text = value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return { kind: db ? "db" : "value", value: text, table: db?.table ?? "", column: db?.column ?? "", where: db?.where ?? "" };
}

/** The constant a draft describes. Numbers and true/false become real numbers/booleans. */
export function fromDraft(d: ConstantDraft): { value: Json; db?: DbRef } {
  // Not trimmed here: this runs on every keystroke, and trimming would swallow typed spaces.
  const value = inferScalar(d.value);
  return d.kind === "db" ? { value, db: { table: d.table, column: d.column, ...(d.where ? { where: d.where } : {}) } } : { value };
}

/** Hardcoded | Database switch plus the matching inputs. */
export function ConstantFields({ draft, onChange }: { draft: ConstantDraft; onChange: (d: ConstantDraft) => void }) {
  const set = (patch: Partial<ConstantDraft>) => onChange({ ...draft, ...patch });
  const tab = (kind: ConstantDraft["kind"], label: string) => (
    <button
      type="button"
      onClick={() => set({ kind })}
      aria-pressed={draft.kind === kind}
      className={`px-2 py-0.5 ${
        draft.kind === kind
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 font-sans text-xs" onClick={(e) => e.stopPropagation()}>
      <span className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
        {tab("value", "Hardcoded")}
        {tab("db", "Database")}
      </span>
      {draft.kind === "value" ? (
        <input
          value={draft.value}
          onChange={(e) => set({ value: e.target.value })}
          placeholder="value"
          aria-label="Constant value"
          className={`${inputClass} w-36`}
        />
      ) : (
        <>
          <input
            value={draft.table}
            onChange={(e) => set({ table: e.target.value })}
            placeholder="table"
            aria-label="Database table"
            className={`${inputClass} w-32`}
          />
          <span className="text-zinc-400">.</span>
          <input
            value={draft.column}
            onChange={(e) => set({ column: e.target.value })}
            placeholder="column"
            aria-label="Database column"
            className={`${inputClass} w-28`}
          />
          <span className="text-zinc-500">where</span>
          <input
            value={draft.where}
            onChange={(e) => set({ where: e.target.value })}
            placeholder="code = errorCode"
            aria-label="Database lookup"
            title="Which row to read: the key column and the source field (or value) it matches"
            className={`${inputClass} w-40 ${draft.where.trim() ? "" : "border-amber-400 dark:border-amber-600"}`}
          />
          <input
            value={draft.value}
            onChange={(e) => set({ value: e.target.value })}
            placeholder="sample (optional)"
            aria-label="Sample value"
            title="Used in previews and Test all; leave empty to show {table.column}"
            className={`${inputClass} w-32`}
          />
        </>
      )}
    </span>
  );
}
