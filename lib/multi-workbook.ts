// Excel export/import for multi-source mode: one standard object fed by
// several sources, each with cases (conditions + mappings).
//
// Sheets (export order; import finds them by name):
//   Document   Property | Value         name, mode, the standard's format/layout
//   Coverage   Standard field | <source>…  (export only)
//   Results    Source | Case used | Standard field | Value  (export only: each sample, normalised)
//   Standard   Field | Value | Type | Constant
//   Sources    # | Name | Format | Flat layout (JSON)
//   S1 <name>, S2 <name>…   Field | Value | Type | Constant  (one sheet per source sample)
//   Headers    Object | Header | Value | Type | Constant      (Object = "Standard" or S1, S2…)
//   Cases      Source # | Case # | Case name | Conditions | Conditions (JSON)   (check order)
//   Mappings   Source # | Case # | Source field | Standard field | Source type | Standard type
//              | Join with | Constant value | Translation | Constant from database
//   Values     Object | Field | Value | Type   (more values a source field can carry; Object = S1, S2…)
//   Examples   Source # | Example # | Example name | Field | Value | Type
//              (more messages of a source: only the values that differ from its sample)

import { type FlatLayout, type Format, FORMATS, defaultFlatLayout } from "./formats";
import { type Headers, HEADERS, lookupTree, supportsHeaders } from "./headers";
import { type Json, type Path, allPaths, buildTree, findNode, flatten, parsePathLabel, pathId, pathLabel } from "./json-tree";
import { type Condition, describeConditions } from "./multi";
import { type DbRef, type FixedValues, type Translation, formatDbRef, isConstPath, newConstPath, parseDbRef } from "./transforms";
import { fixedCell, flatRow, flatSheet, readFixedCell, readFlatSheet, toJson } from "./workbook";
import type { Cell, Sheet } from "./xlsx";

const CONSTANT_SOURCE = "(constant)";

export interface MultiDocSide {
  /** What the object is called (the standard's name; sources use their own name). */
  name?: string;
  data: Json;
  format: Format;
  layout: FlatLayout;
  headers: Headers;
  fixed: FixedValues;
  /** More values a field can carry (pathId -> values), e.g. other messages for the same error. */
  moreValues?: Record<string, Json[]>;
}

/** A mapping from a source field (or constant) into a standard field. */
export interface MultiDocMapping {
  from: Path;
  to: Path;
  join?: string;
  constant?: Json;
  db?: DbRef;
  translate?: Translation;
  note?: string;
}

export interface MultiDoc {
  docName: string;
  standard: MultiDocSide;
  sources: {
    name: string;
    side: MultiDocSide;
    cases: { name: string; when: Condition[]; mappings: MultiDocMapping[]; note?: string }[];
    /** More messages of the same object: only the values that differ from the sample. */
    examples?: MultiDocExample[];
  }[];
}

export interface MultiDocExample {
  name: string;
  values: { path: Path; value: Json }[];
}

/** Optional extras computed by the app (they are not read back on import). */
export interface MultiExtras {
  /** Standard field label -> one cell text per source. */
  coverage?: { field: string; cells: string[] }[];
  /** Each source's sample run through its matching case. */
  results?: { name: string; caseName?: string; body?: Json | null; error?: string }[];
}

const sourceSheetName = (n: number, name: string) => `S${n}${name.trim() ? ` ${name.trim()}` : ""}`;
const objectLabel = (n: number) => `S${n}`;

const fieldsOf = (side: MultiDocSide) =>
  lookupTree(side.data, supportsHeaders(side.format) ? side.headers : undefined) ?? buildTree(side.data);

const layoutCell = (side: MultiDocSide) => (side.format === "flat" ? JSON.stringify(side.layout) : "");

function readLayout(cell: Cell, warnings: string[], where: string): FlatLayout {
  const layout = defaultFlatLayout();
  if (!cell) return layout;
  try {
    return { ...layout, ...(JSON.parse(String(cell)) as Partial<FlatLayout>) };
  } catch {
    warnings.push(`${where}: the flat layout couldn't be read; using the default layout.`);
    return layout;
  }
}

const readFormat = (cell: Cell): Format => {
  const f = String(cell ?? "").trim().toLowerCase();
  return (FORMATS.some((x) => x.id === f) ? f : "json") as Format;
};

// ---------- Export ----------

export function buildMultiWorkbook(doc: MultiDoc, extras: MultiExtras = {}): Sheet[] {
  const stdTree = fieldsOf(doc.standard);
  const sheets: Sheet[] = [];

  sheets.push({
    name: "Document",
    rows: [
      ["Property", "Value"],
      ["Name", doc.docName],
      ["Mode", "multi-source"],
      ["Standard name", doc.standard.name ?? ""],
      ["Standard format", doc.standard.format],
      ["Standard flat layout", layoutCell(doc.standard)],
      ["Sources", doc.sources.length],
    ],
  });

  if (extras.coverage) {
    sheets.push({
      name: "Coverage",
      rows: [[`${doc.standard.name?.trim() || "Standard"} field`, ...doc.sources.map((s) => s.name)], ...extras.coverage.map((r) => [r.field, ...r.cells])],
    });
  }
  if (extras.results) {
    sheets.push({
      name: "Results",
      rows: [
        ["Source", "Case used", "Standard field", "Value"],
        ...extras.results.flatMap((r): Cell[][] => {
          if (r.error || r.body === undefined || r.body === null) return [[r.name, "", "", r.error ?? "No result"]];
          return Object.entries(flatten(r.body)).map(([field, v]): Cell[] => [r.name, r.caseName ?? "", field, flatRow(field, v)[1]]);
        }),
      ],
    });
  }

  sheets.push(flatSheet("Standard", doc.standard.data, doc.standard.fixed));
  sheets.push({
    name: "Sources",
    rows: [
      ["#", "Name", "Format", "Flat layout (JSON)"],
      ...doc.sources.map((s, i): Cell[] => [i + 1, s.name, s.side.format, layoutCell(s.side)]),
    ],
  });
  doc.sources.forEach((s, i) => sheets.push(flatSheet(sourceSheetName(i + 1, s.name), s.side.data, s.side.fixed)));

  const headerRows = (object: string, side: MultiDocSide): Cell[][] =>
    Object.entries(side.headers ?? {}).map(([name, value]) => {
      const [, cell, type] = flatRow(name, value);
      return [object, name, cell, type, fixedCell(side.fixed?.[pathId([HEADERS, name])], value)];
    });
  sheets.push({
    name: "Headers",
    rows: [
      ["Object", "Header", "Value", "Type", "Constant"],
      ...headerRows("Standard", doc.standard),
      ...doc.sources.flatMap((s, i) => headerRows(objectLabel(i + 1), s.side)),
    ],
  });

  sheets.push({
    name: "Cases",
    rows: [
      ["Source #", "Case #", "Case name", "Conditions", "Conditions (JSON)", "Notes"],
      ...doc.sources.flatMap((s, i) =>
        s.cases.map((c, j): Cell[] => [i + 1, j + 1, c.name, describeConditions(c.when, pathLabel), JSON.stringify(c.when), c.note ?? ""]),
      ),
    ],
  });

  if (doc.sources.some((src) => Object.keys(src.side.moreValues ?? {}).length)) {
    sheets.push({
      name: "Values",
      rows: [
        ["Object", "Field", "Value", "Type"],
        ...doc.sources.flatMap((src, i) =>
          Object.entries(src.side.moreValues ?? {}).flatMap(([id, values]) =>
            values.map((v): Cell[] => [objectLabel(i + 1), ...flatRow(pathLabel(JSON.parse(id) as Path), v)]),
          ),
        ),
      ],
    });
  }

  if (doc.sources.some((src) => src.examples?.length)) {
    sheets.push({
      name: "Examples",
      rows: [
        ["Source #", "Example #", "Example name", "Field", "Value", "Type"],
        ...doc.sources.flatMap((src, i) =>
          (src.examples ?? []).flatMap((ex, j): Cell[][] =>
            ex.values.length
              ? ex.values.map((v) => [i + 1, j + 1, ex.name, ...flatRow(pathLabel(v.path), v.value)])
              : [[i + 1, j + 1, ex.name, "", "", ""]],
          ),
        ),
      ],
    });
  }

  sheets.push({
    name: "Mappings",
    rows: [
      [
        "Source #",
        "Case #",
        "Source field",
        "Standard field",
        "Source type",
        "Standard type",
        "Join with",
        "Constant value",
        "Translation",
        "Constant from database",
        "Notes",
      ],
      ...doc.sources.flatMap((s, i) => {
        const srcTree = fieldsOf(s.side);
        return s.cases.flatMap((c, j) =>
          c.mappings.map((m): Cell[] => {
            const isConst = isConstPath(m.from);
            const combined = c.mappings.filter((o) => pathId(o.to) === pathId(m.to)).length > 1;
            return [
              i + 1,
              j + 1,
              isConst ? CONSTANT_SOURCE : pathLabel(m.from),
              pathLabel(m.to),
              isConst ? "" : (findNode(srcTree, m.from)?.type ?? ""),
              findNode(stdTree, m.to)?.type ?? "",
              combined ? (m.join ?? " ") : "",
              m.constant === undefined ? "" : typeof m.constant === "object" && m.constant !== null ? JSON.stringify(m.constant) : m.constant,
              m.translate ? JSON.stringify(m.translate) : "",
              m.db ? formatDbRef(m.db) : "",
              m.note ?? "",
            ];
          }),
        );
      }),
    ],
  });
  return sheets;
}

// ---------- Import ----------

export function parseMultiWorkbook(sheets: Sheet[]): { doc: MultiDoc; warnings: string[] } {
  const warnings: string[] = [];
  const byName = (name: string) => sheets.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const docSheet = byName("Document");
  const prop = (key: string) =>
    docSheet?.rows.find((r) => String(r[0] ?? "").trim().toLowerCase() === key.toLowerCase())?.[1] ?? null;

  const standardSheet = byName("Standard");
  const sourcesSheet = byName("Sources");
  if (!standardSheet || !sourcesSheet) {
    throw new Error("This isn't a multi-source workbook: it needs Standard and Sources sheets.");
  }

  // Headers first: they are fields that mappings can point at.
  const headerTags: Record<string, FixedValues> = {};
  const headers: Record<string, Headers> = {};
  (byName("Headers")?.rows.slice(1) ?? []).forEach((row) => {
    const object = String(row[0] ?? "").trim();
    const name = String(row[1] ?? "").trim();
    if (!object || !name) return;
    const value = toJson(row[2] ?? null, row[3] ?? null);
    (headers[object] ??= {})[name] = value;
    const tag = readFixedCell(row[4] ?? null, value);
    if (tag) (headerTags[object] ??= {})[pathId([HEADERS, name])] = tag;
  });

  const standardFixed: FixedValues = { ...(headerTags.Standard ?? {}) };
  const standard: MultiDocSide = {
    name: String(prop("Standard name") ?? "").trim(),
    data: readFlatSheet(standardSheet, "Standard", warnings, standardFixed),
    format: readFormat(prop("Standard format")),
    layout: readLayout(prop("Standard flat layout"), warnings, "Document"),
    headers: headers.Standard ?? {},
    fixed: standardFixed,
  };

  const sources: MultiDoc["sources"] = [];
  sourcesSheet.rows.slice(1).forEach((row, i) => {
    const n = Number(row[0]) || i + 1;
    const name = String(row[1] ?? "").trim() || `Source ${n}`;
    const sheet = sheets.find((x) => x.name === `S${n}` || x.name.startsWith(`S${n} `));
    if (!sheet) {
      warnings.push(`Sources row ${i + 2}: no sheet named S${n} for "${name}"; it was skipped.`);
      return;
    }
    const fixed: FixedValues = { ...(headerTags[objectLabel(n)] ?? {}) };
    const format = readFormat(row[2] ?? null);
    sources[n - 1] = {
      name,
      side: {
        data: readFlatSheet(sheet, sheet.name, warnings, fixed),
        format,
        layout: readLayout(row[3] ?? null, warnings, `Sources row ${i + 2}`),
        headers: headers[objectLabel(n)] ?? {},
        fixed,
      },
      cases: [],
    };
  });

  // Cases, in check order.
  (byName("Cases")?.rows.slice(1) ?? []).forEach((row, i) => {
    const src = sources[(Number(row[0]) || 0) - 1];
    if (!src) return;
    let when: Condition[] = [];
    try {
      const parsed = JSON.parse(String(row[4] ?? "[]"));
      if (Array.isArray(parsed)) when = parsed;
    } catch {
      warnings.push(`Cases row ${i + 2}: the conditions couldn't be read, so this case always matches.`);
    }
    const note = String(row[5] ?? "").trim();
    src.cases[(Number(row[1]) || src.cases.length + 1) - 1] = {
      name: String(row[2] ?? "").trim() || "Case",
      when,
      mappings: [],
      ...(note ? { note: String(row[5]) } : {}),
    };
  });
  for (const src of sources) {
    if (!src) continue;
    src.cases = src.cases.filter(Boolean);
    if (src.cases.length === 0) src.cases = [{ name: "All", when: [], mappings: [] }];
  }

  // Mappings.
  const stdFields = allPaths(fieldsOf(standard));
  const srcFields = sources.map((s) => (s ? allPaths(fieldsOf(s.side)) : new Set<string>()));
  const toPath = (cell: Cell): Path =>
    parsePathLabel(String(cell ?? "")).map((seg) => {
      if (typeof seg === "number") throw new Error(`use [] instead of [${seg}] in mapping paths`);
      return seg;
    });
  (byName("Mappings")?.rows.slice(1) ?? []).forEach((row, i) => {
    const [srcNo, caseNo, fromCell, toCell, , , join, constantCell, translationCell, dbCell, noteCell] = row;
    if (fromCell === null && toCell === null) return;
    const where = `Mappings row ${i + 2}`;
    try {
      const si = (Number(srcNo) || 0) - 1;
      const src = sources[si];
      if (!src) throw new Error(`there is no source #${srcNo}`);
      const kase = src.cases[(Number(caseNo) || 1) - 1];
      if (!kase) throw new Error(`source "${src.name}" has no case #${caseNo}`);
      const isConst = String(fromCell ?? "").trim() === CONSTANT_SOURCE;
      const from = isConst ? newConstPath() : toPath(fromCell);
      const to = toPath(toCell);
      if (!isConst && !srcFields[si].has(pathId(from))) throw new Error(`"${pathLabel(from)}" isn't a field of ${src.name}`);
      if (!stdFields.has(pathId(to))) throw new Error(`"${pathLabel(to)}" isn't a field of the standard`);
      const m: MultiDocMapping = { from, to };
      if (join !== null && join !== undefined && join !== "") m.join = String(join);
      if (isConst) m.constant = (constantCell ?? "") as Json;
      if (isConst && dbCell !== null && dbCell !== undefined && String(dbCell).trim()) {
        m.db = parseDbRef(String(dbCell));
      }
      if (translationCell !== null && translationCell !== undefined && String(translationCell).trim()) {
        try {
          m.translate = JSON.parse(String(translationCell)) as Translation;
        } catch {
          warnings.push(`${where}: the Translation column couldn't be read, so it was left out.`);
        }
      }
      if (noteCell !== null && noteCell !== undefined && String(noteCell).trim()) m.note = String(noteCell);
      kase.mappings.push(m);
    } catch (e) {
      warnings.push(`${where}: ${(e as Error).message}`);
    }
  });

  // More values per source field.
  (byName("Values")?.rows.slice(1) ?? []).forEach((row, i) => {
    const [objectCell, fieldCell, valueCell, typeCell] = row;
    const n = Number(/^S(\d+)$/i.exec(String(objectCell ?? "").trim())?.[1] ?? 0);
    const src = sources[n - 1];
    if (!src || fieldCell === null || String(fieldCell).trim() === "") return;
    try {
      const id = pathId(toPath(fieldCell));
      const more = (src.side.moreValues ??= {});
      (more[id] ??= []).push(toJson(valueCell ?? null, typeCell ?? null));
    } catch (e) {
      warnings.push(`Values row ${i + 2}: ${(e as Error).message}`);
    }
  });

  // Examples: rows grouped by source # and example #.
  (byName("Examples")?.rows.slice(1) ?? []).forEach((row, i) => {
    const [srcNo, exNo, nameCell, fieldCell, valueCell, typeCell] = row;
    const src = sources[(Number(srcNo) || 0) - 1];
    if (!src) return;
    const examples = (src.examples ??= []);
    const j = (Number(exNo) || examples.length + 1) - 1;
    const ex = (examples[j] ??= { name: String(nameCell ?? "").trim() || `Example ${j + 2}`, values: [] });
    if (fieldCell === null || String(fieldCell).trim() === "") return;
    try {
      ex.values.push({ path: toPath(fieldCell), value: toJson(valueCell ?? null, typeCell ?? null) });
    } catch (e) {
      warnings.push(`Examples row ${i + 2}: ${(e as Error).message}`);
    }
  });
  for (const src of sources) if (src?.examples) src.examples = src.examples.filter(Boolean);

  return {
    doc: { docName: String(prop("Name") ?? "").trim(), standard, sources: sources.filter(Boolean) },
    warnings,
  };
}
