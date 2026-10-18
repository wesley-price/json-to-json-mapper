// Builds the mapping report as a real PDF file (no print dialog) with jsPDF.
// Diagrams are the report's own SVGs converted to vector PDF drawings by
// svg2pdf.js, so they match the on-screen report and stay sharp. Both
// libraries are loaded only when a PDF is actually requested.

import { formatInfo } from "@/lib/formats";
import { type ReportModel, describeJoin, showValues } from "./model";

// A4 portrait, in millimetres.
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;

/**
 * The PDF's built-in fonts only cover Latin-1 text, so swap the few symbols
 * the report uses for plain equivalents and replace anything else unsupported.
 */
export function pdfText(s: string): string {
  return s
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/…/g, "...")
    .replace(/[—–]/g, "-")
    .replace(/·/g, "-")
    .replace(/[^\x00-\xff]/g, "?");
}

/** A copy of a diagram SVG with PDF-safe fonts and text. */
function pdfReadySvg(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll("text").forEach((t) => {
    const family = t.getAttribute("font-family") ?? "";
    t.setAttribute("font-family", /mono|consolas|menlo/i.test(family) ? "courier" : "helvetica");
  });
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) n.nodeValue = pdfText(n.nodeValue ?? "");
  return clone;
}

/** Height (mm) a diagram takes when drawn `width` mm wide. */
function svgHeight(svg: SVGSVGElement, width: number): number {
  const vb = svg.viewBox.baseVal;
  return vb && vb.width ? (width * vb.height) / vb.width : 0;
}

export async function downloadReportPdf(
  model: ReportModel,
  /** The rendered diagram for "overview" or a mapping id. */
  diagram: (id: string) => SVGSVGElement | null,
  filename: string,
): Promise<void> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: "Mapping report", subject: `${model.sourceTitle} to ${model.targetTitle}` });

  // svg2pdf reads the SVG from the document, so converted copies are briefly attached off-screen.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;visibility:hidden";
  document.body.appendChild(host);

  let y = MARGIN;
  const newPage = () => {
    doc.addPage();
    y = MARGIN;
  };
  const ensure = (height: number) => {
    if (y + height > PAGE_H - MARGIN - 6) newPage();
  };
  const font = (family: "helvetica" | "courier", style: "normal" | "bold" | "italic", size: number, color = "#18181b") => {
    doc.setFont(family, style);
    doc.setFontSize(size);
    doc.setTextColor(color);
  };
  /** Text cut to fit `maxW` mm, with "..." when shortened. */
  const fit = (s: string, maxW: number) => {
    let t = pdfText(s);
    if (doc.getTextWidth(t) <= maxW) return t;
    while (t.length > 1 && doc.getTextWidth(`${t}...`) > maxW) t = t.slice(0, -1);
    return `${t}...`;
  };
  const drawDiagram = async (id: string, x: number, top: number, width: number, maxH?: number) => {
    const svg = diagram(id);
    if (!svg) return 0;
    let w = width;
    let h = svgHeight(svg, width);
    if (maxH && h > maxH) {
      w = (width * maxH) / h;
      h = maxH;
    }
    const copy = pdfReadySvg(svg);
    host.appendChild(copy);
    try {
      await svg2pdf(copy, doc, { x: x + (width - w) / 2, y: top, width: w, height: h });
    } finally {
      copy.remove();
    }
    return h;
  };

  try {
    // ---------- Page 1: summary + overview ----------
    font("helvetica", "bold", 20);
    doc.text("Mapping report", MARGIN, y + 6);
    y += 14;

    const mappingSummary =
      `${model.singles.length} direct` +
      (model.combined.length ? `, ${model.combined.length} combined field${model.combined.length === 1 ? "" : "s"}` : "");
    const summary: [string, string][] = [
      ["Generated", model.generated.toLocaleString()],
      ["Source", `${formatInfo(model.src.format).label} (${model.primary} side)`],
      ["Target", `${formatInfo(model.dst.format).label} (${model.secondary} side)`],
      ["Mappings", mappingSummary],
      ["Target fields mapped", `${model.mappedLeafCount} of ${model.targetLeafCount}`],
    ];
    for (const [k, v] of summary) {
      font("helvetica", "normal", 9.5, "#71717a");
      doc.text(k, MARGIN, y);
      font("helvetica", "normal", 9.5);
      doc.text(pdfText(v), MARGIN + 42, y);
      y += 5.2;
    }

    y += 4;
    font("helvetica", "bold", 12);
    doc.text("Overview", MARGIN, y);
    y += 3;
    y += await drawDiagram("overview", MARGIN, y, CONTENT_W, PAGE_H - MARGIN - 8 - y);

    // ---------- Cards (direct mappings and combined fields) ----------
    const PAD = 4;
    const innerW = CONTENT_W - PAD * 2;
    const col = { label: MARGIN + PAD, field: MARGIN + PAD + 18, type: MARGIN + PAD + 96, value: MARGIN + PAD + 118 };
    const valueW = MARGIN + CONTENT_W - PAD - col.value;

    interface CardRow {
      label: string;
      field: string;
      type?: string;
      value: string;
      dot?: string; // colour dot before the label
      strong?: boolean; // the combined result row
    }
    /** One bordered card: badge + heading, diagram, a small table, notes. Never split across pages. */
    const card = async (c: {
      n: number;
      color: string;
      heading: string;
      subheading?: string;
      diagramId: string;
      columns: [string, string, string, string];
      rows: CardRow[];
      notes: string[];
    }) => {
      const svg = diagram(c.diagramId);
      const diagramH = svg ? svgHeight(svg, innerW) : 0;
      font("helvetica", "normal", 8.5);
      const noteLines = c.notes.map((n) => doc.splitTextToSize(pdfText(n), innerW - 4) as string[]);
      const noteCount = noteLines.reduce((sum, l) => sum + l.length, 0);
      const height = PAD + 8 + (c.subheading ? 4 : 0) + diagramH + 4 + 2 + c.rows.length * 6 + noteCount * 4 + 2 + PAD;
      ensure(height);
      const top = y;

      // Heading: numbered colour badge + text.
      y += PAD + 3;
      doc.setFillColor(c.color);
      doc.circle(MARGIN + PAD + 2.6, y - 1.2, 2.6, "F");
      font("helvetica", "bold", 7.5, "#ffffff");
      doc.text(String(c.n), MARGIN + PAD + 2.6, y - 0.1, { align: "center" });
      font("courier", "bold", 9.5);
      doc.text(fit(c.heading, innerW - 8), MARGIN + PAD + 7, y);
      if (c.subheading) {
        y += 4;
        font("helvetica", "normal", 8, "#71717a");
        doc.text(fit(c.subheading, innerW - 8), MARGIN + PAD + 7, y);
      }
      y += 4;

      y += await drawDiagram(c.diagramId, MARGIN + PAD, y, innerW);
      y += 4;

      // Table.
      font("helvetica", "normal", 7.5, "#71717a");
      doc.text(c.columns[0], col.label, y);
      doc.text(c.columns[1], col.field, y);
      doc.text(c.columns[2], col.type, y);
      doc.text(c.columns[3], col.value, y);
      y += 1.5;
      for (const r of c.rows) {
        doc.setDrawColor(r.strong ? "#a1a1aa" : "#e4e4e7");
        doc.setLineWidth(r.strong ? 0.25 : 0.15);
        doc.line(col.label, y, MARGIN + CONTENT_W - PAD, y);
        y += 4;
        if (r.dot) {
          doc.setFillColor(r.dot);
          doc.circle(col.label + 0.9, y - 1, 0.9, "F");
        }
        font("helvetica", "normal", 8, "#71717a");
        doc.text(r.label, col.label + (r.dot ? 3 : 0), y);
        font("courier", r.strong ? "bold" : "normal", 8);
        doc.text(fit(r.field, col.type - col.field - 2), col.field, y);
        doc.text(r.type ?? "-", col.type, y);
        doc.text(fit(r.value, valueW), col.value, y);
        y += 2;
      }

      // Notes, each with a bullet on its first line.
      if (noteCount) {
        y += 2;
        font("helvetica", "normal", 8.5, "#52525b");
        doc.setFillColor("#71717a");
        for (const lines of noteLines) {
          lines.forEach((line, i) => {
            y += 4;
            if (i === 0) doc.circle(col.label + 0.8, y - 1, 0.5, "F");
            doc.text(line, col.label + 3, y);
          });
        }
      }
      y += PAD;

      doc.setDrawColor("#d4d4d8");
      doc.setLineWidth(0.3); // svg2pdf leaves its own line width behind
      doc.roundedRect(MARGIN, top, CONTENT_W, y - top, 2, 2, "S");
      y += 5;
    };

    const sectionTitle = (title: string, intro?: string) => {
      newPage();
      font("helvetica", "bold", 14);
      doc.text(title, MARGIN, y + 4);
      y += 10;
      if (intro) {
        font("helvetica", "normal", 8.5, "#71717a");
        doc.text(pdfText(intro), MARGIN, y - 2);
        y += 4;
      }
    };

    if (model.singles.length) {
      sectionTitle("Mappings in detail");
      for (const m of model.singles) {
        await card({
          n: m.n,
          color: m.color,
          heading: `${m.fromLabel} -> ${m.toLabel}`,
          diagramId: m.id,
          columns: ["", "Field", "Type", "Value"],
          rows: [
            { label: "Source", field: m.fromLabel, type: m.fromType, value: showValues(m.sourceValues) },
            { label: "Target", field: m.toLabel, type: m.toType, value: showValues(m.written) },
          ],
          notes: m.notes,
        });
      }
    }

    if (model.combined.length) {
      sectionTitle(
        "Combined fields",
        "Target fields built from more than one source field. Parts are joined in the order shown.",
      );
      for (const c of model.combined) {
        await card({
          n: c.n,
          color: c.parts[0].color,
          heading: c.toLabel,
          subheading: `<- ${c.parts.length} fields combined, joined with ${describeJoin(c.join)}`,
          diagramId: c.id,
          columns: ["Part", "Source field", "Type", "Example value"],
          rows: [
            ...c.parts.map((p, i) => ({
              label: String(i + 1),
              dot: p.color,
              field: p.fromLabel,
              type: p.fromType,
              value: showValues(p.sourceValues),
            })),
            { label: "Result", field: c.toLabel, type: "string", value: showValues(c.written), strong: true },
          ],
          notes: c.notes,
        });
      }
    }

    // ---------- Appendix ----------
    newPage();
    font("helvetica", "bold", 14);
    doc.text("Appendix", MARGIN, y + 4);
    y += 12;

    font("helvetica", "bold", 10);
    doc.text("All mappings", MARGIN, y);
    y += 5;
    font("helvetica", "normal", 7.5, "#71717a");
    doc.text("#", MARGIN, y);
    doc.text("Source field", MARGIN + 10, y);
    doc.text("Target field", MARGIN + 110, y);
    y += 1.5;
    for (const e of model.entries) {
      const n = e.item.n;
      const color = e.kind === "single" ? e.item.color : e.item.parts[0].color;
      const from = e.kind === "single" ? e.item.fromLabel : e.item.parts.map((p) => p.fromLabel).join(" + ");
      const to = e.kind === "single" ? e.item.toLabel : `${e.item.toLabel}  (combined)`;
      font("courier", "normal", 8);
      const fromLines = doc.splitTextToSize(pdfText(from), 96) as string[];
      ensure(4 + fromLines.length * 3.6);
      doc.setDrawColor("#e4e4e7");
      doc.setLineWidth(0.15);
      doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
      y += 4;
      doc.setFillColor(color);
      doc.circle(MARGIN + 1, y - 1, 1, "F");
      font("courier", "normal", 8);
      doc.text(String(n), MARGIN + 3, y);
      doc.text(fromLines, MARGIN + 10, y);
      doc.text(fit(to, CONTENT_W - 110), MARGIN + 110, y);
      y += (fromLines.length - 1) * 3.6 + 1.5;
    }
    if (!model.entries.length) {
      y += 4;
      font("helvetica", "normal", 8.5, "#71717a");
      doc.text("No mappings.", MARGIN, y);
    }

    y += 8;
    ensure(12);
    font("helvetica", "bold", 10);
    doc.text("Target fields without a mapping", MARGIN, y);
    y += 5;
    if (model.unmapped.length) {
      font("courier", "normal", 8, "#3f3f46");
      for (const line of doc.splitTextToSize(pdfText(model.unmapped.join(", ")), CONTENT_W) as string[]) {
        ensure(4);
        doc.text(line, MARGIN, y);
        y += 3.8;
      }
    } else {
      font("helvetica", "normal", 8.5, "#71717a");
      doc.text("Every target field is mapped.", MARGIN, y);
      y += 4;
    }

    y += 6;
    ensure(12);
    if (model.resultHeadersText) {
      font("helvetica", "bold", 10);
      doc.text("Mapped headers", MARGIN, y);
      y += 5;
      font("courier", "normal", 7);
      doc.setTextColor("#27272a");
      for (const raw of model.resultHeadersText.split("\n")) {
        for (const line of doc.splitTextToSize(pdfText(raw) || " ", CONTENT_W) as string[]) {
          ensure(3.2);
          doc.text(line, MARGIN, y);
          y += 3.1;
        }
      }
      y += 6;
      ensure(12);
    }
    font("helvetica", "bold", 10);
    doc.text(`Mapped result (${formatInfo(model.dst.format).label})`, MARGIN, y);
    y += 5;
    font("courier", "normal", 7);
    doc.setTextColor("#27272a");
    for (const raw of model.resultText.replace(/\n$/, "").split("\n")) {
      for (const line of doc.splitTextToSize(pdfText(raw) || " ", CONTENT_W) as string[]) {
        ensure(3.2);
        doc.text(line, MARGIN, y);
        y += 3.1;
      }
    }

    // Page numbers.
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      font("helvetica", "normal", 7.5, "#a1a1aa");
      doc.text(`Mapping report - page ${i} of ${pages}`, PAGE_W / 2, PAGE_H - 7, { align: "center" });
    }

    doc.save(filename);
  } finally {
    host.remove();
  }
}
