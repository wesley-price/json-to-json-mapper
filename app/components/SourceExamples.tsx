"use client";

// Examples of a source in multi-source mode: the same object with some values
// changed (e.g. one error response carrying different messages). One row per
// field, one column per example; the sample is the first column. Each example
// is run through the cases, so you can see which case it uses.

import { useState } from "react";
import type { Json, Path } from "@/lib/json-tree";
import { pathId } from "@/lib/json-tree";
import type { SourceExample } from "@/lib/multi";

export interface ExampleField {
  path: Path;
  label: string;
  /** The sample's value. */
  base: Json;
}

/** Which case an example uses (or why none). */
export type ExampleOutcome = { caseName: string } | { error: string };

const show = (v: Json | undefined) => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));

/** Typed text -> a value of the same kind as the sample's (numbers stay numbers when they parse). */
function parseLike(text: string, base: Json): Json {
  if (typeof base === "number" && text.trim() !== "" && !Number.isNaN(Number(text))) return Number(text);
  if (typeof base === "boolean" && /^(true|false)$/i.test(text.trim())) return text.trim().toLowerCase() === "true";
  if (base === null && text.trim() === "null") return null;
  return text;
}

export function SourceExamples({
  sourceName,
  fields,
  examples,
  sampleOutcome,
  outcomes,
  onChange,
  newId,
}: {
  sourceName: string;
  fields: ExampleField[];
  examples: SourceExample[];
  sampleOutcome: ExampleOutcome | null;
  /** Example id -> outcome. */
  outcomes: Record<string, ExampleOutcome>;
  onChange: (examples: SourceExample[]) => void;
  newId: () => string;
}) {
  const [onlyChanged, setOnlyChanged] = useState(false);
  if (fields.length === 0) return <p className="text-sm text-zinc-500">Load a sample for {sourceName} first.</p>;

  const update = (id: string, fn: (ex: SourceExample) => SourceExample) =>
    onChange(examples.map((ex) => (ex.id === id ? fn(ex) : ex)));
  const setValue = (ex: SourceExample, field: ExampleField, text: string) =>
    update(ex.id, (e) => {
      const values = { ...e.values };
      const value = parseLike(text, field.base);
      if (show(value) === show(field.base) && typeof value === typeof field.base) delete values[pathId(field.path)];
      else values[pathId(field.path)] = value;
      return { ...e, values };
    });
  const add = () => onChange([...examples, { id: newId(), name: `Example ${examples.length + 2}`, values: {} }]);
  const duplicate = (ex: SourceExample) =>
    onChange([...examples, { id: newId(), name: `${ex.name} (copy)`, values: { ...ex.values } }]);

  const changedIds = new Set(examples.flatMap((ex) => Object.keys(ex.values)));
  const visible = onlyChanged && examples.length ? fields.filter((f) => changedIds.has(pathId(f.path))) : fields;

  const outcome = (o: ExampleOutcome | null | undefined) =>
    !o ? (
      <span className="text-zinc-400">—</span>
    ) : "error" in o ? (
      <span className="text-amber-700 dark:text-amber-400">{o.error}</span>
    ) : (
      <span className="text-emerald-700 dark:text-emerald-400">● {o.caseName}</span>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
        <span>
          More messages of <span className="font-medium text-zinc-700 dark:text-zinc-300">{sourceName}</span>: same
          fields, different values. Each one is checked against the cases.
        </span>
        <label className="ml-auto flex items-center gap-1.5">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
          Only fields that differ
        </label>
        <button
          onClick={add}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          + Add example
        </button>
      </div>

      <div className="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <th className="sticky left-0 bg-zinc-50 px-2 py-1.5 font-normal text-zinc-500 dark:bg-zinc-900">Field</th>
              <th className="px-2 py-1.5 font-medium text-zinc-600 dark:text-zinc-300">Sample</th>
              {examples.map((ex) => (
                <th key={ex.id} className="min-w-40 px-1 py-1">
                  <div className="flex items-center gap-1">
                    <input
                      value={ex.name}
                      onChange={(e) => update(ex.id, (x) => ({ ...x, name: e.target.value }))}
                      aria-label="Example name"
                      className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium text-zinc-800 outline-none hover:border-zinc-300 focus:border-blue-500 dark:text-zinc-100 dark:hover:border-zinc-700"
                    />
                    <button
                      onClick={() => duplicate(ex)}
                      title="Duplicate this example"
                      aria-label={`Duplicate ${ex.name}`}
                      className="rounded px-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      ⧉
                    </button>
                    <button
                      onClick={() => onChange(examples.filter((x) => x.id !== ex.id))}
                      title="Remove this example"
                      aria-label={`Remove ${ex.name}`}
                      className="rounded px-1 text-zinc-400 hover:text-red-600"
                    >
                      ×
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {visible.map((f) => (
              <tr key={pathId(f.path)} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="sticky left-0 whitespace-nowrap bg-white px-2 py-1 dark:bg-zinc-950">{f.label}</td>
                <td className="max-w-56 truncate px-2 py-1 text-zinc-500" title={show(f.base)}>
                  {show(f.base)}
                </td>
                {examples.map((ex) => {
                  const id = pathId(f.path);
                  const changed = id in ex.values;
                  return (
                    <td key={ex.id} className="px-1 py-0.5">
                      <input
                        value={show(changed ? ex.values[id] : f.base)}
                        onChange={(e) => setValue(ex, f, e.target.value)}
                        aria-label={`${ex.name}: ${f.label}`}
                        className={`w-full rounded border px-1.5 py-0.5 outline-none focus:border-blue-500 ${
                          changed
                            ? "border-amber-300 bg-amber-50 text-zinc-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-zinc-100"
                            : "border-transparent bg-transparent text-zinc-400 hover:border-zinc-200 dark:hover:border-zinc-700"
                        }`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={2 + examples.length} className="px-2 py-2 font-sans text-zinc-500">
                  No example changes any field yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-zinc-50 dark:bg-zinc-900">
              <td className="sticky left-0 bg-zinc-50 px-2 py-1.5 text-zinc-500 dark:bg-zinc-900">Case used</td>
              <td className="px-2 py-1.5">{outcome(sampleOutcome)}</td>
              {examples.map((ex) => (
                <td key={ex.id} className="px-2 py-1.5">
                  {outcome(outcomes[ex.id])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {examples.length === 0 && (
        <p className="text-xs text-zinc-500">
          No extra examples yet. <span className="font-medium">+ Add example</span> starts from the sample&apos;s values;
          change the ones that differ (they turn amber).
        </p>
      )}
    </div>
  );
}
