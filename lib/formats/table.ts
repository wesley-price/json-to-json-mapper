// Database tables as a format. Reading accepts:
//   • SQL: CREATE TABLE statements (the columns and their types) plus optional
//     INSERT INTO … VALUES … rows for sample values;
//   • a grid pasted from a spreadsheet or SQL client (tab- or |-separated, with
//     a header row): data rows, or a column listing like "column | type".
// Each table becomes an object keyed by its name: one row = an object of
// columns, several rows = a list of them. Writing produces CREATE TABLE plus
// one INSERT per row, which reads back to the same object.

import type { Json } from "../json-tree";
import { inferScalar } from "./xml";
import { bigNumberNote } from "./lossless";

type Row = Record<string, Json>;

// ---------- SQL types ----------

const NUMERIC = /^(tiny|small|medium|big)?int(eger)?\b|^serial|^bigserial|^smallserial|^number|^numeric|^decimal|^dec\b|^float|^double|^real|^money/i;
const BOOLEAN = /^bool(ean)?\b|^bit\b/i;
const TIMESTAMP = /^(timestamp|datetime)/i;
const DATE = /^date\b/i;
const TIME = /^time\b/i;
const JSONISH = /^jsonb?\b/i;

/** A sample value for a column type (used when no INSERT row gives one). */
function sampleFor(type: string): Json {
  if (NUMERIC.test(type)) return 0;
  if (BOOLEAN.test(type)) return false;
  if (TIMESTAMP.test(type)) return "2026-01-01T00:00:00Z";
  if (DATE.test(type)) return "2026-01-01";
  if (TIME.test(type)) return "00:00:00";
  return "";
}

/** The SQL type written for a value. */
function typeFor(v: Json): string {
  if (typeof v === "boolean") return "BOOLEAN";
  if (typeof v === "number") return Number.isInteger(v) ? (Math.abs(v) > 2147483647 ? "BIGINT" : "INTEGER") : "NUMERIC(18,4)";
  if (v !== null && typeof v === "object") return "JSON";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return "DATE";
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) return "TIMESTAMP";
    return v.length > 255 ? "TEXT" : "VARCHAR(255)";
  }
  return "VARCHAR(255)";
}

const unquote = (name: string) => name.trim().replace(/^[`"[]|[`"\]]$/g, "");

/** Split on commas that are not inside brackets or quotes. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === quote) {
        if (text[i + 1] === quote) cur += text[++i];
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** The text between the bracket at `open` and its match. */
function bracketBody(text: string, open: number): { body: string; end: number } {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = text[i + 1] === quote ? (i++, quote) : null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return { body: text.slice(open + 1, i), end: i };
  }
  throw new Error("A bracket is never closed.");
}

/** One SQL literal: 'text' (with '' escapes), numbers, TRUE/FALSE/NULL. */
function literal(token: string, type = "", notes?: string[]): Json {
  const t = token.trim();
  if (/^'[\s\S]*'$/.test(t)) {
    const s = t.slice(1, -1).replace(/''/g, "'");
    if (JSONISH.test(type)) {
      try {
        const parsed = JSON.parse(s) as Json;
        if (parsed !== null && typeof parsed === "object") return parsed;
      } catch {
        // not JSON: keep the text
      }
    }
    return s;
  }
  if (/^null$/i.test(t)) return null;
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (t !== "" && !Number.isNaN(Number(t))) {
    // Integers beyond what JavaScript holds exactly stay text, with every digit.
    if (/^-?\d+$/.test(t) && !Number.isSafeInteger(Number(t))) {
      notes?.push(bigNumberNote(t));
      return t;
    }
    return Number(t);
  }
  return t;
}

const sqlLiteral = (v: Json): string =>
  v === null
    ? "NULL"
    : typeof v === "boolean"
      ? (v ? "TRUE" : "FALSE")
      : typeof v === "number"
        ? String(v)
        : `'${(typeof v === "string" ? v : JSON.stringify(v)).replace(/'/g, "''")}'`;

const stripComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

const CONSTRAINT = /^(primary\s+key|constraint|foreign\s+key|unique|index|key|check|exclude)\b/i;

// ---------- reading ----------

function parseSql(text: string, notes?: string[]): Json {
  const sql = stripComments(text);
  const tables = new Map<string, { columns: [string, string][]; rows: Row[] }>();

  for (const m of sql.matchAll(/create\s+(?:temporary\s+|temp\s+)?table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(/gi)) {
    const name = unquote(m[1].split(".").pop()!);
    const { body } = bracketBody(sql, m.index! + m[0].length - 1);
    const columns: [string, string][] = [];
    for (const def of splitTop(body)) {
      const d = def.trim();
      if (!d || CONSTRAINT.test(d)) continue;
      const parts = d.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)\s*([\s\S]*)$/);
      if (!parts) continue;
      columns.push([unquote(parts[1]), parts[2].trim()]);
    }
    tables.set(name, { columns, rows: [] });
  }

  for (const m of sql.matchAll(/insert\s+into\s+([^\s(]+)\s*(\(([^)]*)\))?\s*values\s*/gi)) {
    const name = unquote(m[1].split(".").pop()!);
    const table = tables.get(name) ?? { columns: [], rows: [] };
    if (!tables.has(name)) tables.set(name, table);
    const cols = m[3] ? m[3].split(",").map(unquote) : table.columns.map(([c]) => c);
    // Every "( … )" group after VALUES, up to the statement's end.
    let i = m.index! + m[0].length;
    while (i < sql.length && sql[i] === "(") {
      const { body, end } = bracketBody(sql, i);
      const values = splitTop(body);
      const row: Row = {};
      cols.forEach((c, k) => {
        const type = table.columns.find(([n]) => n === c)?.[1] ?? "";
        row[c] = k < values.length ? literal(values[k], type, notes) : null;
      });
      table.rows.push(row);
      i = end + 1;
      while (i < sql.length && /[\s,]/.test(sql[i])) i++;
    }
  }

  if (tables.size === 0) throw new Error("No CREATE TABLE or INSERT INTO statement found.");
  const out: Row = {};
  for (const [name, { columns, rows }] of tables) {
    const sample: Row = Object.fromEntries(columns.map(([c, type]) => [c, sampleFor(type)]));
    const filled = rows.map((r) => ({ ...sample, ...r }));
    out[name] = filled.length > 1 ? filled : (filled[0] ?? sample);
  }
  return out;
}

const SCHEMA_NAME = /^(column|column_name|field|name|col)$/i;
const SCHEMA_TYPE = /^(type|data_type|datatype|sql_type)$/i;

function parseGrid(text: string): Json {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !/^[\s|:+=-]+$/.test(l)); // markdown / psql separator lines
  let name = "table";
  if (lines.length && /^(--\s*)?table\s*:/i.test(lines[0])) name = lines.shift()!.replace(/^(--\s*)?table\s*:/i, "").trim() || name;
  if (lines.length < 2) throw new Error("A table needs a header row and at least one more row.");
  const delim = lines[0].includes("\t") ? "\t" : "|";
  const cells = (l: string) => {
    const parts = l.split(delim).map((c) => c.trim());
    if (delim === "|") {
      if (parts[0] === "") parts.shift();
      if (parts[parts.length - 1] === "") parts.pop();
    }
    return parts;
  };
  const header = cells(lines[0]);
  const rows = lines.slice(1).map(cells);

  // A column listing: column | type (| sample)
  const nameCol = header.findIndex((h) => SCHEMA_NAME.test(h));
  const typeCol = header.findIndex((h) => SCHEMA_TYPE.test(h));
  if (nameCol >= 0 && typeCol >= 0) {
    const sampleCol = header.findIndex((h) => /^(sample|example|value|default)$/i.test(h));
    const row: Row = {};
    for (const r of rows) {
      if (!r[nameCol]) continue;
      const given = sampleCol >= 0 ? r[sampleCol] : undefined;
      row[unquote(r[nameCol])] = given ? literal(/^'.*'$/.test(given) ? given : given, r[typeCol] ?? "") : sampleFor(r[typeCol] ?? "");
    }
    return { [name]: row };
  }

  // Data rows.
  const records = rows.map((r) =>
    Object.fromEntries(header.map((h, k) => [h, /^null$/i.test(r[k] ?? "") ? null : inferScalar(r[k] ?? "")])),
  );
  return { [name]: records.length > 1 ? records : records[0] };
}

/** `notes`: collects a note for each integer too large for JavaScript (kept as text). */
export function parseTable(text: string, notes: string[] = []): Json {
  if (/\b(create\s+(temporary\s+|temp\s+)?table|insert\s+into)\b/i.test(text)) return parseSql(text, notes);
  if (!text.trim()) throw new Error("Paste a CREATE TABLE statement or a table with a header row.");
  return parseGrid(text);
}

/** Declared column types from CREATE TABLE statements: "table.column" -> "NUMERIC(10,2)". */
export function declaredTypes(text: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!text || !/create\s+(temporary\s+|temp\s+)?table/i.test(text)) return out;
  const sql = stripComments(text);
  for (const m of sql.matchAll(/create\s+(?:temporary\s+|temp\s+)?table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(/gi)) {
    const name = unquote(m[1].split(".").pop()!);
    try {
      const { body } = bracketBody(sql, m.index! + m[0].length - 1);
      for (const def of splitTop(body)) {
        const d = def.trim();
        if (!d || CONSTRAINT.test(d)) continue;
        const parts = d.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)\s*([\s\S]*)$/);
        if (parts && parts[2].trim()) out.set(`${name}.${unquote(parts[1])}`, parts[2].trim());
      }
    } catch {
      // an unclosed bracket: no declared types
    }
  }
  return out;
}

// ---------- writing ----------

const isScalar = (v: Json) => v === null || typeof v !== "object";
const isRow = (v: Json): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);

/** `like`: SQL whose CREATE TABLE column definitions (types, keys…) are reused when writing. */
export function toTable(data: Json, like?: string): string {
  const declared = declaredTypes(like);
  // Each top-level key is a table (an object = one row, a list of objects = rows).
  const tableShaped =
    isRow(data) &&
    Object.keys(data).length > 0 &&
    Object.values(data).every((v) => isRow(v) || (Array.isArray(v) && v.every(isRow)));
  const tables: [string, Row[]][] = tableShaped
    ? Object.entries(data as Record<string, Json>).map(([k, v]) => [k, Array.isArray(v) ? (v as Row[]) : [v as Row]])
    : [["data", Array.isArray(data) ? (data.filter(isRow) as Row[]) : isRow(data) ? [data] : []]];

  const quoteName = (n: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `"${n.replace(/"/g, '""')}"`);
  const out: string[] = [];
  for (const [name, rows] of tables) {
    const cols: string[] = [];
    for (const r of rows) for (const c of Object.keys(r)) if (!cols.includes(c)) cols.push(c);
    const typeOf = (c: string) =>
      declared.get(`${name}.${c}`) ?? typeFor(rows.map((r) => r[c]).find((v) => v !== null && v !== undefined) ?? null);
    out.push(
      `CREATE TABLE ${quoteName(name)} (\n${cols.map((c) => `  ${quoteName(c)} ${typeOf(c)}`).join(",\n")}\n);`,
    );
    for (const r of rows) {
      out.push(
        `INSERT INTO ${quoteName(name)} (${cols.map(quoteName).join(", ")}) VALUES (${cols
          .map((c) => sqlLiteral(c in r ? (isScalar(r[c]) ? r[c] : r[c]) : null))
          .join(", ")});`,
      );
    }
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}
