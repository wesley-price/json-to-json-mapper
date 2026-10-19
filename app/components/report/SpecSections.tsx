"use client";

// Report sections shared by every report kind: spec details on the cover, the
// implementation rules page and the test-case appendix.

import { type Spec, describeRules } from "@/lib/spec";
import type { TestCase } from "./test-cases";

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
          </article>
        ))}
      </div>
    </section>
  );
}
