"use client";

// Mapping report: an overview diagram of every mapping first, then one
// close-up per mapping, then one card per combined field, then an appendix.
// It can be downloaded as a PDF directly, or printed with the browser's
// "Save as PDF". It reads the saved workspace, so it matches what was on
// screen when it was opened. Opening /report?download starts the PDF
// download automatically.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatInfo } from "@/lib/formats";
import { pathId } from "@/lib/json-tree";
import { MappingDiagram, allRows, excerptRows, excerptRowsMany } from "./MappingDiagram";
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

const fileName = (d: Date) =>
  `mapping-report-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.pdf`;

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

function SingleCard({ m, report }: { m: ReportMapping; report: ReportModel }) {
  return (
    <article className="print-avoid-break rounded-lg border border-zinc-200 p-4">
      <h3 className="mb-3 flex items-center gap-2 font-mono text-sm font-semibold">
        <Badge n={m.n} color={m.color} />
        {m.fromLabel} <span className="text-zinc-400">→</span> {m.toLabel}
      </h3>
      <MappingDiagram
        diagramId={m.id}
        source={excerptRows(report.src.tree, m.from)}
        target={excerptRows(report.dst.tree, m.to)}
        links={[{ from: pathId(m.from), to: pathId(m.to), color: m.color }]}
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
            <td className="py-1">{m.fromType ?? "—"}</td>
            <td className="py-1 break-all">{showValues(m.sourceValues)}</td>
          </tr>
          <tr className="border-t border-zinc-100">
            <td className="py-1 font-sans text-zinc-500">Target</td>
            <td className="py-1">{m.toLabel}</td>
            <td className="py-1">{m.toType ?? "—"}</td>
            <td className="py-1 break-all">{showValues(m.written)}</td>
          </tr>
        </tbody>
      </table>
      <Notes notes={m.notes} />
    </article>
  );
}

function CombinedCard({ c, report }: { c: ReportCombined; report: ReportModel }) {
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
        diagramId={c.id}
        source={excerptRowsMany(
          report.src.tree,
          c.parts.map((p) => p.from),
        )}
        target={excerptRows(report.dst.tree, c.to)}
        links={c.parts.map((p) => ({ from: pathId(p.from), to: pathId(c.to), color: p.color }))}
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
              <td className="py-1">{p.fromType ?? "—"}</td>
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
  const report = useMemo(() => {
    if (!raw) return null;
    try {
      return buildReport(JSON.parse(raw) as Saved);
    } catch {
      return null;
    }
  }, [raw]);

  const rootRef = useRef<HTMLDivElement>(null);
  const [pdfState, setPdfState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const downloadPdf = async () => {
    if (!report || pdfState.busy) return;
    setPdfState({ busy: true, error: null });
    try {
      const { downloadReportPdf } = await import("./pdf");
      await downloadReportPdf(
        report,
        (id) => rootRef.current?.querySelector<SVGSVGElement>(`svg[data-diagram="${CSS.escape(id)}"]`) ?? null,
        fileName(report.generated),
      );
      setPdfState({ busy: false, error: null });
    } catch (e) {
      setPdfState({ busy: false, error: `Couldn't create the PDF: ${(e as Error).message}` });
    }
  };

  // /report?download: start the download once the report has rendered, then drop the flag
  // so a refresh doesn't download again.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!report || autoStarted.current || !new URLSearchParams(window.location.search).has("download")) return;
    autoStarted.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void downloadPdf();
    // downloadPdf reads the latest report; running once per page load is intended
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  if (!report) {
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

  const { src, dst, singles, combined, entries } = report;

  return (
    <div ref={rootRef} className="report mx-auto max-w-[210mm] bg-white px-10 py-8 text-zinc-900 print:max-w-none print:p-0">
      {/* Screen-only toolbar */}
      <div className="no-print sticky top-0 z-10 -mx-10 mb-6 flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white/95 px-10 py-3 backdrop-blur">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Back to the mapper
        </Link>
        {pdfState.error && <span className="text-sm text-red-600">{pdfState.error}</span>}
        <div className="ml-auto flex gap-2">
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

      {/* 1. Overview */}
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Mapping report</h1>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-zinc-500">Generated</dt>
          <dd>{report.generated.toLocaleString()}</dd>
          <dt className="text-zinc-500">Source</dt>
          <dd>
            {formatInfo(src.format).label} ({report.primary} side)
          </dd>
          <dt className="text-zinc-500">Target</dt>
          <dd>
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

        <h2 className="mt-6 mb-2 text-base font-semibold">Overview</h2>
        <MappingDiagram
          diagramId="overview"
          source={allRows(src.tree)}
          target={allRows(dst.tree)}
          links={report.links}
          sourceTitle={report.sourceTitle}
          targetTitle={report.targetTitle}
          maxHeight="200mm"
        />
      </section>

      {/* 2. Direct mappings */}
      {singles.length > 0 && (
        <section className="print-break-before mt-10">
          <h2 className="mb-3 text-lg font-semibold">Mappings in detail</h2>
          <div className="flex flex-col gap-6">
            {singles.map((m) => (
              <SingleCard key={m.id} m={m} report={report} />
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
              <CombinedCard key={c.id} c={c} report={report} />
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
          <p className="font-mono text-xs leading-relaxed text-zinc-700">{report.unmapped.join(", ")}</p>
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
    </div>
  );
}
