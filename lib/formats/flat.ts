// Flat files made of header / body / footer records <-> JSON tree.
//
//   H|20261018|ACME              { header: { recordType: "H", date: 20261018, sender: "ACME" },
//   D|A-1|19.99          <->       body:   [ { recordType: "D", orderId: "A-1", total: 19.99 }, … ],
//   D|A-2|5.50                     footer: { recordType: "T", count: 2 } }
//   T|2
//
// Records are told apart either by position (first line = header, last line =
// footer, the rest = body) or by a record code at the start of each line.
// Fields are split on a delimiter or by fixed widths.

import type { Json } from "../json-tree";
import { inferScalar } from "./xml";

export const SECTIONS = ["header", "body", "footer"] as const;
export type SectionName = (typeof SECTIONS)[number];

export type Delimiter = "|" | "," | "\t" | ";" | "fixed";

export interface FlatSection {
  enabled: boolean;
  /** Record code that starts lines of this section (when identifying by code). */
  code: string;
  /** Field names used when reading; extra fields get field1, field2, … */
  fields: string[];
  /** Fixed-width column widths, by field name. */
  widths: Record<string, number>;
}

export interface FlatLayout {
  delimiter: Delimiter;
  identifyBy: "position" | "code";
  header: FlatSection;
  body: FlatSection;
  footer: FlatSection;
}

const section = (enabled: boolean, code: string): FlatSection => ({ enabled, code, fields: [], widths: {} });

export const defaultFlatLayout = (): FlatLayout => ({
  delimiter: "|",
  identifyBy: "position",
  header: section(true, "H"),
  body: section(true, "D"),
  footer: section(true, "T"),
});

type Obj = { [key: string]: Json };

// ---------- Reading ----------

/** Split a delimited line, honouring "quoted, values" with "" escapes. */
function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur === "") quoted = true;
    else if (line.startsWith(delim, i)) {
      out.push(cur);
      cur = "";
      i += delim.length - 1;
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function splitFixed(line: string, sec: FlatSection): string[] {
  const out: string[] = [];
  let pos = 0;
  for (const name of sec.fields) {
    const width = sec.widths[name];
    if (!width) break;
    out.push(line.slice(pos, pos + width));
    pos += width;
  }
  if (pos < line.length) out.push(line.slice(pos)); // whatever is left over
  return out;
}

function readRecord(line: string, sec: FlatSection, layout: FlatLayout): Obj {
  const values =
    layout.delimiter === "fixed" ? splitFixed(line, sec).map((v) => v.trim()) : splitDelimited(line, layout.delimiter);
  const record: Obj = {};
  values.forEach((v, i) => {
    record[sec.fields[i] || `field${i + 1}`] = inferScalar(v);
  });
  return record;
}

export interface FlatReadResult {
  data: Json;
  warnings: string[];
}

export function parseFlat(text: string, layout: FlatLayout): FlatReadResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length === 0) throw new Error("The file is empty.");

  const buckets: Record<SectionName, string[]> = { header: [], body: [], footer: [] };
  const warnings: string[] = [];

  if (layout.identifyBy === "position") {
    let start = 0;
    let end = lines.length;
    if (layout.header.enabled) buckets.header.push(lines[start++]);
    if (layout.footer.enabled && end > start) buckets.footer.push(lines[--end]);
    buckets.body.push(...lines.slice(start, end));
  } else {
    const codeOf = (line: string) =>
      layout.delimiter === "fixed" ? null : splitDelimited(line, layout.delimiter)[0];
    lines.forEach((line, i) => {
      const code = codeOf(line);
      const match = SECTIONS.find((s) => {
        const sec = layout[s];
        if (!sec.enabled || !sec.code) return false;
        return code === null ? line.startsWith(sec.code) : code === sec.code;
      });
      if (match) buckets[match].push(line);
      else warnings.push(`Line ${i + 1} doesn't start with a known record code and was skipped.`);
    });
  }

  const data: Obj = {};
  if (layout.header.enabled) data.header = buckets.header[0] ? readRecord(buckets.header[0], layout.header, layout) : {};
  if (layout.body.enabled) data.body = buckets.body.map((l) => readRecord(l, layout.body, layout));
  if (layout.footer.enabled) {
    data.footer = buckets.footer[0] ? readRecord(buckets.footer[0], layout.footer, layout) : {};
  }
  if (layout.header.enabled && buckets.header.length > 1) warnings.push("More than one header record; kept the first.");
  if (layout.footer.enabled && buckets.footer.length > 1) warnings.push("More than one footer record; kept the first.");
  return { data, warnings };
}

// ---------- Writing ----------

const cell = (v: Json) => (v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

function quote(value: string, delim: string): string {
  return value.includes(delim) || value.includes('"') || /[\r\n]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/** Records of a section as plain objects (a body object counts as one record). */
function recordsOf(data: Obj, name: SectionName): Obj[] {
  const v = data[name];
  if (Array.isArray(v)) return v.filter((r): r is Obj => typeof r === "object" && r !== null && !Array.isArray(r));
  if (typeof v === "object" && v !== null) return [v as Obj];
  return [];
}

export function toFlat(data: Json, layout: FlatLayout): string {
  const obj: Obj = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Obj) : {};
  const lines: string[] = [];
  for (const name of SECTIONS) {
    const sec = layout[name];
    if (!sec.enabled) continue;
    const records = recordsOf(obj, name);
    // Field order follows the object (which the tree controls).
    const fieldNames = records.length ? Object.keys(records[0]) : [];
    for (const record of records) {
      if (layout.delimiter === "fixed") {
        lines.push(
          fieldNames
            .map((f) => {
              const text = cell(record[f] ?? null);
              const width = sec.widths[f] ?? Math.max(...records.map((r) => cell(r[f] ?? null).length), 1);
              const fitted = text.slice(0, width);
              return typeof record[f] === "number" ? fitted.padStart(width) : fitted.padEnd(width);
            })
            .join(""),
        );
      } else {
        const delim = layout.delimiter;
        lines.push(fieldNames.map((f) => quote(cell(record[f] ?? null), delim)).join(delim));
      }
    }
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

/** Keep the layout's field names in step with the data (e.g. after renames in the tree). */
export function syncLayoutFields(layout: FlatLayout, data: Json): FlatLayout {
  const obj: Obj = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Obj) : {};
  const next = { ...layout };
  for (const name of SECTIONS) {
    const records = recordsOf(obj, name);
    if (records.length) next[name] = { ...layout[name], fields: Object.keys(records[0]) };
  }
  return next;
}

/** Guess the delimiter from the first line of a file. */
export function guessDelimiter(text: string): Delimiter {
  const first = text.split(/\r?\n/)[0] ?? "";
  const counts: [Delimiter, number][] = (["|", "\t", ",", ";"] as const).map((d) => [d, first.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : "fixed";
}
