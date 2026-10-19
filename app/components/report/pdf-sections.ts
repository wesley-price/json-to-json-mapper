// PDF pages shared by every report kind: the implementation rules page and the
// test-case appendix. Each starts on a new page and manages its own layout.

import type { jsPDF } from "jspdf";
import { type Spec, describeRules } from "@/lib/spec";
import { pdfText } from "./pdf";
import type { TestCase } from "./test-cases";

const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = 210 - MARGIN * 2;

function pen(doc: jsPDF) {
  doc.addPage();
  let y = MARGIN;
  const font = (family: "helvetica" | "courier", style: "normal" | "bold" | "italic", size: number, color = "#18181b") => {
    doc.setFont(family, style);
    doc.setFontSize(size);
    doc.setTextColor(color);
  };
  const ensure = (h: number) => {
    if (y + h > PAGE_H - MARGIN - 6) {
      doc.addPage();
      y = MARGIN;
    }
  };
  /** Wrapped text; returns nothing, moves y down. */
  const para = (text: string, width = CONTENT_W, x = MARGIN, line = 4) => {
    for (const l of doc.splitTextToSize(pdfText(text), width) as string[]) {
      ensure(line);
      doc.text(l, x, y);
      y += line;
    }
  };
  const mono = (text: string, x = MARGIN, width = CONTENT_W) => {
    font("courier", "normal", 7, "#27272a");
    for (const raw of text.replace(/\n$/, "").split("\n")) {
      for (const l of doc.splitTextToSize(pdfText(raw) || " ", width) as string[]) {
        ensure(3.2);
        doc.text(l, x, y);
        y += 3.1;
      }
    }
  };
  return {
    font,
    ensure,
    para,
    mono,
    get y() {
      return y;
    },
    set y(v: number) {
      y = v;
    },
  };
}

const headerLines = (h: Record<string, unknown> | undefined) =>
  h ? Object.entries(h).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n") + "\n" : "";

/** "Implementation rules": the source of truth, the rules in plain sentences and the implementer notes. */
export function drawRulesPage(
  doc: jsPDF,
  spec: Spec,
  docName: string,
  questions: { field: string; question: string; scenario?: string }[] = [],
) {
  const p = pen(doc);
  if (questions.length) {
    p.font("helvetica", "bold", 12, "#78350f");
    doc.text(pdfText(`Open questions (${questions.length}) - ask a subject-matter expert`), MARGIN, p.y + 4);
    p.y += 9;
    p.font("helvetica", "normal", 8.5, "#92400e");
    p.para("These fields have no mapping yet and need an answer before they can be implemented. Until then the example value is sent.");
    p.y += 1;
    for (const q of questions) {
      p.font("courier", "normal", 8, "#18181b");
      const field = doc.splitTextToSize(pdfText(`${q.scenario ? `${q.scenario} - ` : ""}${q.field}`), 60) as string[];
      p.font("helvetica", "normal", 8.5, q.question ? "#451a03" : "#a16207");
      const text = doc.splitTextToSize(pdfText(q.question || "No question written yet"), CONTENT_W - 64) as string[];
      const h = Math.max(field.length, text.length) * 3.8 + 1.5;
      p.ensure(h);
      doc.setFillColor("#fffbeb");
      doc.rect(MARGIN - 1, p.y - 3.2, CONTENT_W + 2, h, "F");
      p.font("courier", "normal", 8, "#18181b");
      doc.text(field, MARGIN, p.y);
      p.font("helvetica", "normal", 8.5, q.question ? "#451a03" : "#a16207");
      doc.text(text, MARGIN + 64, p.y);
      p.y += h;
    }
    p.y += 6;
  }
  p.font("helvetica", "bold", 15);
  doc.text("Implementation rules", MARGIN, p.y + 4);
  p.y += 11;
  p.font("helvetica", "normal", 9, "#3f3f46");
  p.para(
    `Read these with the mappings. Where this report and the Excel workbook (${docName || "mapping"}.xlsx) differ, the workbook is the source of truth. The test cases at the end show the exact output expected for each sample.`,
  );
  p.y += 3;
  for (const r of describeRules(spec)) {
    p.ensure(12);
    p.font("helvetica", "bold", 9.5);
    doc.text(pdfText(r.title), MARGIN, p.y);
    p.y += 4.2;
    p.font("helvetica", "normal", 9, "#3f3f46");
    p.para(r.text);
    p.y += 2.5;
  }
  if (spec.notes.trim()) {
    p.ensure(12);
    p.font("helvetica", "bold", 9.5);
    doc.text("Notes for the implementer", MARGIN, p.y);
    p.y += 4.2;
    p.font("helvetica", "normal", 9, "#3f3f46");
    for (const line of spec.notes.trim().split(/\r?\n/)) p.para(line || " ");
  }
}

/** "Test cases": every input with the output the implementation must produce. */
export function drawTestCases(doc: jsPDF, cases: TestCase[]) {
  if (!cases.length) return;
  const p = pen(doc);
  p.font("helvetica", "bold", 15);
  doc.text("Test cases", MARGIN, p.y + 4);
  p.y += 11;
  p.font("helvetica", "normal", 9, "#3f3f46");
  p.para(
    "Each test case is an input and the output the implementation must produce. The same cases are available as JSON (Test cases button on the report page) for unit tests.",
  );
  p.y += 2;
  for (const c of cases) {
    p.ensure(24);
    p.y += 3;
    doc.setDrawColor("#d4d4d8");
    doc.setLineWidth(0.2);
    doc.line(MARGIN, p.y - 3, MARGIN + CONTENT_W, p.y - 3);
    p.font("helvetica", "bold", 9.5);
    p.para(`${c.id} - ${c.scenario ? `${c.scenario} - ` : ""}${c.title}`, CONTENT_W, MARGIN, 4.2);
    p.font("helvetica", "normal", 8, c.error ? "#b45309" : "#71717a");
    p.para(c.error ? `Expected: ${c.error}` : c.caseName ? `Uses case "${c.caseName}"` : "");
    p.y += 1;
    p.font("helvetica", "bold", 8, "#52525b");
    doc.text("Input", MARGIN, p.y);
    p.y += 3.6;
    p.mono(headerLines(c.input.headers) + c.input.text);
    if (c.expected) {
      p.y += 1.5;
      p.ensure(8);
      p.font("helvetica", "bold", 8, "#52525b");
      doc.text("Expected output", MARGIN, p.y);
      p.y += 3.6;
      p.mono(headerLines(c.expected.headers) + c.expected.text);
    }
  }
}
