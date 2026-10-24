// Every scenario in one PDF: a contents page listing the scenarios, then each
// scenario's own report (single-pair or multi-source) from a new page.

import { buildPdf, needsUnicode, pdfText, renderReportPdf } from "./pdf";
import { renderMultiReportPdf } from "./pdf-multi";
import { type ScenarioReport, allTestCases } from "./scenario-model";
import { drawImplementation, drawRulesPage, drawTestCases } from "./pdf-sections";

const MARGIN = 14;
const CONTENT_W = 210 - MARGIN * 2;

export async function downloadScenariosPdf(
  scenarios: ScenarioReport[],
  /** The rendered diagram for a (prefixed) diagram id. */
  diagram: (id: string) => SVGSVGElement | null,
  filename: string,
  docName: string,
  generated: Date,
): Promise<void> {
  const title = docName.trim() || "Mapping report";
  const total = scenarios.length;
  await buildPdf({ title, subject: `${total} mapping scenarios`, footer: title, filename, unicode: needsUnicode(title, scenarios) }, async (ctx) => {
    const { doc } = ctx;
    const font = (style: "normal" | "bold", size: number, color = "#18181b") => {
      doc.setFont("helvetica", style);
      doc.setFontSize(size);
      doc.setTextColor(color);
    };

    // ---------- Contents ----------
    ctx.mark("Scenarios");
    let y = MARGIN;
    font("bold", 8, "#71717a");
    doc.text(`MAPPING REPORT - ${total} SCENARIOS`, MARGIN, y + 1);
    y += 4;
    font("bold", 20);
    doc.text(doc.splitTextToSize(pdfText(title), CONTENT_W)[0], MARGIN, y + 6);
    y += 14;
    const spec = (scenarios[0].single ?? scenarios[0].multi)?.spec;
    const details: [string, string][] = [
      ["Generated", generated.toLocaleString()],
      ...(spec?.version.trim() ? [["Version", spec.version.trim()] as [string, string]] : []),
      ...(spec?.author.trim() ? [["Author", spec.author.trim()] as [string, string]] : []),
      ...(spec?.purpose.trim() ? [["Purpose", spec.purpose.trim()] as [string, string]] : []),
    ];
    for (const [k, v] of details) {
      font("normal", 9.5, "#71717a");
      doc.text(k, MARGIN, y);
      font("normal", 9.5);
      const lines = doc.splitTextToSize(pdfText(v), CONTENT_W - 42) as string[];
      doc.text(lines, MARGIN + 42, y);
      y += 5.5 * Math.max(1, lines.length);
    }
    y += 4.5;

    font("bold", 12);
    doc.text("Scenarios", MARGIN, y);
    y += 6;
    const cols = [
      { label: "#", x: MARGIN, w: 8 },
      { label: "Scenario", x: MARGIN + 8, w: 44 },
      { label: "Kind", x: MARGIN + 52, w: 24 },
      { label: "Objects", x: MARGIN + 76, w: 50 },
      { label: "Mappings", x: MARGIN + 126, w: CONTENT_W - 126 },
    ];
    font("normal", 7.5, "#71717a");
    cols.forEach((c) => doc.text(c.label, c.x, y));
    y += 1.5;
    for (const sc of scenarios) {
      const cells = [String(sc.n), sc.name, sc.multi ? "Multi-source" : "Single pair", sc.objects, sc.counts];
      const wrapped = cells.map((cell, i) => {
        font(i === 1 ? "bold" : "normal", 8);
        return doc.splitTextToSize(pdfText(cell), cols[i].w - 2) as string[];
      });
      const h = Math.max(...wrapped.map((w) => w.length)) * 3.6 + 1.5;
      doc.setDrawColor("#e4e4e7");
      doc.setLineWidth(0.15);
      doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
      wrapped.forEach((w, i) => {
        font(i === 1 ? "bold" : "normal", 8);
        doc.text(w, cols[i].x, y + 3.6);
      });
      y += h;
    }

    if (spec)
      drawRulesPage(
        doc,
        spec,
        docName,
        scenarios.flatMap((sc) =>
          (sc.single
            ? sc.single.unmapped.filter((u) => u.ask).map((u) => ({ field: u.label, question: u.question }))
            : (sc.multi?.openQuestions ?? [])
          ).map((q) => ({ ...q, scenario: sc.name })),
        ),
        () => ctx.mark("Implementation rules"),
      );

    // ---------- One section per scenario ----------
    for (const sc of scenarios) {
      doc.addPage();
      ctx.mark(`Scenario ${sc.n}: ${sc.name}`);
      // The scenario's own sections sit one level below it in the bookmarks.
      const inner = { ...ctx, mark: (t: string, level = 0) => ctx.mark(t, level + 1) };
      const kicker = `SCENARIO ${sc.n} OF ${total}${sc.multi ? " - MULTI-SOURCE" : ""}`;
      const scoped = (id: string) => diagram(sc.prefix + id);
      if (sc.multi) {
        await renderMultiReportPdf(inner, sc.multi, scoped, { title: sc.name, kicker });
      } else if (sc.single) {
        await renderReportPdf(inner, sc.single, scoped, { title: sc.name, kicker });
      } else {
        font("bold", 8, "#71717a");
        doc.text(kicker, MARGIN, MARGIN + 1);
        font("bold", 20);
        doc.text(pdfText(sc.name), MARGIN, MARGIN + 10);
        font("normal", 9.5, "#71717a");
        doc.text("Nothing to report yet: this scenario needs both objects.", MARGIN, MARGIN + 20);
      }
    }
    drawTestCases(doc, allTestCases(scenarios), () => ctx.mark("Test cases"));
    for (const sc of scenarios) {
      const m = (sc.single ?? sc.multi) as unknown as { implementation?: { dataPart: string; functions: Record<string, string>; mergeFunction?: string } | null; readiness: { id: string; status: "ok" | "warn" | "info"; title: string; detail: string; items: string[] }[] } | null;
      if (m?.implementation)
        drawImplementation(doc, m.implementation, sc.name, m.readiness.find((r) => r.id === "implementation"), () => ctx.mark(`Reference implementation: ${sc.name}`));
    }
  });
}
