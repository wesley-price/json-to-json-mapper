"use client";

// Hand-off details and implementation rules for the whole document: who wrote
// it, which version, what it's for, and the rules a developer needs beyond the
// field mappings. They print on the report's cover and rules page.

import { useEffect } from "react";
import {
  COERCE_OPTIONS,
  type CoercePolicy,
  MISSING_OPTIONS,
  type MissingPolicy,
  type Spec,
  UNMAPPED_OPTIONS,
  type UnmappedPolicy,
  describeRules,
} from "@/lib/spec";

const input =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-950";

export function SpecDialog({ spec, onChange, onClose }: { spec: Spec; onChange: (s: Spec) => void; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const set = (patch: Partial<Spec>) => onChange({ ...spec, ...patch });
  const facts = describeRules(spec).slice(3);

  const select = <T extends string>(
    label: string,
    value: T,
    options: { id: T; label: string }[],
    onPick: (v: T) => void,
    hint: string,
  ) => (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
      <select value={value} onChange={(e) => onPick(e.target.value as T)} aria-label={label} className={input}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="text-xs text-zinc-500">{hint}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4 sm:p-10" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-label="Spec details and rules"
        onPointerDown={(e) => e.stopPropagation()}
        className="flex w-full max-w-2xl flex-col gap-5 rounded-xl border border-zinc-200 bg-white p-5 text-zinc-800 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Spec details &amp; rules</h2>
            <p className="text-sm text-zinc-500">
              Printed on the report so whoever implements the mapping doesn&apos;t have to guess. The rules also apply to
              the results shown here.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-xl leading-none text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
            ×
          </button>
        </div>

        <section className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Version</span>
            <input value={spec.version} onChange={(e) => set({ version: e.target.value })} placeholder="1.0" aria-label="Version" className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Author</span>
            <input value={spec.author} onChange={(e) => set({ author: e.target.value })} placeholder="Your name / team" aria-label="Author" className={input} />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-sm font-medium">Purpose</span>
            <textarea
              value={spec.purpose}
              onChange={(e) => set({ purpose: e.target.value })}
              rows={2}
              placeholder="e.g. Normalise downstream payment errors into our standard error response for the checkout API."
              aria-label="Purpose"
              className={input}
            />
          </label>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Implementation rules</h3>
          {select<UnmappedPolicy>(
            "A target field with no mapping",
            spec.unmapped,
            UNMAPPED_OPTIONS,
            (unmapped) => set({ unmapped }),
            'Individual fields can override this from the "unmapped" button on the target object.',
          )}
          {select<MissingPolicy>(
            "A mapped source field is missing from the input",
            spec.missing,
            MISSING_OPTIONS,
            (missing) => set({ missing }),
            'An empty value ("") counts as present.',
          )}
          {select<CoercePolicy>(
            "Value types",
            spec.coerce,
            COERCE_OPTIONS,
            (coerce) => set({ coerce }),
            "Mismatched types are flagged on the Mappings tab.",
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={spec.headersCaseInsensitive} onChange={(e) => set({ headersCaseInsensitive: e.target.checked })} />
            Header names are matched without regard to upper/lower case
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Other notes for the implementer</span>
            <textarea
              value={spec.notes}
              onChange={(e) => set({ notes: e.target.value })}
              rows={3}
              placeholder="e.g. Log the original error body; never return stack traces; timeouts map to error.code GEN-504."
              aria-label="Notes for the implementer"
              className={input}
            />
          </label>
        </section>

        <section className="flex flex-col gap-1.5 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
          <p className="font-medium text-zinc-700 dark:text-zinc-300">Also stated in the report (how the mapping behaves):</p>
          {facts.map((f) => (
            <p key={f.title}>
              <span className="font-medium">{f.title}:</span> {f.text}
            </p>
          ))}
        </section>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
