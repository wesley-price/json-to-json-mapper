// The multi-source report as a PDF file (jsPDF + svg2pdf.js, loaded on demand).
// Layout: title + summary + coverage table, then one section per source with
// its cases (conditions, diagram, mapping table) and the sample's result.

import { formatInfo } from "@/lib/formats";
import type { MultiReportModel } from "./multi-model";
import { type PdfCtx, buildPdf, needsUnicode, pdfReadySvg, pdfText, svgHeight } from "./pdf";
import type { Spec } from "@/lib/spec";
import type { TestCase } from "./test-cases";

const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = 210 - MARGIN * 2;
const LINE = 3.6; // mm per line of 8pt text

export async function downloadMultiReportPdf(
  model: MultiReportModel,
  diagram: (id: string) => SVGSVGElement | null,
  filename: string,
): Promise<void> {
  const title = model.docName || "Mapping report";
  await buildPdf({ title, subject: "Multi-source mapping report", footer: title, filename, unicode: needsUnicode(title, model) }, (ctx) =>
    renderMultiReportPdf(ctx, model, diagram, {
      title,
      kicker: "MULTI-SOURCE MAPPING REPORT",
      rules: { spec: model.spec, docName: model.docName, questions: model.openQuestions },
      testCases: model.testCases,
    }),
  );
}

/** Draw the multi-source report into `ctx.doc`, starting at the top of its current (empty) page. */
export async function renderMultiReportPdf(
  { doc, svg2pdf, host, mark }: PdfCtx,
  model: MultiReportModel,
  diagram: (id: string) => SVGSVGElement | null,
  opts: {
    title: string;
    kicker: string;
    rules?: { spec: Spec; docName: string; questions?: { field: string; question: string }[] };
    testCases?: TestCase[];
  },
): Promise<void> {
  const { title, kicker } = opts;
  const { drawRulesPage, drawTestCases } = await import("./pdf-sections");

  let y = MARGIN;
  const newPage = () => {
    doc.addPage();
    y = MARGIN;
  };
  const ensure = (h: number) => {
    if (y + h > PAGE_H - MARGIN - 6) newPage();
  };
  const font = (family: "helvetica" | "courier", style: "normal" | "bold" | "italic", size: number, color = "#18181b") => {
    doc.setFont(family, style);
    doc.setFontSize(size);
    doc.setTextColor(color);
  };
  const lines = (text: string, width: number) => doc.splitTextToSize(pdfText(text), width) as string[];
  const rule = (color = "#e4e4e7") => {
    doc.setDrawColor(color);
    doc.setLineWidth(0.15); // svg2pdf leaves its own line width behind
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  };

  /** A table with wrapped cells; the header row repeats after a page break. */
  const table = (
    cols: { label: string; width: number; mono?: boolean }[],
    rows: { cells: string[]; shade?: boolean[] }[],
  ) => {
    const header = () => {
      font("helvetica", "normal", 7.5, "#71717a");
      let x = MARGIN;
      for (const c of cols) {
        doc.text(pdfText(c.label), x, y);
        x += c.width;
      }
      y += 1.5;
    };
    header();
    for (const row of rows) {
      const wrapped = row.cells.map((cell, i) => {
        font(cols[i].mono ? "courier" : "helvetica", "normal", 8);
        return lines(cell, cols[i].width - 2);
      });
      const h = Math.max(1, ...wrapped.map((w) => w.length)) * LINE + 1.5;
      if (y + h > PAGE_H - MARGIN - 6) {
        newPage();
        header();
      }
      rule();
      let x = MARGIN;
      wrapped.forEach((w, i) => {
        if (row.shade?.[i]) {
          doc.setFillColor("#fef3c7");
          doc.rect(x - 0.5, y + 0.3, cols[i].width - 0.5, h - 0.6, "F");
        }
        font(cols[i].mono ? "courier" : "helvetica", "normal", 8, row.shade?.[i] ? "#b45309" : "#18181b");
        doc.text(w, x, y + LINE);
        x += cols[i].width;
      });
      y += h;
    }
    y += 2;
  };

  const drawDiagram = async (id: string, maxH: number) => {
    const svg = diagram(id);
    if (!svg) return;
    let w = CONTENT_W;
    let h = svgHeight(svg, w);
    if (h > maxH) {
      w = (w * maxH) / h;
      h = maxH;
    }
    ensure(h + 2);
    const copy = pdfReadySvg(svg);
    host.appendChild(copy);
    try {
      await svg2pdf(copy, doc, { x: MARGIN + (CONTENT_W - w) / 2, y, width: w, height: h });
    } finally {
      copy.remove();
    }
    y += h + 3;
  };

  {
    // ---------- Title, summary, coverage ----------
    mark(`${title}: summary and coverage`);
    font("helvetica", "bold", 8, "#71717a");
    doc.text(pdfText(kicker), MARGIN, y + 1);
    y += 4;
    font("helvetica", "bold", 20);
    doc.text(lines(title, CONTENT_W)[0], MARGIN, y + 6);
    y += 14;

    const summary: [string, string][] = [
      ["Generated", model.generated.toLocaleString()],
      ...(model.spec.version.trim() ? [["Version", model.spec.version.trim()] as [string, string]] : []),
      ...(model.spec.author.trim() ? [["Author", model.spec.author.trim()] as [string, string]] : []),
      ...(model.spec.purpose.trim() ? [["Purpose", model.spec.purpose.trim()] as [string, string]] : []),
      ["Standard", `${model.standard.name !== "Standard" ? `${model.standard.name} - ` : ""}${formatInfo(model.standard.format).label} - ${model.standard.fieldCount} fields`],
      ["Sources", model.sources.map((s) => s.name).join(", ")],
      ["Cases / mappings", `${model.caseCount} cases - ${model.mappingCount} mappings`],
      ["Coverage gaps", String(model.gapCount)],
      ...(model.standardConstants.length
        ? [["Constants", model.standardConstants.map((c) => `${c.label} = ${c.text}`).join(", ")] as [string, string]]
        : []),
    ];
    for (const [k, v] of summary) {
      font("helvetica", "normal", 9.5, "#71717a");
      doc.text(k, MARGIN, y);
      font("helvetica", "normal", 9.5);
      const wrapped = lines(v, CONTENT_W - 42);
      doc.text(wrapped, MARGIN + 42, y);
      y += 5.2 + (wrapped.length - 1) * 4;
    }

    y = (await import("./pdf-sections")).drawReadiness(doc, model.readiness, y + 2);
    font("helvetica", "bold", 12);
    doc.text("Coverage", MARGIN, y);
    y += 4;
    font("helvetica", "normal", 8, "#71717a");
    doc.text("Which source field feeds each standard field. Gaps are shaded.", MARGIN, y);
    y += 5;
    const fieldW = 42;
    const srcW = (CONTENT_W - fieldW) / Math.max(1, model.sources.length);
    table(
      [{ label: `${model.standard.name} field`, width: fieldW, mono: true }, ...model.sources.map((s) => ({ label: s.name, width: srcW, mono: true }))],
      model.coverage.map((r) => ({
        cells: [r.label, ...r.cells.map((c) => c.text)],
        shade: [false, ...r.cells.map((c) => c.gap)],
      })),
    );

    // Merged mode: the combined object.
    if (model.merged) {
      newPage();
      mark("Merged result", 1);
      font("helvetica", "bold", 14);
      doc.text("Merged result", MARGIN, y + 4);
      y += 10;
      font("helvetica", "normal", 8.5, "#71717a");
      for (const line of lines(`All sources fill this one ${model.standard.name} object together, in source order. A later source only overwrites a field it has a value for.`, CONTENT_W)) {
        doc.text(line, MARGIN, y);
        y += LINE;
      }
      y += 2;
      table(
        [
          { label: "Source", width: 60 },
          { label: "Case used", width: CONTENT_W - 60 },
        ],
        model.merged.used.map((u) => ({ cells: [u.name, u.error ?? u.caseName ?? ""], shade: [false, !!u.error] })),
      );
      y += 4;
      if (model.merged.conflicts.length) {
        table(
          [
            { label: "Field filled by several sources", width: 70, mono: true },
            { label: "Sources (last wins)", width: CONTENT_W - 70 },
          ],
          model.merged.conflicts.map((c) => ({ cells: [c.field, `${c.sources.join(", ")} -> ${c.winner}`], shade: [false, true] })),
        );
        y += 4;
      }
      font("courier", "normal", 7, "#27272a");
      for (const raw of model.merged.text.replace(/\n$/, "").split("\n")) {
        for (const line of lines(raw || " ", CONTENT_W)) {
          ensure(3.2);
          doc.text(line, MARGIN, y);
          y += 3.1;
        }
      }
    }

    if (opts.rules) drawRulesPage(doc, opts.rules.spec, opts.rules.docName, opts.rules.questions, () => mark("Implementation rules", 1));

    // ---------- One section per source ----------
    for (const src of model.sources) {
      newPage();
      mark(`Source ${src.n}: ${src.name}`, 1);
      font("helvetica", "bold", 14);
      doc.text(lines(`Source ${src.n}: ${src.name}`, CONTENT_W - 30)[0], MARGIN, y + 4);
      font("helvetica", "normal", 9, "#71717a");
      doc.text(formatInfo(src.format).label, MARGIN + CONTENT_W, y + 4, { align: "right" });
      y += 9;
      font("helvetica", "normal", 8, "#71717a");
      doc.text("Cases are checked top to bottom; the first whose conditions all hold is used.", MARGIN, y);
      y += 5;
      table(
        [
          { label: "#", width: 8 },
          { label: "Case", width: 42 },
          { label: "Used when", width: 86, mono: true },
          { label: "Mappings", width: 20 },
          { label: "Sample", width: CONTENT_W - 156 },
        ],
        src.cases.map((c) => ({ cells: [String(c.n), c.name, c.conditions, String(c.mappings.length), c.usedBySample ? "used" : ""] })),
      );

      for (const c of src.cases) {
        ensure(30);
        y += 5;
        font("helvetica", "bold", 10.5);
        doc.text(lines(`Case ${c.n}: ${c.name}${c.usedBySample ? "  (used by the sample)" : ""}`, CONTENT_W)[0], MARGIN, y);
        y += 4.5;
        font("courier", "normal", 8, "#52525b");
        const cond = lines(`when ${c.conditions}`, CONTENT_W);
        doc.text(cond, MARGIN, y);
        y += cond.length * LINE + 2;
        if (c.note) {
          font("helvetica", "italic", 8.5, "#075985");
          const note = lines(`Note: ${c.note}`, CONTENT_W);
          doc.text(note, MARGIN, y);
          y += note.length * LINE + 2;
        }
        await drawDiagram(c.id, 130);
        table(
          [
            { label: "#", width: 8 },
            { label: "Source field", width: 52, mono: true },
            { label: `${model.standard.name} field`, width: 44, mono: true },
            { label: "Notes", width: CONTENT_W - 104 },
          ],
          c.mappings.length
            ? c.mappings.map((m) => ({ cells: [String(m.n), m.fromLabel, m.toLabel, m.notes.join(" ")] }))
            : [{ cells: ["", "No mappings in this case.", "", ""] }],
        );
      }

      // The sample's normalised result.
      ensure(16);
      y += 5;
      font("helvetica", "bold", 10.5);
      doc.text("Sample result", MARGIN, y);
      y += 4.5;
      if ("error" in src.test) {
        font("helvetica", "normal", 8.5, "#b45309");
        doc.text(pdfText(src.test.error), MARGIN, y);
        y += 5;
      } else {
        font("helvetica", "normal", 8, "#71717a");
        doc.text(pdfText(`Normalised with case "${src.test.caseName}".`), MARGIN, y);
        y += 4.5;
        font("courier", "normal", 7, "#27272a");
        for (const raw of src.test.text.replace(/\n$/, "").split("\n")) {
          for (const line of lines(raw || " ", CONTENT_W)) {
            ensure(3.2);
            doc.text(line, MARGIN, y);
            y += 3.1;
          }
        }
      }

      // More values the source's fields can carry.
      if (src.moreValues.length) {
        ensure(16);
        y += 5;
        font("helvetica", "bold", 10.5);
        doc.text("More values", MARGIN, y);
        y += 4.5;
        table(
          [
            { label: "Field", width: 50, mono: true },
            { label: "Value", width: CONTENT_W - 100, mono: true },
            { label: "Case used", width: 50 },
          ],
          src.moreValues.map((m) => ({
            cells: [m.field, m.value, m.sameCase ? m.caseName : `${m.caseName} (not the sample's case)`],
            shade: [false, false, !m.sameCase],
          })),
        );
      }

      // More messages of the same object.
      if (src.examples.length) {
        ensure(16);
        y += 5;
        font("helvetica", "bold", 10.5);
        doc.text("Other examples", MARGIN, y);
        y += 4.5;
        table(
          [
            { label: "Example", width: 40 },
            { label: "Values that differ from the sample", width: CONTENT_W - 84, mono: true },
            { label: "Case used", width: 44 },
          ],
          src.examples.map((ex) => ({
            cells: [ex.name, ex.changes, "error" in ex.test ? ex.test.error : ex.test.caseName],
            shade: [false, false, "error" in ex.test],
          })),
        );
        for (const ex of src.examples) {
          if ("error" in ex.test) continue;
          ensure(12);
          y += 3;
          font("helvetica", "bold", 8.5);
          doc.text(pdfText(`${ex.name} - case "${ex.test.caseName}"`), MARGIN, y + 2);
          y += 5;
          font("courier", "normal", 7, "#27272a");
          for (const raw of ex.test.text.replace(/\n$/, "").split("\n")) {
            for (const line of lines(raw || " ", CONTENT_W)) {
              ensure(3.2);
              doc.text(line, MARGIN, y);
              y += 3.1;
            }
          }
          y += 2;
        }
      }
    }
    if (opts.testCases) drawTestCases(doc, opts.testCases, () => mark("Test cases", 1));
    const withImpl = model as unknown as { implementation?: { dataPart: string; functions: Record<string, string>; mergeFunction?: string } | null; readiness: { id: string; status: "ok" | "warn" | "info"; title: string; detail: string; items: string[] }[] };
    if (opts.testCases && withImpl.implementation)
      (await import("./pdf-sections")).drawImplementation(doc, withImpl.implementation, "", withImpl.readiness.find((r) => r.id === "implementation"), () => mark("Reference implementation", 1));
  }
}
