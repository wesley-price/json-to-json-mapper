"use client";

// Mapping report: an overview diagram of every mapping first, then one
// close-up per mapping, then one card per combined field, then an appendix.
// It can be downloaded as a PDF directly, or printed with the browser's
// "Save as PDF". It reads the saved workspace, so it matches what was on
// screen when it was opened. Opening /report?download starts the PDF
// download automatically.

import Link from "next/link";
import { dateStamp, fileSlug } from "@/lib/names";
import { MultiReport } from "./MultiReport";
import { type SavedMulti, buildMultiReport } from "./multi-model";
import { type ScenarioReport, allTestCases, buildScenarioReports } from "./scenario-model";
import { ReadinessBlock, RulesSection, SpecRows, TestCasesSection } from "./SpecSections";
import { implementationItem, readinessCounts } from "@/lib/readiness";
import { checkImplementation, type Implementation } from "@/lib/codegen";
import { implementationFor } from "./implementation";
import { ImplementationSection } from "./SpecSections";
type WithImpl = { implementation?: Implementation | null; readiness: ReturnType<typeof implementationItem>[] };
const implCheck = (m: WithImpl) => m.readiness.find((r) => r.id === "implementation");
import { testCasesFile } from "./test-cases";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatInfo } from "@/lib/formats";
import { type Path, pathId, rowPath } from "@/lib/json-tree";
import { isConstPath } from "@/lib/transforms";
import { MappingDiagram, constantRow, excerptRows, excerptRowsMany, rowsFor } from "./MappingDiagram";
import {
  type ReportCombined,
  type ReportMapping,
  type ReportModel,
  STORAGE_KEY,
  type Saved,
  buildReport,
  describeJoin,
  showValues,
} from "./model";

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};
const readSaved = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/** "<document-name>-report-2026-10-18.pdf" */
const fileName = (docName: string, d: Date) => `${fileSlug(docName, "mapping")}-report-${dateStamp(d)}.pdf`;

function Badge({ n, color }: { n: number; color: string }) {
  return (
    <span
      className="flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-sans text-[11px] text-white"
      style={{ background: color }}
    >
      {n}
    </span>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <ul className="mt-2 list-disc pl-5 text-xs text-zinc-600">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

function SingleCard({ m, report, prefix }: { m: ReportMapping; report: ReportModel; prefix: string }) {
  return (
    <article className="print-avoid-break rounded-lg border border-zinc-200 p-4">
      <h3 className="mb-3 flex items-center gap-2 font-mono text-sm font-semibold">
        <Badge n={m.n} color={m.color} />
        {m.fromLabel} <span className="text-zinc-400">→</span> {m.toLabel}
      </h3>
      <MappingDiagram
        diagramId={prefix + m.id}
        source={m.constant !== undefined ? [constantRow(m.from, m.constant, m.db)] : excerptRows(report.src.tree, m.from)}
        target={excerptRows(report.dst.tree, m.to)}
        links={[{ from: pathId(rowPath(m.from)), to: pathId(m.to), color: m.color }]}
        sourceTitle={report.sourceTitle}
        targetTitle={report.targetTitle}
      />
      <table className="mt-3 w-full text-left text-xs">
        <thead className="text-zinc-500">
          <tr>
            <th className="w-24 py-1 font-normal" />
            <th className="py-1 font-normal">Field</th>
            <th className="py-1 font-normal">Type</th>
            <th className="py-1 font-normal">Value</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          <tr className="border-t border-zinc-100">
            <td className="py-1 font-sans text-zinc-500">Source</td>
            <td className="py-1">{m.fromLabel}</td>
            <td className="py-1">{m.fromSchema ?? m.fromType ?? "—"}</td>
            <td className="py-1 break-all">{showValues(m.sourceValues)}</td>
          </tr>
          <tr className="border-t border-zinc-100">
            <td className="py-1 font-sans text-zinc-500">Target</td>
            <td className="py-1">{m.toLabel}</td>
            <td className="py-1">{m.toSchema ?? m.toType ?? "—"}</td>
            <td className="py-1 break-all">{showValues(m.written)}</td>
          </tr>
        </tbody>
      </table>
      <Notes notes={m.notes} />
    </article>
  );
}

function CombinedCard({ c, report, prefix }: { c: ReportCombined; report: ReportModel; prefix: string }) {
  return (
    <article className="print-avoid-break rounded-lg border border-zinc-200 p-4">
      <h3 className="mb-3 flex flex-wrap items-center gap-2 font-mono text-sm font-semibold">
        <Badge n={c.n} color={c.parts[0].color} />
        {c.toLabel}
        <span className="font-sans text-xs font-normal text-zinc-500">
          ← {c.parts.length} fields combined, joined with {describeJoin(c.join)}
        </span>
      </h3>
      <MappingDiagram
        diagramId={prefix + c.id}
        source={[
          ...excerptRowsMany(
            report.src.tree,
            c.parts.filter((p) => p.constant === undefined).map((p) => p.from),
          ),
          ...c.parts.filter((p) => p.constant !== undefined).map((p) => constantRow(p.from, p.constant, p.db)),
        ]}
        target={excerptRows(report.dst.tree, c.to)}
        links={c.parts.map((p) => ({ from: pathId(rowPath(p.from)), to: pathId(c.to), color: p.color }))}
        sourceTitle={report.sourceTitle}
        targetTitle={report.targetTitle}
      />
      <table className="mt-3 w-full text-left text-xs">
        <thead className="text-zinc-500">
          <tr>
            <th className="w-12 py-1 font-normal">Part</th>
            <th className="py-1 font-normal">Source field</th>
            <th className="py-1 font-normal">Type</th>
            <th className="py-1 font-normal">Example value</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {c.parts.map((p, i) => (
            <tr key={p.id} className="border-t border-zinc-100">
              <td className="py-1 font-sans text-zinc-500">
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
                {i + 1}
              </td>
              <td className="py-1">{p.fromLabel}</td>
              <td className="py-1">{p.fromSchema ?? p.fromType ?? "—"}</td>
              <td className="py-1 break-all">{showValues(p.sourceValues)}</td>
            </tr>
          ))}
          <tr className="border-t border-zinc-300">
            <td className="py-1 font-sans text-zinc-500">Result</td>
            <td className="py-1 font-semibold">{c.toLabel}</td>
            <td className="py-1">string</td>
            <td className="py-1 font-semibold break-all">{showValues(c.written)}</td>
          </tr>
        </tbody>
      </table>
      <Notes notes={c.notes} />
    </article>
  );
}

export function MappingReport() {
  const raw = useSyncExternalStore(subscribe, readSaved, () => null);
  // Multi-source mode gets its own report; otherwise the single-pair one.
  // Several scenarios get one combined report.
  const { report, multiReport, scenarios, docName } = useMemo(() => {
    const none = { report: null, multiReport: null, scenarios: null, docName: "" };
    if (!raw) return none;
    try {
      const saved = JSON.parse(raw) as Saved & SavedMulti & Parameters<typeof buildScenarioReports>[0];
      const name = (saved.docName ?? "").trim();
      const scenarios = buildScenarioReports(saved);
      // The reference implementation, checked against the test cases (added to the readiness list).
      const withImpl = <M extends { readiness: ReturnType<typeof implementationItem>[]; testCases: Parameters<typeof checkImplementation>[1] }>(
        model: M | null,
        state: Parameters<typeof implementationFor>[0],
        title: string,
      ): (M & { implementation: Implementation | null }) | null => {
        if (!model) return null;
        const implementation = implementationFor(state, title);
        if (!implementation) return { ...model, implementation: null };
        return { ...model, implementation, readiness: [...model.readiness, implementationItem(checkImplementation(implementation, model.testCases))] };
      };
      if (scenarios) {
        const list = (saved as unknown as { scenarios: Parameters<typeof implementationFor>[0][] }).scenarios;
        return {
          ...none,
          scenarios: scenarios.map((sc, i) => {
            const state = { ...list[i], spec: saved.spec };
            return { ...sc, single: withImpl(sc.single, state, sc.name), multi: withImpl(sc.multi, state, sc.name) };
          }),
          docName: name,
        };
      }
      if (saved.multi?.enabled) return { ...none, multiReport: withImpl(buildMultiReport(saved), saved, name || "Mapping"), docName: name };
      return { ...none, report: withImpl(buildReport(saved), saved, name || "Mapping"), docName: name };
    } catch {
      return none;
    }
  }, [raw]);
  const generated = report?.generated ?? multiReport?.generated ?? scenarios?.[0].generated ?? null;
  const hasReport = !!(report || multiReport || scenarios);

  const rootRef = useRef<HTMLDivElement>(null);
  const [pdfState, setPdfState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const downloadPdf = async () => {
    if (!hasReport || !generated || pdfState.busy) return;
    setPdfState({ busy: true, error: null });
    const diagram = (id: string) =>
      rootRef.current?.querySelector<SVGSVGElement>(`svg[data-diagram="${CSS.escape(id)}"]`) ?? null;
    try {
      if (scenarios) {
        const { downloadScenariosPdf } = await import("./pdf-scenarios");
        await downloadScenariosPdf(scenarios, diagram, fileName(docName, generated), docName, generated);
      } else if (multiReport) {
        const { downloadMultiReportPdf } = await import("./pdf-multi");
        await downloadMultiReportPdf(multiReport, diagram, fileName(docName, generated));
      } else if (report) {
        const { downloadReportPdf } = await import("./pdf");
        await downloadReportPdf(report, diagram, fileName(docName, generated), docName);
      }
      setPdfState({ busy: false, error: null });
    } catch (e) {
      setPdfState({ busy: false, error: `Couldn't create the PDF: ${(e as Error).message}` });
    }
  };

  // /report?download: start the download once the report has rendered, then drop the flag
  // so a refresh doesn't download again.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!hasReport || autoStarted.current || !new URLSearchParams(window.location.search).has("download")) return;
    autoStarted.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void downloadPdf();
    // downloadPdf reads the latest report; running once per page load is intended
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, multiReport, scenarios]);

  if (!hasReport) {
    return (
      <div className="mx-auto max-w-2xl p-10 text-zinc-800">
        <h1 className="text-xl font-semibold">Mapping report</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Nothing to report yet. Load a source and a target in the mapper (and map some fields), then open the report
          again.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-blue-600 underline">
          ← Back to the mapper
        </Link>
      </div>
    );
  }

  const downloadTestCases = () => {
    const cases = report?.testCases ?? multiReport?.testCases ?? (scenarios ? allTestCases(scenarios) : []);
    const spec = report?.spec ?? multiReport?.spec ?? scenarios?.map((s) => s.single?.spec ?? s.multi?.spec).find(Boolean);
    const url = URL.createObjectURL(
      new Blob([testCasesFile(docName, spec?.version.trim() ?? "", cases)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileSlug(docName, "mapping")}-test-cases.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const toolbar = (
      <div className="no-print sticky top-0 z-10 -mx-10 mb-6 flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white/95 px-10 py-3 backdrop-blur">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Back to the mapper
        </Link>
        {pdfState.error && <span className="text-sm text-red-600">{pdfState.error}</span>}
        <div className="ml-auto flex gap-2">
          <details
            className="relative"
            onToggle={(e) => {
              // Read the section headings when the menu opens.
              const el = e.currentTarget;
              if (!el.open) return;
              const list = el.querySelector("ul");
              if (!list || !rootRef.current) return;
              list.innerHTML = "";
              rootRef.current.querySelectorAll("h1, h2").forEach((h, i) => {
                if (!h.id) h.id = `section-${i}`;
                const li = document.createElement("li");
                const a = document.createElement("a");
                a.href = `#${h.id}`;
                a.textContent = h.textContent ?? "";
                a.className = h.tagName === "H1" ? "block px-3 py-1 font-semibold hover:bg-zinc-100" : "block py-1 pl-6 pr-3 hover:bg-zinc-100";
                a.onclick = () => (el.open = false);
                li.appendChild(a);
                list.appendChild(li);
              });
            }}
          >
            <summary className="cursor-pointer list-none rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100">
              Contents ▾
            </summary>
            <ul className="absolute right-0 z-20 mt-1 max-h-[60vh] w-72 overflow-auto rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg" />
          </details>
          <button
            onClick={downloadTestCases}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
            title="Every input with its expected output, as JSON for unit tests"
          >
            ⬇ Test cases (JSON)
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
            title="Open the print dialog (choose Save as PDF there)"
          >
            Print…
          </button>
          <button
            onClick={downloadPdf}
            disabled={pdfState.busy}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
          >
            {pdfState.busy ? "Creating PDF…" : "⬇ Download PDF"}
          </button>
        </div>
      </div>
  );

  if (multiReport) {
    return (
      <div ref={rootRef} className="report mx-auto max-w-[210mm] bg-white px-10 py-8 text-zinc-900 print:max-w-none print:p-0">
        {toolbar}
        <MultiReport report={multiReport} docName={docName} />
        {(multiReport as WithImpl).implementation && (
          <ImplementationSection impl={(multiReport as WithImpl).implementation!} name={docName} check={implCheck(multiReport as WithImpl)} />
        )}
      </div>
    );
  }
  if (scenarios) {
    return (
      <div ref={rootRef} className="report mx-auto max-w-[210mm] bg-white px-10 py-8 text-zinc-900 print:max-w-none print:p-0">
        {toolbar}
        <ScenariosReport scenarios={scenarios} docName={docName} generated={scenarios[0].generated} />
      </div>
    );
  }
  if (!report) return null;
  return (
    <div ref={rootRef} className="report mx-auto max-w-[210mm] bg-white px-10 py-8 text-zinc-900 print:max-w-none print:p-0">
      {toolbar}
      <SingleReport report={report} kicker={docName ? "Mapping report" : undefined} title={docName || "Mapping report"} docName={docName} />
    </div>
  );
}

/** Every scenario in one report: a contents page, then each scenario's own report. */
function ScenariosReport({ scenarios, docName, generated }: { scenarios: ScenarioReport[]; docName: string; generated: Date }) {
  const total = scenarios.length;
  const spec = scenarios.map((s) => s.single?.spec ?? s.multi?.spec).find(Boolean);
  return (
    <>
      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Mapping report · {total} scenarios</p>
        <h1 className="text-2xl font-semibold tracking-tight">{docName || "Mapping report"}</h1>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-zinc-500">Generated</dt>
          <dd>{generated.toLocaleString()}</dd>
          {spec && <SpecRows spec={spec} />}
          <dt className="text-zinc-500">Scenarios</dt>
          <dd>{total}</dd>
        </dl>
        <h2 className="mt-6 mb-2 text-base font-semibold">Scenarios</h2>
        <table className="w-full text-left text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 font-normal">#</th>
              <th className="py-1 font-normal">Scenario</th>
              <th className="py-1 font-normal">Kind</th>
              <th className="py-1 font-normal">Objects</th>
              <th className="py-1 font-normal">Mappings</th>
              <th className="py-1 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((sc) => (
              <tr key={sc.n} className="border-t border-zinc-100 align-top">
                <td className="py-1 pr-2">{sc.n}</td>
                <td className="py-1 pr-2 font-medium">{sc.name}</td>
                <td className="py-1 pr-2">{sc.multi ? "Multi-source" : "Single pair"}</td>
                <td className="py-1 pr-2">{sc.objects.replace("->", "→").replace("<-", "←")}</td>
                <td className="py-1 pr-2">{sc.counts.replace(/ - /g, " · ")}</td>
                <td className="py-1">
                  {(() => {
                    const w = readinessCounts((sc.single ?? sc.multi)?.readiness ?? []).warnings;
                    return w ? <span className="text-amber-700">⚠ {w} to check</span> : <span className="text-emerald-700">✓ ready</span>;
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {spec && (
        <RulesSection
          spec={spec}
          docName={docName}
          questions={scenarios.flatMap((sc) =>
            (sc.single
              ? sc.single.unmapped.filter((u) => u.ask).map((u) => ({ field: u.label, question: u.question }))
              : (sc.multi?.openQuestions ?? [])
            ).map((q) => ({ ...q, scenario: sc.name })),
          )}
        />
      )}

      {scenarios.map((sc) => {
        const kicker = `Scenario ${sc.n} of ${total}${sc.multi ? " · multi-source" : ""}`;
        return (
          <div key={sc.n} className="print-break-before mt-14 border-t-4 border-zinc-900 pt-6 print:mt-0 print:border-t-0 print:pt-0">
            {sc.multi ? (
              <MultiReport report={sc.multi} kicker={kicker} title={sc.name} prefix={sc.prefix} sections={false} />
            ) : sc.single ? (
              <SingleReport report={sc.single} kicker={kicker} title={sc.name} prefix={sc.prefix} sections={false} />
            ) : (
              <section>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{kicker}</p>
                <h1 className="text-2xl font-semibold tracking-tight">{sc.name}</h1>
                <p className="mt-2 text-sm text-zinc-500">Nothing to report yet: this scenario needs both objects.</p>
              </section>
            )}
          </div>
        );
      })}
      <TestCasesSection cases={allTestCases(scenarios)} />
      {scenarios.map((sc) => {
        const m = (sc.single ?? sc.multi) as WithImpl | null;
        return m?.implementation ? <ImplementationSection key={sc.n} impl={m.implementation} name={sc.name} check={implCheck(m)} /> : null;
      })}
    </>
  );
}

/** The single-pair report body. `prefix` keeps diagram ids unique when several reports share the page. */
function SingleReport({
  report,
  kicker,
  title,
  prefix = "",
  docName = "",
  sections = true,
}: {
  report: ReportModel;
  kicker?: string;
  title: string;
  prefix?: string;
  docName?: string;
  /** Include the spec details, rules page and test cases (off inside a scenarios report, which has them once). */
  sections?: boolean;
}) {
  const { src, dst, singles, combined, entries } = report;
  // Big objects: the overview shows only mapped fields.
  const linked = report.links.map((l) => ({ from: JSON.parse(l.from) as Path, to: JSON.parse(l.to) as Path }));
  const srcRows = rowsFor(src.tree, linked.map((l) => l.from).filter((p) => !isConstPath(p)));
  const dstRows = rowsFor(dst.tree, linked.map((l) => l.to));
  return (
    <>
      {/* 1. Overview */}
      <section>
        {kicker && <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{kicker}</p>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-zinc-500">Generated</dt>
          <dd>{report.generated.toLocaleString()}</dd>
          {sections && <SpecRows spec={report.spec} />}
          <dt className="text-zinc-500">Source</dt>
          <dd>
            {report.sourceName !== "Source" && <span className="font-medium">{report.sourceName} · </span>}
            {formatInfo(src.format).label} ({report.primary} side)
          </dd>
          <dt className="text-zinc-500">Target</dt>
          <dd>
            {report.targetName !== "Target" && <span className="font-medium">{report.targetName} · </span>}
            {formatInfo(dst.format).label} ({report.secondary} side)
          </dd>
          <dt className="text-zinc-500">Mappings</dt>
          <dd>
            {singles.length} direct
            {combined.length > 0 && `, ${combined.length} combined field${combined.length === 1 ? "" : "s"}`}
          </dd>
          <dt className="text-zinc-500">Target fields mapped</dt>
          <dd>
            {report.mappedLeafCount} of {report.targetLeafCount}
          </dd>
        </dl>
        <ReadinessBlock items={report.readiness} />

        <h2 className="mt-6 mb-2 text-base font-semibold">Overview</h2>
        <MappingDiagram
          diagramId={prefix + "overview"}
          source={[
            ...srcRows.rows,
            // Constants have no source field; list them after the source tree so their lines have a start.
            ...report.entries
              .flatMap((e) => (e.kind === "single" ? [e.item] : e.item.parts))
              .filter((p) => p.constant !== undefined)
              .map((p) => constantRow(p.from, p.constant, p.db)),
          ]}
          target={dstRows.rows}
          links={report.links}
          sourceTitle={report.sourceTitle}
          targetTitle={report.targetTitle}
          maxHeight="200mm"
        />
        {(srcRows.hidden > 0 || dstRows.hidden > 0) && (
          <p className="mt-1 text-xs text-zinc-500">
            Large objects: only mapped fields are drawn ({srcRows.hidden + dstRows.hidden} other fields not shown; every field is
            listed in the Excel workbook).
          </p>
        )}
      </section>

      {sections && (
        <RulesSection
          spec={report.spec}
          docName={docName}
          questions={report.unmapped.filter((u) => u.ask).map((u) => ({ field: u.label, question: u.question }))}
        />
      )}

      {/* 2. Direct mappings */}
      {singles.length > 0 && (
        <section className="print-break-before mt-10">
          <h2 className="mb-3 text-lg font-semibold">Mappings in detail</h2>
          <div className="flex flex-col gap-6">
            {singles.map((m) => (
              <SingleCard key={m.id} m={m} report={report} prefix={prefix} />
            ))}
          </div>
        </section>
      )}

      {/* 3. Combined fields */}
      {combined.length > 0 && (
        <section className="print-break-before mt-10">
          <h2 className="mb-1 text-lg font-semibold">Combined fields</h2>
          <p className="mb-3 text-xs text-zinc-500">
            Target fields built from more than one source field. Parts are joined in the order shown.
          </p>
          <div className="flex flex-col gap-6">
            {combined.map((c) => (
              <CombinedCard key={c.id} c={c} report={report} prefix={prefix} />
            ))}
          </div>
        </section>
      )}

      {/* 4. Appendix */}
      <section className="print-break-before mt-10">
        <h2 className="mb-3 text-lg font-semibold">Appendix</h2>

        <h3 className="mb-1 text-sm font-semibold">All mappings</h3>
        <table className="w-full text-left text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 font-normal">#</th>
              <th className="py-1 font-normal">Source field</th>
              <th className="py-1 font-normal">Target field</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {entries.map((e) =>
              e.kind === "single" ? (
                <tr key={e.item.id} className="border-t border-zinc-100">
                  <td className="py-1 pr-2">
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: e.item.color }} />
                    {e.item.n}
                  </td>
                  <td className="py-1 pr-2">{e.item.fromLabel}</td>
                  <td className="py-1">{e.item.toLabel}</td>
                </tr>
              ) : (
                <tr key={e.item.id} className="border-t border-zinc-100">
                  <td className="py-1 pr-2">
                    <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: e.item.parts[0].color }} />
                    {e.item.n}
                  </td>
                  <td className="py-1 pr-2">{e.item.parts.map((p) => p.fromLabel).join(" + ")}</td>
                  <td className="py-1">
                    {e.item.toLabel}{" "}
                    <span className="rounded bg-zinc-100 px-1 font-sans text-[10px] text-zinc-600">combined</span>
                  </td>
                </tr>
              ),
            )}
            {entries.length === 0 && (
              <tr>
                <td colSpan={3} className="py-1 font-sans text-zinc-500">
                  No mappings.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <h3 className="mt-5 mb-1 text-sm font-semibold">Target fields without a mapping</h3>
        {report.unmapped.length ? (
          <table className="w-full text-left text-xs">
            <tbody>
              {report.unmapped.map((u) => (
                <tr key={u.label} className="border-t border-zinc-100 align-top">
                  <td className="py-1 pr-3 font-mono">{u.label}</td>
                  <td className="py-1 text-zinc-700">
                    {u.gets}
                    {!u.decided && <span className="text-zinc-400"> (document rule)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-zinc-500">Every target field is mapped.</p>
        )}

        {report.resultHeadersText && (
          <>
            <h3 className="mt-5 mb-1 text-sm font-semibold">Mapped headers</h3>
            <pre className="whitespace-pre-wrap break-all rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-[10px] leading-snug">
              {report.resultHeadersText}
            </pre>
          </>
        )}

        <h3 className="mt-5 mb-1 text-sm font-semibold">Mapped result ({formatInfo(dst.format).label})</h3>
        <pre className="whitespace-pre-wrap break-all rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-[10px] leading-snug">
          {report.resultText}
        </pre>
      </section>
      {sections && <TestCasesSection cases={report.testCases} />}
      {sections && (report as WithImpl).implementation && (
        <ImplementationSection impl={(report as WithImpl).implementation!} name={docName} check={implCheck(report as WithImpl)} />
      )}
    </>
  );
}
