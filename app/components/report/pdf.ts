// Builds the mapping report as a real PDF file (no print dialog) with jsPDF.
// Diagrams are the report's own SVGs converted to vector PDF drawings by
// svg2pdf.js, so they match the on-screen report and stay sharp. Both
// libraries are loaded only when a PDF is actually requested.

import { formatInfo } from "@/lib/formats";
import { type ReportModel, describeJoin, showValues } from "./model";
import type { Spec } from "@/lib/spec";
import type { TestCase } from "./test-cases";

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
  const out = s
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/…/g, "...")
    .replace(/[—–]/g, "-")
    .replace(/·/g, "-")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/≠/g, "!=");
  // With the Unicode font embedded, other scripts print as they are.
  return unicodeFont ? out : out.replace(/[^\x00-\xff]/g, "?");
}

/** Set while a PDF with the embedded Unicode font is being built. */
let unicodeFont = false;

/** Does this content have characters the PDF's built-in fonts can't print (e.g. Greek, Cyrillic, Arabic)? */
export function needsUnicode(...content: unknown[]): boolean {
  try {
    return /[^\x00-\xff]/.test(pdfTextPlain(JSON.stringify(content)));
  } catch {
    return false;
  }
}
const pdfTextPlain = (s: string) => s.replace(/[→←…—–·≥≤≠]/g, "");

/** Embed DejaVu Sans / Sans Mono (Latin, Greek, Cyrillic, Hebrew, Arabic…) and use them for the built-in font names. */
async function embedUnicodeFonts(doc: import("jspdf").jsPDF) {
  const files: [string, string, "normal" | "bold"][] = [
    ["DejaVuSans.ttf", "DejaVu", "normal"],
    ["DejaVuSans-Bold.ttf", "DejaVu", "bold"],
    ["DejaVuSansMono.ttf", "DejaVuMono", "normal"],
    ["DejaVuSansMono-Bold.ttf", "DejaVuMono", "bold"],
  ];
  await Promise.all(
    files.map(async ([file, family, style]) => {
      const res = await fetch(`/fonts/dejavu/${file}`);
      if (!res.ok) throw new Error(`The font ${file} couldn't be loaded.`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      doc.addFileToVFS(file, btoa(binary));
      doc.addFont(file, family, style);
    }),
  );
  // Everything (the report code and svg2pdf) asks for helvetica / courier: map them to DejaVu.
  const setFont = doc.setFont.bind(doc);
  const families: Record<string, string> = { helvetica: "DejaVu", times: "DejaVu", courier: "DejaVuMono" };
  doc.setFont = ((family: string, style?: string, weight?: string | number) => {
    const f = families[String(family).toLowerCase()] ?? family;
    const st = style === "bolditalic" ? "bold" : style === "italic" ? "normal" : style;
    return setFont(f, st, weight);
  }) as typeof doc.setFont;
}

/** A copy of a diagram SVG with PDF-safe fonts and text. */
export function pdfReadySvg(svg: SVGSVGElement): SVGSVGElement {
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
export function svgHeight(svg: SVGSVGElement, width: number): number {
  const vb = svg.viewBox.baseVal;
  return vb && vb.width ? (width * vb.height) / vb.width : 0;
}

/** A PDF being built: the jsPDF document, svg2pdf, and an off-screen host for SVG copies. */
export interface PdfCtx {
  doc: import("jspdf").jsPDF;
  svg2pdf: typeof import("svg2pdf.js").svg2pdf;
  host: HTMLElement;
  /** Record a section starting on the current page (bookmarks and the contents page). */
  mark: (title: string, level?: number) => void;
}

/**
 * Create a PDF, let `draw` fill it, add "<footer> - page i of n" to every page and save it.
 * jsPDF and svg2pdf.js are loaded here, on demand.
 */
export async function buildPdf(
  meta: { title: string; subject: string; footer: string; filename: string; unicode?: boolean },
  draw: (ctx: PdfCtx) => Promise<void>,
): Promise<void> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  if (meta.unicode) {
    await embedUnicodeFonts(doc);
    unicodeFont = true;
  }
  doc.setProperties({ title: pdfText(meta.title), subject: pdfText(meta.subject) });
  // svg2pdf reads the SVG from the document, so converted copies are briefly attached off-screen.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;visibility:hidden";
  document.body.appendChild(host);
  const marks: { title: string; level: number; page: number }[] = [];
  const mark = (title: string, level = 0) => marks.push({ title, level, page: doc.getCurrentPageInfo().pageNumber });
  try {
    await draw({ doc, svg2pdf, host, mark });
    if (marks.length >= 3) addContents(doc, marks);
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor("#a1a1aa");
      doc.text(`${pdfText(meta.footer)} - page ${i} of ${pages}`, PAGE_W / 2, PAGE_H - 7, { align: "center" });
    }
    doc.save(meta.filename);
  } finally {
    host.remove();
    unicodeFont = false;
  }
}

/** A contents page after the cover, plus PDF bookmarks for every section. */
function addContents(doc: import("jspdf").jsPDF, marks: { title: string; level: number; page: number }[]) {
  doc.insertPage(2);
  const shifted = marks.map((m) => ({ ...m, page: m.page >= 2 ? m.page + 1 : m.page }));
  // One page of contents: deeper levels are dropped first if there are too many.
  const ROW = 5.4;
  const room = Math.floor((PAGE_H - MARGIN * 2 - 24) / ROW);
  const shown = shifted.length <= room ? shifted : shifted.filter((m) => m.level === 0).slice(0, room);
  doc.setPage(2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor("#18181b");
  doc.text("Contents", MARGIN, MARGIN + 4);
  let y = MARGIN + 16;
  for (const m of shown) {
    const x = MARGIN + m.level * 6;
    doc.setFont("helvetica", m.level === 0 ? "bold" : "normal");
    doc.setFontSize(m.level === 0 ? 10 : 9);
    doc.setTextColor(m.level === 0 ? "#18181b" : "#3f3f46");
    const title = pdfText(m.title);
    doc.text(title, x, y);
    doc.text(String(m.page), PAGE_W - MARGIN, y, { align: "right" });
    // Dotted leader between the title and the page number.
    const from = x + doc.getTextWidth(title) + 2;
    const to = PAGE_W - MARGIN - doc.getTextWidth(String(m.page)) - 2;
    doc.setTextColor("#d4d4d8");
    for (let dx = from; dx < to; dx += 1.6) doc.text(".", dx, y);
    doc.link(MARGIN, y - 3.8, CONTENT_W, ROW, { pageNumber: m.page });
    y += ROW;
  }
  // Bookmarks (the PDF viewer's outline).
  let parent: unknown = null;
  for (const m of shifted) {
    const node = doc.outline.add(m.level === 0 ? null : (parent as never), pdfText(m.title), { pageNumber: m.page });
    if (m.level === 0) parent = node;
  }
}

export async function downloadReportPdf(
  model: ReportModel,
  /** The rendered diagram for "overview" or a mapping id. */
  diagram: (id: string) => SVGSVGElement | null,
  filename: string,
  /** The document name: the title of the report (and its running footer). */
  docName = "",
): Promise<void> {
  const title = docName.trim() || "Mapping report";
  await buildPdf(
    { title, subject: `${model.sourceTitle} to ${model.targetTitle}`, footer: title, filename, unicode: needsUnicode(title, model) },
    (ctx) =>
      renderReportPdf(ctx, model, diagram, {
        title,
        kicker: docName.trim() ? "MAPPING REPORT" : undefined,
        rules: {
          spec: model.spec,
          docName,
          questions: model.unmapped.filter((u) => u.ask).map((u) => ({ field: u.label, question: u.question })),
        },
        testCases: model.testCases,
      }),
  );
}

/** Draw the single-pair report into `ctx.doc`, starting at the top of its current (empty) page. */
export async function renderReportPdf(
  { doc, svg2pdf, host, mark }: PdfCtx,
  model: ReportModel,
  diagram: (id: string) => SVGSVGElement | null,
  /** The heading, the small capitals line above it, and the shared rules / test-case pages to include. */
  opts: {
    title: string;
    kicker?: string;
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

  {
    // ---------- Page 1: summary + overview ----------
    mark(`${opts.title}: summary and overview`);
    if (kicker) {
      font("helvetica", "bold", 8, "#71717a");
      doc.text(pdfText(kicker), MARGIN, y + 1);
      y += 4;
    }
    font("helvetica", "bold", 20);
    doc.text(fit(title, CONTENT_W), MARGIN, y + 6);
    y += 14;

    const mappingSummary =
      `${model.singles.length} direct` +
      (model.combined.length ? `, ${model.combined.length} combined field${model.combined.length === 1 ? "" : "s"}` : "");
    const summary: [string, string][] = [
      ["Generated", model.generated.toLocaleString()],
      ...(model.spec.version.trim() ? [["Version", model.spec.version.trim()] as [string, string]] : []),
      ...(model.spec.author.trim() ? [["Author", model.spec.author.trim()] as [string, string]] : []),
      ...(model.spec.purpose.trim() ? [["Purpose", model.spec.purpose.trim()] as [string, string]] : []),
      ["Source", `${model.sourceName !== "Source" ? `${model.sourceName} - ` : ""}${formatInfo(model.src.format).label} (${model.primary} side)`],
      ["Target", `${model.targetName !== "Target" ? `${model.targetName} - ` : ""}${formatInfo(model.dst.format).label} (${model.secondary} side)`],
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

    y = (await import("./pdf-sections")).drawReadiness(doc, model.readiness, y + 2);
    font("helvetica", "bold", 12);
    doc.text("Overview", MARGIN, y);
    y += 3;
    y += await drawDiagram("overview", MARGIN, y, CONTENT_W, PAGE_H - MARGIN - 8 - y);

    if (opts.rules) drawRulesPage(doc, opts.rules.spec, opts.rules.docName, opts.rules.questions, () => mark("Implementation rules", 1));

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
      mark(title, 1);
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
    mark("Appendix", 1);
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
      for (const u of model.unmapped) {
        font("helvetica", "normal", 8);
        const text = doc.splitTextToSize(pdfText(`${u.gets}${u.decided ? "" : " (document rule)"}`), CONTENT_W - 62) as string[];
        ensure(text.length * 3.8 + 1);
        font("courier", "normal", 8, "#3f3f46");
        doc.text(doc.splitTextToSize(pdfText(u.label), 58) as string[], MARGIN, y);
        font("helvetica", "normal", 8, "#3f3f46");
        doc.text(text, MARGIN + 62, y);
        y += Math.max(1, text.length) * 3.8 + 0.8;
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
    if (opts.testCases) drawTestCases(doc, opts.testCases, () => mark("Test cases", 1));
    const withImpl = model as unknown as { implementation?: { dataPart: string; functions: Record<string, string>; mergeFunction?: string } | null; readiness: { id: string; status: "ok" | "warn" | "info"; title: string; detail: string; items: string[] }[] };
    if (opts.testCases && withImpl.implementation)
      (await import("./pdf-sections")).drawImplementation(doc, withImpl.implementation, "", withImpl.readiness.find((r) => r.id === "implementation"), () => mark("Reference implementation", 1));
  }
}
