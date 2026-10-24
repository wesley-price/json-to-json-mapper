"use client";

// Report sections shared by every report kind: spec details on the cover, the
// implementation rules page and the test-case appendix.

import { type Spec, describeRules } from "@/lib/spec";
import type { TestCase } from "./test-cases";
import { type ReadinessItem, readinessCounts } from "@/lib/readiness";
import type { Implementation } from "@/lib/codegen";
import { fileSlug } from "@/lib/names";

/** Download the reference implementation as a .js file. */
export function downloadImplementation(impl: Implementation, name: string) {
  const url = URL.createObjectURL(new Blob([impl.code], { type: "text/javascript" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileSlug(name, "mapping")}-reference.js`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The generated reference implementation: how it is used, whether it passes the test cases, and its mapping data. */
export function ImplementationSection({ impl, name, check }: { impl: Implementation; name: string; check?: ReadinessItem }) {
  const fns = [...Object.values(impl.functions), ...(impl.mergeFunction ? [impl.mergeFunction] : [])];
  return (
    <section className="print-break-before mt-10">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-semibold">Reference implementation{name ? ` · ${name}` : ""}</h2>
        <button
          onClick={() => downloadImplementation(impl, name)}
          className="no-print rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
        >
          ⬇ Download .js
        </button>
      </div>
      <p className="mb-2 text-xs text-zinc-600">
        Plain JavaScript that does exactly what this report describes: the mapping as data, plus a small runtime with the same
        rules. Call {fns.map((f, i) => (
          <span key={f}>
            {i ? ", " : ""}
            <code>{f}(…)</code>
          </span>
        ))}
        . Database constants go through <code>lookupDatabase()</code>: replace it with a real query.
      </p>
      {check && (
        <p className={`mb-2 text-xs font-medium ${check.status === "warn" ? "text-amber-700" : "text-emerald-700"}`}>
          {check.status === "warn" ? "⚠ " : "✓ "}
          {check.title}
          {check.items.length > 0 && <span className="font-normal"> — {check.items.join("; ")}</span>}
        </p>
      )}
      <pre className="max-h-[40rem] overflow-auto whitespace-pre-wrap break-all rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-[10px] leading-snug print:max-h-none">
        {impl.dataPart}
        {"\n\n// …followed by the runtime (in the downloaded file)."}
      </pre>
    </section>
  );
}

const READY_DOT: Record<ReadinessItem["status"], string> = { ok: "bg-emerald-500", warn: "bg-amber-500", info: "bg-sky-500" };

/** "Ready to build?" — the checklist on the report's first page. */
export function ReadinessBlock({ items, title = "Ready to build?" }: { items: ReadinessItem[]; title?: string }) {
  const { warnings } = readinessCounts(items);
  return (
    <section className={`print-avoid-break mt-5 rounded-lg border p-3 ${warnings ? "border-amber-300 bg-amber-50/60" : "border-emerald-300 bg-emerald-50/60"}`}>
      <h2 className="mb-2 text-base font-semibold">
        {title}{" "}
        <span className={`text-sm font-medium ${warnings ? "text-amber-800" : "text-emerald-800"}`}>
          {warnings ? `— ${warnings} item${warnings === 1 ? "" : "s"} to check` : "— yes"}
        </span>
      </h2>
      <ul className="flex flex-col gap-1.5 text-xs">
        {items.map((it) => (
          <li key={it.id} className="flex gap-2">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${READY_DOT[it.status]}`} />
            <div>
              <span className="font-medium">{it.title}</span>
              {it.detail && <span className="text-zinc-600"> — {it.detail}</span>}
              {it.items.length > 0 && (
                <span className="block font-mono text-[11px] text-zinc-600">{it.items.slice(0, 12).join(" · ")}{it.items.length > 12 ? ` · …${it.items.length - 12} more` : ""}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Version / author / purpose rows for a cover <dl>. */
export function SpecRows({ spec }: { spec: Spec }) {
  const rows: [string, string][] = [
    ["Version", spec.version.trim()],
    ["Author", spec.author.trim()],
    ["Purpose", spec.purpose.trim()],
  ];
  return (
    <>
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="whitespace-pre-wrap">{v}</dd>
          </div>
        ))}
    </>
  );
}

/** An unmapped field waiting on a subject-matter expert. */
export interface OpenQuestion {
  field: string;
  question: string;
  scenario?: string;
}

export function RulesSection({ spec, docName, questions = [] }: { spec: Spec; docName: string; questions?: OpenQuestion[] }) {
  return (
    <section className="print-break-before mt-10">
      {questions.length > 0 && (
        <div className="print-avoid-break mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <h2 className="mb-1 text-base font-semibold text-amber-900">
            ❓ Open questions ({questions.length}) — ask a subject-matter expert
          </h2>
          <p className="mb-2 text-xs text-amber-900/80">
            These fields have no mapping yet and need an answer before they can be implemented. Until then the example
            value is sent.
          </p>
          <table className="w-full text-left text-xs">
            <tbody>
              {questions.map((q, i) => (
                <tr key={i} className="border-t border-amber-200 align-top">
                  <td className="py-1 pr-3 font-mono">
                    {q.scenario && <span className="font-sans text-amber-900/70">{q.scenario} · </span>}
                    {q.field}
                  </td>
                  <td className="py-1 text-amber-950">{q.question || <span className="italic text-amber-800/70">No question written yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2 className="mb-1 text-lg font-semibold">Implementation rules</h2>
      <p className="mb-3 text-xs text-zinc-600">
        Read these with the mappings. Where this report and the Excel workbook ({docName || "mapping"}.xlsx) differ, the
        workbook is the source of truth. The test cases at the end show the exact output expected for each sample.
      </p>
      <dl className="flex flex-col gap-2.5 text-sm">
        {describeRules(spec).map((r) => (
          <div key={r.title}>
            <dt className="font-medium">{r.title}</dt>
            <dd className="text-zinc-700">{r.text}</dd>
          </div>
        ))}
        {spec.notes.trim() && (
          <div>
            <dt className="font-medium">Notes for the implementer</dt>
            <dd className="whitespace-pre-wrap text-zinc-700">{spec.notes.trim()}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

const headerLines = (h: Record<string, unknown> | undefined) =>
  h ? Object.entries(h).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n") + "\n" : "";

export function TestCasesSection({ cases }: { cases: TestCase[] }) {
  if (!cases.length) return null;
  const pre = "whitespace-pre-wrap break-all rounded-md border border-zinc-200 bg-zinc-50 p-2 font-mono text-[10px] leading-snug";
  return (
    <section className="print-break-before mt-10">
      <h2 className="mb-1 text-lg font-semibold">Test cases</h2>
      <p className="mb-3 text-xs text-zinc-600">
        Each test case is an input and the output the implementation must produce. Download them as JSON with the{" "}
        <span className="font-medium">Test cases</span> button above, for unit tests.
      </p>
      <div className="flex flex-col gap-4">
        {cases.map((c) => (
          <article key={c.id} className="print-avoid-break border-t border-zinc-200 pt-3">
            <h3 className="text-sm font-semibold">
              {c.id} · {c.scenario ? `${c.scenario} · ` : ""}
              {c.title}
            </h3>
            <p className={`mb-2 text-xs ${c.error ? "text-amber-700" : "text-zinc-500"}`}>
              {c.error ? `Expected: ${c.error}` : c.caseName ? `Uses case “${c.caseName}”` : ""}
            </p>
            {c.variant ? (
              // A variant: only what differs from its base case (the JSON file has it in full).
              <div className="text-xs">
                <p>
                  <span className="font-medium text-zinc-600">Input:</span> same as {c.variant.of}, except{" "}
                  <span className="font-mono">{c.variant.inputChanges}</span>
                </p>
                {c.expected && (
                  <p className="mt-0.5">
                    <span className="font-medium text-zinc-600">Expected output:</span>{" "}
                    {c.variant.outputChanges.length ? (
                      <>
                        same as {c.variant.of}, except{" "}
                        <span className="font-mono">{c.variant.outputChanges.map((x) => `${x.field} = ${x.value}`).join(", ")}</span>
                      </>
                    ) : (
                      <>same as {c.variant.of}</>
                    )}
                  </p>
                )}
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 print:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium text-zinc-600">Input</p>
                  <pre className={pre}>{headerLines(c.input.headers) + c.input.text}</pre>
                </div>
                {c.expected && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-zinc-600">Expected output</p>
                    <pre className={pre}>{headerLines(c.expected.headers) + c.expected.text}</pre>
                  </div>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
