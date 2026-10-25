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

function bucketLines(lines: string[], layout: FlatLayout) {
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
      layout.delimiter === "fixed" ? null : splitDelimited(line, layout.delimiter)[0].trim();
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

  return { buckets, warnings };
}

export function parseFlat(text: string, layout: FlatLayout): FlatReadResult {
  const lines = splitLines(text);
  if (lines.length === 0) throw new Error("The file is empty.");
  const { buckets, warnings } = bucketLines(lines, layout);

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
    // An empty record (a section with no fields yet) writes no line.
    const records = recordsOf(obj, name).filter((r) => Object.keys(r).length > 0);
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
export function syncLayoutFields(
  layout: FlatLayout,
  data: Json,
  /** A file just read with this layout: names past what the sample line holds are kept (e.g. columns still waiting for a length). */
  keepExtra = false,
): FlatLayout {
  const obj: Obj = typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Obj) : {};
  const next = { ...layout };
  for (const name of SECTIONS) {
    const records = recordsOf(obj, name);
    if (!records.length) continue;
    const keys = Object.keys(records[0]);
    const fields = keepExtra && layout[name].fields.length > keys.length ? [...keys, ...layout[name].fields.slice(keys.length)] : keys;
    // A section that gains fields is written again.
    next[name] = { ...layout[name], fields, enabled: layout[name].enabled || fields.length > 0 };
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

// ---------- Layout detection (for the layout editor) ----------

const splitLines = (text: string) => {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
};

/** The lines of each section, as the reader sorts them (for showing samples). */
export function sectionLines(text: string, layout: FlatLayout): Record<SectionName, string[]> {
  return bucketLines(splitLines(text), layout).buckets;
}

/** One record split into raw values with the layout (fixed width: untrimmed, so the editor can show columns). */
export function splitRecord(line: string, sec: FlatSection, layout: FlatLayout): string[] {
  return layout.delimiter === "fixed" ? splitFixed(line, sec) : splitDelimited(line, layout.delimiter);
}

/**
 * Column breaks for fixed-width lines: a new column starts wherever every line
 * has a space before a non-space, or a run of digits meets letters.
 */
export function guessBreaks(lines: string[]): number[] {
  const sample = lines.filter((l) => l.trim()).slice(0, 20);
  if (!sample.length) return [];
  const len = Math.max(...sample.map((l) => l.length));
  const at = (l: string, i: number) => l[i] ?? " ";
  const breaks: number[] = [];
  for (let i = 1; i < len; i++) {
    const spaceBefore = sample.every((l) => at(l, i - 1) === " ");
    const textHere = sample.some((l) => at(l, i) !== " ");
    if (spaceBefore && textHere) breaks.push(i);
  }
  return breaks;
}

/** Widths for each field from break positions (the last field runs to the end of the line). */
export function widthsFromBreaks(breaks: number[], lineLength: number): number[] {
  const points = [0, ...[...new Set(breaks)].filter((b) => b > 0 && b < lineLength).sort((a, b) => a - b), lineLength];
  return points.slice(1).map((p, i) => p - points[i]).filter((w) => w > 0);
}

/**
 * A starting layout for a pasted file: the delimiter, and record codes when the
 * first value of each line is a short code (H / D / T, 01 / 05 / 99…).
 * Field names and widths already set are kept.
 */
export function detectLayout(text: string, current: FlatLayout = defaultFlatLayout()): FlatLayout {
  const layout = detectRecords(text, current);
  if (layout.delimiter !== "fixed") return layout;
  // Fixed width: a first guess at each section's columns (where every line has a gap).
  const { buckets } = bucketLines(splitLines(text), layout);
  const out = { ...layout };
  for (const name of SECTIONS) {
    const sec = layout[name];
    if (!sec.enabled || Object.keys(sec.widths).length || !buckets[name].length) continue;
    const widths = widthsFromBreaks(guessBreaks(buckets[name]), Math.max(...buckets[name].map((l) => l.length)));
    const fields = widths.map((_, i) => sec.fields[i] || `field${i + 1}`);
    out[name] = { ...sec, fields, widths: Object.fromEntries(fields.map((f, i) => [f, widths[i]])) };
  }
  return out;
}

function detectRecords(text: string, current: FlatLayout): FlatLayout {
  const lines = splitLines(text);
  if (!lines.length) return current;
  const delimiter = guessDelimiter(text);
  const fixed = delimiter === "fixed";
  // Fixed width: try a 1- or 2-character code at the start of the line.
  const codeLen = fixed
    ? [1, 2].find((n) => new Set(lines.map((l) => l.slice(0, n))).size <= 4 && /^[A-Za-z0-9]+$/.test(lines[0].slice(0, n))) ?? 0
    : 0;
  const codeOf = (l: string) => (fixed ? l.slice(0, codeLen) : splitDelimited(l, delimiter)[0].trim());
  const codes = lines.map(codeOf);
  const distinct = [...new Set(codes)];
  const looksLikeCodes =
    lines.length >= 2 &&
    (!fixed || codeLen > 0) &&
    distinct.length >= 2 &&
    distinct.length <= 4 &&
    distinct.every((c) => /^[A-Za-z0-9]{1,4}$/.test(c));
  const base = { ...current, delimiter };
  if (!looksLikeCodes) {
    return { ...base, identifyBy: "position" };
  }
  // The body is the most common code; a different first / last code is the header / footer.
  const count = (c: string) => codes.filter((x) => x === c).length;
  const bodyCode = [...distinct].sort((a, b) => count(b) - count(a))[0];
  const first = codes[0];
  const last = codes[codes.length - 1];
  return {
    ...base,
    identifyBy: "code",
    header: { ...current.header, enabled: first !== bodyCode, code: first !== bodyCode ? first : current.header.code },
    body: { ...current.body, enabled: true, code: bodyCode },
    footer: { ...current.footer, enabled: last !== bodyCode && last !== first, code: last !== bodyCode ? last : current.footer.code },
  };
}

/**
 * How field paths move when a section's field names change position by
 * position (so mappings and tags follow a rename made in the layout editor).
 */
export function layoutRenames(before: FlatLayout, after: FlatLayout): ((p: (string)[]) => (string)[]) | undefined {
  const renames: Partial<Record<SectionName, Map<string, string>>> = {};
  let any = false;
  for (const name of SECTIONS) {
    const map = new Map<string, string>();
    const longest = Math.max(before[name].fields.length, after[name].fields.length);
    for (let i = 0; i < longest; i++) {
      const from = before[name].fields[i] || `field${i + 1}`;
      const to = after[name].fields[i] || `field${i + 1}`;
      if (from !== to) map.set(from, to);
    }
    if (map.size) {
      renames[name] = map;
      any = true;
    }
  }
  if (!any) return undefined;
  return (p) => {
    const sec = p[0] as SectionName;
    const map = renames[sec];
    if (!map) return p;
    // header.x / footer.x, or body.[].x
    const i = sec === "body" ? 2 : 1;
    if (p.length <= i || !map.has(p[i])) return p;
    return [...p.slice(0, i), map.get(p[i])!, ...p.slice(i + 1)];
  };
}

/** Whether a layout reads a file sensibly (its separator is there; with codes, every line has a known one). */
export function layoutFits(text: string, layout: FlatLayout): boolean {
  const lines = splitLines(text);
  if (!lines.length) return true;
  if (layout.delimiter !== "fixed" && !lines[0].includes(layout.delimiter)) return false;
  if (layout.delimiter === "fixed" && guessDelimiter(text) !== "fixed") return false;
  if (layout.identifyBy === "code") {
    const { buckets } = bucketLines(lines, layout);
    return SECTIONS.reduce((n, s) => n + buckets[s].length, 0) === lines.length;
  }
  return true;
}

// ---------- Fields outside the sections ----------

const isRecord = (v: Json | undefined): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Top-level fields that aren't header / body / footer, so a flat file doesn't carry them. */
export function strayFields(data: Json | null): string[] {
  if (Array.isArray(data)) return data.length ? ["(the list of records)"] : [];
  if (!isRecord(data)) return [];
  return Object.keys(data).filter((k) => !(SECTIONS as readonly string[]).includes(k));
}

/**
 * Put the top-level fields into a section: the body (each record) or the header.
 * A top-level list of records becomes the body. Missing sections are added
 * empty. `move` says where each old path went, so mappings can follow.
 */
export function wrapInSection(data: Json, into: "body" | "header"): { data: Json; move: (p: string[]) => string[] } {
  if (Array.isArray(data)) {
    return {
      data: { header: {}, body: data, footer: {} },
      move: (p) => (p[0] === "[]" ? ["body", ...p] : p),
    };
  }
  const obj = isRecord(data) ? data : {};
  const stray = strayFields(obj);
  const loose: Obj = Object.fromEntries(stray.map((k) => [k, obj[k]]));
  const header: Obj = isRecord(obj.header) ? obj.header : {};
  const footer: Obj = isRecord(obj.footer) ? obj.footer : {};
  const bodyList = Array.isArray(obj.body) ? obj.body : isRecord(obj.body) ? [obj.body] : [];
  const records = bodyList.filter(isRecord);
  const next: Obj =
    into === "header"
      ? { header: { ...header, ...loose }, body: records.length ? records : [{}], footer }
      : { header, body: (records.length ? records : [{}]).map((r) => ({ ...r, ...loose })), footer };
  const strays = new Set(stray);
  return {
    data: next,
    move: (p) => (p.length && strays.has(p[0]) ? (into === "header" ? ["header", ...p] : ["body", "[]", ...p]) : p),
  };
}
