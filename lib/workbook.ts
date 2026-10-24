// The Excel workbook format used for export/import. Both directions live here
// so they stay in sync.
//
// Sheets (matched by name prefix on import, falling back to position):
//   1. "Mapped Result"   Field | Value | Type   (export only; ignored on import)
//   2. "Mappings"        # | Source (<side>) | Target (<side>) | Source type | Target type | Join with
//                        | Constant value | Translation (JSON)
//                        (rows sharing a target are combined, in row order, joined with "Join with";
//                         a Source of "(constant)" writes the Constant value instead of a field)
//   3. "Primary (<side>)" Field | Value | Type  (flattened primary object)
//   4. "Target (<side>)"  Field | Value | Type  (flattened editable object)
//   5. "Formats"         Side | Format | Flat layout (JSON)   (optional; older workbooks are JSON)
//   6. "Headers"         Side | Header | Value | Type         (optional; JSON/XML header pairs)

import {
  type Json,
  type Mapping,
  type Path,
  type Side,
  allPaths,
  buildTree,
  findNode,
  flatten,
  parsePathLabel,
  pathId,
  pathLabel,
  unflatten,
} from "./json-tree";
import { type FlatLayout, type Format, FORMATS, defaultFlatLayout } from "./formats";
import { type Headers, lookupTree, supportsHeaders } from "./headers";
import { type DbRef, type Fixed, type FixedValues, type Translation, formatDbRef, isConstPath, newConstPath, parseDbRef } from "./transforms";
import { inferScalar } from "./formats/xml";
import type { Cell, Sheet } from "./xlsx";

const CONSTANT_SOURCE = "(constant)";
const HEADERS_SEGMENT = "$headers";

export type SideFormats = Record<Side, { format: Format; layout: FlatLayout }>;

const other = (side: Side): Side => (side === "left" ? "right" : "left");

/** One spreadsheet row for a flattened field; empty containers show as {} / []. */
export function flatRow(field: string, value: Json): Cell[] {
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const cell: Cell = typeof value === "object" && value !== null ? JSON.stringify(value) : value;
  return [field, cell, type];
}

/**
 * "yes" for a hardcoded tag whose value is the field value, "yes=<value>" when
 * the constant differs from the field value, or
 * "db:table.column" plus "=sample" when a database tag has a sample value. With a
 * lookup key: "db:table.column where code = errorCode" plus " ;sample=<value>".
 */
export function fixedCell(fixed: Fixed | undefined, fieldValue?: Json): Cell {
  if (!fixed) return "";
  if (!fixed.db) {
    if (fieldValue === undefined || JSON.stringify(fixed.value) === JSON.stringify(fieldValue)) return "yes";
    return `yes=${typeof fixed.value === "string" ? fixed.value : JSON.stringify(fixed.value)}`;
  }
  const raw = fixed.value === null || fixed.value === undefined || fixed.value === "" ? "" : typeof fixed.value === "object" ? JSON.stringify(fixed.value) : String(fixed.value);
  // A lookup key can contain "=", so the sample then gets its own marker.
  if (fixed.db.where?.trim()) return `db:${formatDbRef(fixed.db)}${raw ? ` ;sample=${raw}` : ""}`;
  return `db:${fixed.db.table}.${fixed.db.column}${raw ? `=${raw}` : ""}`;
}

/** Read a Constant cell back ("yes" / "db:table.column"); undefined when not tagged. */
export function readFixedCell(cell: Cell, fieldValue: Json): Fixed | undefined {
  let value = fieldValue;
  const text = String(cell ?? "").trim();
  if (!text || /^(no|false|0)$/i.test(text)) return undefined;
  const own = /^yes=([\s\S]*)$/i.exec(text);
  if (own) return { value: inferScalar(own[1]) };
  if (!/^db:/i.test(text)) return { value };
  let ref = text.slice(3);
  let sample: string | undefined;
  const marker = ref.indexOf(" ;sample=");
  if (marker >= 0) {
    sample = ref.slice(marker + " ;sample=".length);
    ref = ref.slice(0, marker);
  } else if (!/\swhere\s/i.test(ref) && ref.includes("=")) {
    sample = ref.slice(ref.indexOf("=") + 1);
    ref = ref.slice(0, ref.indexOf("="));
  }
  // A database tag keeps its own sample value (not the field value).
  value = sample === undefined ? "" : inferScalar(sample);
  return { value, db: parseDbRef(ref) };
}

/** "a.b[0].c" -> the generic path with [] for list items, as tags use. */
export function genericPathId(label: string): string | null {
  try {
    return pathId(parsePathLabel(label).map((seg) => (typeof seg === "number" ? "[]" : seg)));
  } catch {
    return null;
  }
}

/** `types`: declared types from the object's schema (path JSON -> "long (timestamp-millis)"), shown in a "Schema type" column. */
export function flatSheet(name: string, data: Json | null, fixed: FixedValues = {}, types?: Map<string, string>): Sheet {
  const withTypes = !!types && types.size > 0;
  return {
    name,
    rows: [
      ["Field", "Value", "Type", "Constant", ...(withTypes ? ["Schema type"] : [])],
      ...(data === null
        ? []
        : Object.entries(flatten(data)).map(([k, v]) => {
            const id = genericPathId(k);
            const row: Cell[] = [...flatRow(k, v), fixedCell(id ? fixed[id] : undefined, v)];
            return withTypes ? [...row, (id && types!.get(id)) || ""] : row;
          })),
    ],
  };
}

export function buildWorkbook(opts: {
  primary: Side;
  data: Record<Side, Json | null>;
  mappings: Mapping[];
  result: Json | null;
  formats: SideFormats;
  headers?: Record<Side, Headers>;
  /** Fields tagged as constants on each side. */
  fixed?: Record<Side, FixedValues>;
  /** The document name (stored on the Document sheet). */
  docName?: string;
  /** What each object is called. */
  names?: Record<Side, string>;
  /** Declared types from each object's schema (Avro, CREATE TABLE). */
  schemaTypes?: Partial<Record<Side, Map<string, string>>>;
}): Sheet[] {
  const { primary, data, mappings, result, formats } = opts;
  const headers = opts.headers ?? { left: {}, right: {} };
  const secondary = other(primary);
  const trees = {
    left: data.left === null ? null : buildTree(data.left),
    right: data.right === null ? null : buildTree(data.right),
  };
  const typeAt = (side: Side, path: Path) => {
    const tree = trees[side];
    return (tree && findNode(tree, path)?.type) ?? "";
  };
  return [
    documentSheet(opts.docName ?? "", "single", [
      ["Primary name", opts.names?.[primary] ?? ""],
      ["Target name", opts.names?.[secondary] ?? ""],
    ]),
    flatSheet("Mapped Result", result, {}, opts.schemaTypes?.[secondary]),
    {
      name: "Mappings",
      rows: [
        ["#", `Source (${primary})`, `Target (${secondary})`, "Source type", "Target type", "Join with", "Constant value", "Translation", "Constant from database", "Notes"],
        ...mappings.map((m, i): Cell[] => [
          i + 1,
          isConstPath(m[primary]) ? CONSTANT_SOURCE : pathLabel(m[primary]),
          pathLabel(m[secondary]),
          isConstPath(m[primary]) ? "" : typeAt(primary, m[primary]),
          typeAt(secondary, m[secondary]),
          // Only meaningful when several rows share this target.
          mappings.filter((o) => pathId(o[secondary]) === pathId(m[secondary])).length > 1 ? (m.join ?? " ") : "",
          m.constant === undefined ? "" : typeof m.constant === "object" && m.constant !== null ? JSON.stringify(m.constant) : m.constant,
          m.translate ? JSON.stringify(m.translate) : "",
          m.db ? formatDbRef(m.db) : "",
          m.note ?? "",
        ]),
      ],
    },
    flatSheet(`Primary (${primary})`, data[primary], opts.fixed?.[primary], opts.schemaTypes?.[primary]),
    flatSheet(`Target (${secondary})`, data[secondary], opts.fixed?.[secondary], opts.schemaTypes?.[secondary]),
    {
      name: "Headers",
      rows: [
        ["Side", "Header", "Value", "Type", "Constant"],
        ...(["left", "right"] as const).flatMap((side) =>
          Object.entries(headers[side] ?? {}).map(([name, value]): Cell[] => {
            const [, cell, type] = flatRow(name, value);
            return [side, name, cell, type, fixedCell(opts.fixed?.[side]?.[pathId([HEADERS_SEGMENT, name])], value)];
          }),
        ),
      ],
    },
    {
      name: "Formats",
      rows: [
        ["Side", "Format", "Flat layout (JSON)"],
        ...(["left", "right"] as const).map((side): Cell[] => [
          side,
          formats[side].format,
          formats[side].format === "flat" ? JSON.stringify(formats[side].layout) : "",
        ]),
      ],
    },
  ];
}

// ---------- Import ----------

export interface ImportedWorkbook {
  primary: Side;
  data: Record<Side, Json>;
  mappings: Omit<Mapping, "id">[];
  formats: SideFormats;
  headers: Record<Side, Headers>;
  fixed: Record<Side, FixedValues>;
  docName: string;
  names: Record<Side, string>;
  /** Human-readable notes about anything that was skipped. */
  warnings: string[];
}

const sideIn = (text: Cell): Side | null => {
  const m = /\((left|right)\)/i.exec(String(text ?? ""));
  return m ? (m[1].toLowerCase() as Side) : null;
};

/** Turn a cell back into a JSON value, using the Type column when present. */
export function toJson(value: Cell, type: Cell): Json {
  const t = String(type ?? "").trim().toLowerCase();
  switch (t) {
    case "null":
      return null;
    case "string":
      return value === null ? "" : String(value);
    case "number": {
      const n = Number(value);
      return value === null || value === "" || Number.isNaN(n) ? 0 : n;
    }
    case "boolean":
      return typeof value === "boolean" ? value : /^(true|1|yes)$/i.test(String(value ?? "").trim());
    case "object":
    case "array":
      try {
        const parsed = JSON.parse(String(value ?? ""));
        if (typeof parsed === "object" && parsed !== null) return parsed;
      } catch {
        // fall through to an empty container
      }
      return t === "array" ? [] : {};
    default:
      return value; // no/unknown type: keep the cell as-is
  }
}

export function readFlatSheet(sheet: Sheet, label: string, warnings: string[], fixed: FixedValues = {}): Json {
  const entries: [(string | number)[], Json][] = [];
  sheet.rows.slice(1).forEach((row, i) => {
    const field = row[0];
    if (field === null || String(field).trim() === "") return;
    try {
      const value = toJson(row[1] ?? null, row[2] ?? null);
      entries.push([parsePathLabel(String(field)), value]);
      // The first list item's row carries the tag for the whole list path.
      const tag = readFixedCell(row[3] ?? null, value);
      const id = genericPathId(String(field));
      if (tag && id && !(id in fixed)) fixed[id] = tag;
    } catch (e) {
      warnings.push(`${label} row ${i + 2}: ${(e as Error).message}`);
    }
  });
  const value = entries.length ? unflatten(entries) : {};
  return value === null || typeof value !== "object" ? {} : value;
}

export function parseWorkbook(sheets: Sheet[]): ImportedWorkbook {
  const find = (prefix: string, fallback: number) =>
    sheets.find((s) => s.name.toLowerCase().startsWith(prefix.toLowerCase())) ?? sheets[fallback];

  const mappingSheet = find("Mappings", 1);
  const primarySheet = find("Primary", 2);
  const targetSheet = find("Target", 3);
  if (!mappingSheet || !primarySheet || !targetSheet) {
    throw new Error(
      "This workbook isn't in the Object Mapper format. Expected sheets named Mappings, Primary (…) and Target (…).",
    );
  }

  // Which side is primary: the Mappings header, then the Primary sheet name.
  const primary: Side = sideIn(mappingSheet.rows[0]?.[1] ?? null) ?? sideIn(primarySheet.name) ?? "left";
  const secondary = other(primary);
  const warnings: string[] = [];

  const fixed: Record<Side, FixedValues> = { left: {}, right: {} };
  const data = {
    [primary]: readFlatSheet(primarySheet, primarySheet.name, warnings, fixed[primary]),
    [secondary]: readFlatSheet(targetSheet, targetSheet.name, warnings, fixed[secondary]),
  } as Record<Side, Json>;

  // Header fields are valid mapping ends too (on sides whose format has headers).
  const formats = readFormats(sheets, warnings);
  const headerTags: Record<Side, FixedValues> = { left: {}, right: {} };
  const headers = readHeaders(sheets, warnings, headerTags);
  const fieldsOf = (side: Side) =>
    allPaths(lookupTree(data[side], supportsHeaders(formats[side].format) ? headers[side] : undefined) ?? buildTree(data[side]));
  const valid = { left: fieldsOf("left"), right: fieldsOf("right") };
  const mappings: Omit<Mapping, "id">[] = [];
  const seenPairs = new Set<string>();

  mappingSheet.rows.slice(1).forEach((row, i) => {
    const [, from, to, , , join, constantCell, translationCell, dbCell, noteCell] = row;
    if (from === null && to === null) return;
    const where = `Mappings row ${i + 2}`;
    try {
      const toPath = (cell: Cell): Path =>
        parsePathLabel(String(cell ?? "")).map((seg) => {
          if (typeof seg === "number") throw new Error(`use [] instead of [${seg}] in mapping paths`);
          return seg;
        });
      const isConstant = String(from ?? "").trim() === CONSTANT_SOURCE;
      const src = isConstant ? newConstPath() : toPath(from);
      const dst = toPath(to);
      if (!src.length || !dst.length) throw new Error("source and target are both required");
      if (!isConstant && !valid[primary].has(pathId(src))) throw new Error(`"${pathLabel(src)}" isn't a field in ${primarySheet.name}`);
      if (!valid[secondary].has(pathId(dst))) throw new Error(`"${pathLabel(dst)}" isn't a field in ${targetSheet.name}`);
      const pair = pathId(src) + pathId(dst);
      if (seenPairs.has(pair)) throw new Error(`"${pathLabel(src)}" -> "${pathLabel(dst)}" is listed twice; kept the first`);
      seenPairs.add(pair);
      // Several rows with the same target are combined; "Join with" sets the separator.
      const sep = join === null || join === undefined || join === "" ? {} : { join: String(join) };
      let db: DbRef | undefined;
      if (isConstant && dbCell !== null && dbCell !== undefined && String(dbCell).trim()) {
        db = parseDbRef(String(dbCell));
      }
      const constant = isConstant ? { constant: (constantCell ?? "") as Json, ...(db ? { db } : {}) } : {};
      let translate = {};
      if (translationCell !== null && translationCell !== undefined && String(translationCell).trim()) {
        try {
          const t = JSON.parse(String(translationCell)) as Translation;
          if (!Array.isArray(t.pairs)) throw new Error("no pairs");
          translate = { translate: t };
        } catch {
          warnings.push(`${where}: the Translation column couldn't be read, so it was left out`);
        }
      }
      const note = noteCell !== null && noteCell !== undefined && String(noteCell).trim() ? { note: String(noteCell) } : {};
      const extra = { ...sep, ...constant, ...translate, ...note };
      mappings.push(primary === "left" ? { left: src, right: dst, ...extra } : { left: dst, right: src, ...extra });
    } catch (e) {
      warnings.push(`${where}: ${(e as Error).message}`);
    }
  });

  for (const m of mappings) {
    const target = pathId(m[secondary]);
    const group = mappings.filter((o) => pathId(o[secondary]) === target);
    const join = group.find((o) => o.join !== undefined)?.join;
    if (group.length > 1 && join !== undefined) group.forEach((o) => (o.join = join));
    else if (group.length === 1) delete m.join;
  }
  // Header tags live on the Headers sheet.
  for (const side of ["left", "right"] as const) Object.assign(fixed[side], headerTags[side]);
  const document = readDocument(sheets);
  const names = { [primary]: document.get("primary name"), [secondary]: document.get("target name") } as Record<Side, string>;
  return { primary, data, mappings, formats, headers, fixed, docName: document.name, names, warnings };
}

/** Header name/value pairs per side; a workbook without a Headers sheet has none. */
function readHeaders(
  sheets: Sheet[],
  warnings: string[],
  tags: Record<Side, FixedValues> = { left: {}, right: {} },
): Record<Side, Headers> {
  const headers: Record<Side, Headers> = { left: {}, right: {} };
  const sheet = sheets.find((s) => s.name.toLowerCase().startsWith("headers"));
  if (!sheet) return headers;
  sheet.rows.slice(1).forEach((row, i) => {
    const side = String(row[0] ?? "").trim().toLowerCase();
    const name = String(row[1] ?? "").trim();
    if (!name) return;
    if (side !== "left" && side !== "right") {
      warnings.push(`Headers row ${i + 2}: "${row[0]}" isn't left or right.`);
      return;
    }
    headers[side][name] = toJson(row[2] ?? null, row[3] ?? null);
    const tag = readFixedCell(row[4] ?? null, headers[side][name]);
    if (tag) tags[side][pathId([HEADERS_SEGMENT, name])] = tag;
  });
  return headers;
}

/** Each side's file format; a workbook without a Formats sheet is all JSON. */
function readFormats(sheets: Sheet[], warnings: string[]): SideFormats {
  const formats: SideFormats = {
    left: { format: "json", layout: defaultFlatLayout() },
    right: { format: "json", layout: defaultFlatLayout() },
  };
  const sheet = sheets.find((s) => s.name.toLowerCase().startsWith("formats"));
  if (!sheet) return formats;
  for (const row of sheet.rows.slice(1)) {
    const side = String(row[0] ?? "").trim().toLowerCase();
    const format = String(row[1] ?? "").trim().toLowerCase();
    if (side !== "left" && side !== "right") continue;
    if (!FORMATS.some((f) => f.id === format)) {
      warnings.push(`Formats: "${row[1]}" isn't a known format; using JSON for the ${side} side.`);
      continue;
    }
    let layout = defaultFlatLayout();
    if (format === "flat" && row[2]) {
      try {
        layout = { ...layout, ...(JSON.parse(String(row[2])) as Partial<FlatLayout>) };
      } catch {
        warnings.push(`Formats: the ${side} flat layout couldn't be read; using the default layout.`);
      }
    }
    formats[side] = { format: format as Format, layout };
  }
  return formats;
}

// ---------- Document sheet (both modes) ----------

export type WorkbookMode = "single" | "multi";

/** Name | value rows: the document name and which kind of workbook this is. */
export function documentSheet(name: string, mode: WorkbookMode, extra: Cell[][] = []): Sheet {
  return {
    name: "Document",
    rows: [
      ["Property", "Value"],
      ["Name", name],
      ["Mode", mode === "multi" ? "multi-source" : "single pair"],
      ...extra,
    ],
  };
}

export function readDocument(sheets: Sheet[]): { name: string; mode: WorkbookMode; get: (key: string) => string } {
  const sheet = sheets.find((x) => x.name.toLowerCase() === "document");
  const get = (key: string) => String(sheet?.rows.find((r) => String(r[0] ?? "").toLowerCase() === key)?.[1] ?? "").trim();
  const mode: WorkbookMode =
    /multi/i.test(get("mode")) || sheets.some((x) => x.name.toLowerCase() === "sources") ? "multi" : "single";
  return { name: get("name"), mode, get };
}
