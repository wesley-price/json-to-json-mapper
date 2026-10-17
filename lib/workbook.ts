// The Excel workbook format used for export/import. Both directions live here
// so they stay in sync.
//
// Sheets (matched by name prefix on import, falling back to position):
//   1. "Mapped Result"   Field | Value | Type   (export only; ignored on import)
//   2. "Mappings"        # | Source (<side>) | Target (<side>) | Source type | Target type
//   3. "Primary (<side>)" Field | Value | Type  (flattened primary object)
//   4. "Target (<side>)"  Field | Value | Type  (flattened editable object)

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
import type { Cell, Sheet } from "./xlsx";

const other = (side: Side): Side => (side === "left" ? "right" : "left");

/** One spreadsheet row for a flattened field; empty containers show as {} / []. */
function flatRow(field: string, value: Json): Cell[] {
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const cell: Cell = typeof value === "object" && value !== null ? JSON.stringify(value) : value;
  return [field, cell, type];
}

function flatSheet(name: string, data: Json | null): Sheet {
  return {
    name,
    rows: [
      ["Field", "Value", "Type"],
      ...(data === null ? [] : Object.entries(flatten(data)).map(([k, v]) => flatRow(k, v))),
    ],
  };
}

export function buildWorkbook(opts: {
  primary: Side;
  data: Record<Side, Json | null>;
  mappings: Mapping[];
  result: Json | null;
}): Sheet[] {
  const { primary, data, mappings, result } = opts;
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
    flatSheet("Mapped Result", result),
    {
      name: "Mappings",
      rows: [
        ["#", `Source (${primary})`, `Target (${secondary})`, "Source type", "Target type"],
        ...mappings.map((m, i): Cell[] => [
          i + 1,
          pathLabel(m[primary]),
          pathLabel(m[secondary]),
          typeAt(primary, m[primary]),
          typeAt(secondary, m[secondary]),
        ]),
      ],
    },
    flatSheet(`Primary (${primary})`, data[primary]),
    flatSheet(`Target (${secondary})`, data[secondary]),
  ];
}

// ---------- Import ----------

export interface ImportedWorkbook {
  primary: Side;
  data: Record<Side, Json>;
  mappings: Omit<Mapping, "id">[];
  /** Human-readable notes about anything that was skipped. */
  warnings: string[];
}

const sideIn = (text: Cell): Side | null => {
  const m = /\((left|right)\)/i.exec(String(text ?? ""));
  return m ? (m[1].toLowerCase() as Side) : null;
};

/** Turn a cell back into a JSON value, using the Type column when present. */
function toJson(value: Cell, type: Cell): Json {
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

function readFlatSheet(sheet: Sheet, label: string, warnings: string[]): Json {
  const entries: [(string | number)[], Json][] = [];
  sheet.rows.slice(1).forEach((row, i) => {
    const field = row[0];
    if (field === null || String(field).trim() === "") return;
    try {
      entries.push([parsePathLabel(String(field)), toJson(row[1] ?? null, row[2] ?? null)]);
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

  const data = {
    [primary]: readFlatSheet(primarySheet, primarySheet.name, warnings),
    [secondary]: readFlatSheet(targetSheet, targetSheet.name, warnings),
  } as Record<Side, Json>;

  const valid = { left: allPaths(buildTree(data.left)), right: allPaths(buildTree(data.right)) };
  const mappings: Omit<Mapping, "id">[] = [];
  const seenTargets = new Set<string>();

  mappingSheet.rows.slice(1).forEach((row, i) => {
    const [, from, to] = row;
    if (from === null && to === null) return;
    const where = `Mappings row ${i + 2}`;
    try {
      const toPath = (cell: Cell): Path =>
        parsePathLabel(String(cell ?? "")).map((seg) => {
          if (typeof seg === "number") throw new Error(`use [] instead of [${seg}] in mapping paths`);
          return seg;
        });
      const src = toPath(from);
      const dst = toPath(to);
      if (!src.length || !dst.length) throw new Error("source and target are both required");
      if (!valid[primary].has(pathId(src))) throw new Error(`"${pathLabel(src)}" isn't a field in ${primarySheet.name}`);
      if (!valid[secondary].has(pathId(dst))) throw new Error(`"${pathLabel(dst)}" isn't a field in ${targetSheet.name}`);
      if (seenTargets.has(pathId(dst))) throw new Error(`"${pathLabel(dst)}" is mapped more than once; kept the first`);
      seenTargets.add(pathId(dst));
      mappings.push(primary === "left" ? { left: src, right: dst } : { left: dst, right: src });
    } catch (e) {
      warnings.push(`${where}: ${(e as Error).message}`);
    }
  });

  return { primary, data, mappings, warnings };
}
