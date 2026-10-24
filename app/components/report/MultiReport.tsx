"use client";

// The multi-source report: title + summary, the coverage matrix, then one
// section per source (its cases with conditions, a diagram and mapping table
// per case, and the sample's normalised result).

import { formatInfo } from "@/lib/formats";
import { MappingDiagram, constantRow, rowsFor } from "./MappingDiagram";
import { isConstPath } from "@/lib/transforms";
import type { MultiReportModel, MultiReportSource } from "./multi-model";
import { ReadinessBlock, RulesSection, SpecRows, TestCasesSection } from "./SpecSections";

function SourceSection({ src, report, prefix }: { src: MultiReportSource; report: MultiReportModel; prefix: string }) {
  const sourceTitle = `${src.name} · ${formatInfo(src.format).label}`;
  return (
    <section className="print-break-before mt-10">
      <h2 className="mb-1 text-lg font-semibold">
        Source {src.n}: {src.name}{" "}
        <span className="text-sm font-normal text-zinc-500">({formatInfo(src.format).label})</span>
      </h2>
      <p className="mb-3 text-xs text-zinc-500">Cases are checked top to bottom; the first whose conditions all hold is used.</p>

      <table className="mb-4 w-full text-left text-xs">
        <thead className="text-zinc-500">
          <tr>
            <th className="py-1 font-normal">#</th>
            <th className="py-1 font-normal">Case</th>
            <th className="py-1 font-normal">Used when</th>
            <th className="py-1 font-normal">Mappings</th>
            <th className="py-1 font-normal">Sample</th>
          </tr>
        </thead>
        <tbody>
          {src.cases.map((c) => (
            <tr key={c.id} className="border-t border-zinc-100">
              <td className="py-1 pr-2">{c.n}</td>
              <td className="py-1 pr-2 font-medium">{c.name}</td>
              <td className="py-1 pr-2 font-mono">{c.conditions}</td>
              <td className="py-1 pr-2">{c.mappings.length}</td>
              <td className="py-1">{c.usedBySample ? <span className="text-emerald-700">● used</span> : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col gap-6">
        {src.cases.map((c) => (
          <article key={c.id} className="print-avoid-break rounded-lg border border-zinc-200 p-4">
            <h3 className="mb-1 text-sm font-semibold">
              Case {c.n}: {c.name}
              {c.usedBySample && <span className="ml-2 text-xs font-normal text-emerald-700">● used by the sample</span>}
            </h3>
            <p className="mb-3 font-mono text-xs text-zinc-600">when {c.conditions}</p>
            {c.note && <p className="mb-3 whitespace-pre-wrap text-xs text-sky-800">💬 {c.note}</p>}
            <MappingDiagram
              diagramId={prefix + c.id}
              source={[
                ...rowsFor(src.tree, c.mappings.map((m) => m.from).filter((p) => !isConstPath(p))).rows,
                ...c.mappings.filter((m) => m.constant !== undefined).map((m) => constantRow(m.from, m.constant, m.db)),
              ]}
              target={rowsFor(report.standard.tree, c.mappings.map((m) => m.to)).rows}
              links={c.links}
              sourceTitle={sourceTitle}
              targetTitle={report.standard.title}
              maxHeight="150mm"
            />
            <table className="mt-3 w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 font-normal">#</th>
                  <th className="py-1 font-normal">Source field</th>
                  <th className="py-1 font-normal">{report.standard.name} field</th>
                  <th className="py-1 font-normal">Notes</th>
                </tr>
              </thead>
              <tbody>
                {c.mappings.map((m) => (
                  <tr key={m.n} className="border-t border-zinc-100 align-top">
                    <td className="py-1 pr-2">
                      <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: m.color }} />
                      {m.n}
                    </td>
                    <td className="py-1 pr-2 font-mono">{m.fromLabel}</td>
                    <td className="py-1 pr-2 font-mono">{m.toLabel}</td>
                    <td className="py-1 text-zinc-600">{m.notes.join(" ")}</td>
                  </tr>
                ))}
                {c.mappings.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-1 text-zinc-500">
                      No mappings in this case.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </article>
        ))}
      </div>

      <h3 className="mt-5 mb-1 text-sm font-semibold">Sample result</h3>
      {"error" in src.test ? (
        <p className="text-xs text-amber-700">{src.test.error}</p>
      ) : (
        <>
          <p className="mb-1 text-xs text-zinc-500">The sample, normalised with case “{src.test.caseName}”.</p>
          <pre className="whitespace-pre-wrap break-all rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-[10px] leading-snug">
            {src.test.text}
          </pre>
        </>
      )}

      {src.moreValues.length > 0 && (
        <>
          <h3 className="mt-5 mb-1 text-sm font-semibold">More values</h3>
          <p className="mb-2 text-xs text-zinc-500">Other values these fields can carry, each checked against the cases.</p>
          <table className="mb-3 w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 font-normal">Field</th>
                <th className="py-1 font-normal">Value</th>
                <th className="py-1 font-normal">Case used</th>
              </tr>
            </thead>
            <tbody>
              {src.moreValues.map((m, i) => (
                <tr key={i} className="border-t border-zinc-100 align-top">
                  <td className="py-1 pr-2 font-mono">{m.field}</td>
                  <td className="py-1 pr-2 font-mono">{m.value}</td>
                  <td className={`py-1 ${m.sameCase ? "" : "bg-amber-50 text-amber-700"}`}>
                    {m.caseName}
                    {!m.sameCase && " (not the sample's case)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {src.examples.length > 0 && (
        <>
          <h3 className="mt-5 mb-1 text-sm font-semibold">Other examples</h3>
          <p className="mb-2 text-xs text-zinc-500">More messages of the same object; only the values listed differ from the sample.</p>
          <table className="mb-3 w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 font-normal">Example</th>
                <th className="py-1 font-normal">Values that differ from the sample</th>
                <th className="py-1 font-normal">Case used</th>
              </tr>
            </thead>
            <tbody>
              {src.examples.map((ex) => (
                <tr key={ex.name} className="border-t border-zinc-100 align-top">
                  <td className="py-1 pr-2 font-medium">{ex.name}</td>
                  <td className="py-1 pr-2 font-mono">{ex.changes}</td>
                  <td className={`py-1 ${"error" in ex.test ? "text-amber-700" : ""}`}>
                    {"error" in ex.test ? ex.test.error : ex.test.caseName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {src.examples.map((ex) =>
            "error" in ex.test ? null : (
              <div key={ex.name} className="print-avoid-break mb-3">
                <p className="mb-1 text-xs font-medium">
                  {ex.name} <span className="font-normal text-zinc-500">· case “{ex.test.caseName}”</span>
                </p>
                <pre className="whitespace-pre-wrap break-all rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-[10px] leading-snug">
                  {ex.test.text}
                </pre>
              </div>
            ),
          )}
        </>
      )}
    </section>
  );
}

export function MultiReport({
  report,
  kicker = "Multi-source mapping report",
  title = report.docName || "Mapping report",
  prefix = "",
  docName = "",
  sections = true,
}: {
  report: MultiReportModel;
  docName?: string;
  /** Include the spec details, rules page and test cases (off inside a scenarios report, which has them once). */
  sections?: boolean;
  /** The small capitals line above the title. */
  kicker?: string;
  title?: string;
  /** Keeps diagram ids unique when several reports share the page. */
  prefix?: string;
}) {
  return (
    <>
      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{kicker}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-zinc-500">Generated</dt>
          <dd>{report.generated.toLocaleString()}</dd>
          {sections && <SpecRows spec={report.spec} />}
          <dt className="text-zinc-500">Standard</dt>
          <dd>
            {report.standard.name !== "Standard" && <span className="font-medium">{report.standard.name} · </span>}
            {formatInfo(report.standard.format).label} · {report.standard.fieldCount} fields
          </dd>
          <dt className="text-zinc-500">Sources</dt>
          <dd>{report.sources.map((s) => s.name).join(", ")}</dd>
          <dt className="text-zinc-500">Cases / mappings</dt>
          <dd>
            {report.caseCount} cases · {report.mappingCount} mappings
          </dd>
          <dt className="text-zinc-500">Coverage gaps</dt>
          <dd>{report.gapCount}</dd>
          {report.standardConstants.length > 0 && (
            <>
              <dt className="text-zinc-500">Constants</dt>
              <dd className="font-mono text-xs leading-6">
                {report.standardConstants.map((c) => `${c.label} = ${c.text}`).join(", ")}
              </dd>
            </>
          )}
        </dl>

        <ReadinessBlock items={report.readiness} />

        <h2 className="mt-6 mb-2 text-base font-semibold">Coverage</h2>
        <p className="mb-2 text-xs text-zinc-500">
          Which source field feeds each standard field. Gaps are marked —.
          {report.combine === "merge" && " Sources are merged into one object, so a field only needs one source."}
        </p>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="text-zinc-500">
              <th className="py-1 pr-3 font-normal">{report.standard.name} field</th>
              {report.sources.map((s) => (
                <th key={s.n} className="py-1 pr-3 font-medium text-zinc-700">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {report.coverage.map((r) => (
              <tr key={r.label} className="border-t border-zinc-100 align-top">
                <td className="py-1 pr-3">{r.label}</td>
                {r.cells.map((c, i) => (
                  <td key={i} className={`py-1 pr-3 ${c.gap ? "bg-amber-50 text-amber-700" : ""}`}>
                    {c.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {report.merged && (
        <section className="mt-8">
          <h2 className="mb-1 text-base font-semibold">Merged result</h2>
          <p className="mb-2 text-xs text-zinc-500">
            All sources fill this one {report.standard.name} object together, in source order. A later source only
            overwrites a field it has a value for.
          </p>
          <table className="mb-3 w-full text-left text-xs">
            <tbody>
              {report.merged.used.map((u) => (
                <tr key={u.name} className="border-t border-zinc-100">
                  <td className="py-1 pr-3 font-medium">{u.name}</td>
                  <td className={`py-1 ${u.error ? "text-amber-700" : "text-zinc-600"}`}>{u.error ?? `case “${u.caseName}”`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.merged.conflicts.length > 0 && (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <p className="mb-1 font-medium">Fields more than one source fills (the last one wins):</p>
              <ul className="list-disc pl-5">
                {report.merged.conflicts.map((c) => (
                  <li key={c.field}>
                    <span className="font-mono">{c.field}</span>: {c.sources.join(", ")} → <span className="font-medium">{c.winner}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <pre className="whitespace-pre-wrap break-all rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-[10px] leading-snug">
            {report.merged.text}
          </pre>
        </section>
      )}

      {sections && <RulesSection spec={report.spec} docName={docName} questions={report.openQuestions} />}

      {report.sources.map((src) => (
        <SourceSection key={src.n} src={src} report={report} prefix={prefix} />
      ))}
      {sections && <TestCasesSection cases={report.testCases} />}
    </>
  );
}
