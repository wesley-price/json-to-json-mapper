// Constants and value translation for mappings.
//
// - A constant mapping writes a fixed value instead of reading a source field.
//   Its source path is [CONST, key] and the value lives on the mapping.
// - A translation table rewrites source values on the way through
//   (e.g. INSUFFICIENT_FUNDS -> PAY-001), with a rule for anything else.

import { type Json, type Mapping, type Path, pathLabel } from "./json-tree";
import { inferScalar } from "./formats/xml";

export const CONST = "$const";

// ---------- Where a constant comes from ----------
// A constant is either hardcoded (a typed value) or comes from a database
// table + column. The app can't query the database, so a database constant
// documents its origin and uses an optional sample value for previews.

export interface DbRef {
  table: string;
  column: string;
}

/** "{error_codes.code}" — shown in previews when a database constant has no sample value. */
export const dbPlaceholder = (d: DbRef) => `{${d.table.trim() || "table"}.${d.column.trim() || "column"}}`;

/** The value a constant contributes to results. */
export function constantValue(value: Json | undefined, db?: DbRef): Json {
  if (db) return value === undefined || value === null || value === "" ? dbPlaceholder(db) : value;
  return value ?? "";
}

/** "database error_codes.code" */
export const describeDb = (d: DbRef) => `database ${d.table.trim() || "?"}.${d.column.trim() || "?"}`;

export const isConstPath = (p: Path) => p[0] === CONST;

/** A fresh source path for a new constant mapping. */
export const newConstPath = (): Path => [CONST, Math.random().toString(36).slice(2, 8)];

export type Otherwise = "keep" | "default" | "empty";

export interface Translation {
  /** [source value, target value] */
  pairs: [string, string][];
  /** What happens to a value that isn't in the table. */
  otherwise: Otherwise;
  defaultValue: string;
}

export const emptyTranslation = (): Translation => ({ pairs: [], otherwise: "keep", defaultValue: "" });

const norm = (v: string) => v.trim().toLowerCase();
const asText = (v: Json) => (v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Translate one value. Matching ignores case and surrounding spaces; outputs become numbers/booleans when they look like them. */
export function translateValue(value: Json, t: Translation): Json {
  const hit = t.pairs.find(([from]) => from.trim() !== "" && norm(from) === norm(asText(value)));
  if (hit) return inferScalar(hit[1]);
  if (t.otherwise === "default") return inferScalar(t.defaultValue);
  if (t.otherwise === "empty") return "";
  return value;
}

/** The value transform for a mapping (its translation table), if it has one. */
export function transformOf(m: Mapping): ((v: Json) => Json) | undefined {
  const t = m.translate;
  if (!t || (t.pairs.length === 0 && t.otherwise === "keep")) return undefined;
  return (v) => translateValue(v, t);
}

/** Constant values by key, to read constant mappings from (see applyWithHeaders). */
export function constantsOf(mappings: Mapping[], sourceSide: "left" | "right"): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const m of mappings) {
    const p = m[sourceSide];
    if (isConstPath(p)) out[p[1]] = constantValue(m.constant, m.db);
  }
  return out;
}

/** How to show a mapping's source: the field path, or the constant value. */
export function sourceLabel(m: Mapping, sourceSide: "left" | "right"): string {
  const p = m[sourceSide];
  if (!isConstPath(p)) return pathLabel(p);
  return m.db ? `${describeDb(m.db)} (constant)` : `${JSON.stringify(m.constant ?? "")} (constant)`;
}

/** "INSUFFICIENT_FUNDS → PAY-001, … ; otherwise GEN-500" */
export function describeTranslation(t: Translation): string {
  const pairs = t.pairs.filter(([from]) => from.trim() !== "");
  const shown = pairs.slice(0, 4).map(([a, b]) => `${a} → ${b}`).join(", ");
  const more = pairs.length > 4 ? ` (+${pairs.length - 4} more)` : "";
  const otherwise =
    t.otherwise === "default" ? `otherwise ${JSON.stringify(t.defaultValue)}` : t.otherwise === "empty" ? "otherwise empty" : "otherwise unchanged";
  return `${shown || "no values listed"}${more}; ${otherwise}`;
}

// ---------- Tagged constants ----------
// Any field of the non-primary object can be tagged as a constant (pathId ->
// the value it was tagged with). On a target, the field always gets that value;
// on a source, mappings read that value instead of the incoming data.

/** A tagged constant: the value it was tagged with, or a database table + column. */
export interface Fixed {
  value: Json;
  db?: DbRef;
}
export type FixedValues = Record<string, Fixed>;

/** "📌 \"USD\"" / "📌 db currencies.code" */
export const describeFixed = (f: Fixed) => (f.db ? describeDb(f.db) : JSON.stringify(f.value));

/**
 * Engine inputs for a set of mappings, with constant mappings, translation
 * tables and tagged constants on either side applied.
 */
export function engineInputs(
  mappings: Mapping[],
  sourceSide: "left" | "right",
  targetSide: "left" | "right",
  sourceFixed: FixedValues = {},
  targetFixed: FixedValues = {},
): { inputs: { from: Path; to: Path; transform?: (v: Json) => Json }[]; constants: Record<string, Json> } {
  const constants = constantsOf(mappings, sourceSide);
  const inputs: { from: Path; to: Path; transform?: (v: Json) => Json }[] = mappings
    // A target tagged as a constant ignores mappings into it.
    .filter((m) => !(JSON.stringify(m[targetSide]) in targetFixed))
    .map((m) => {
      const from = m[sourceSide];
      const key = JSON.stringify(from);
      if (!isConstPath(from) && key in sourceFixed) {
        constants[`src:${key}`] = constantValue(sourceFixed[key].value, sourceFixed[key].db);
        return { from: [CONST, `src:${key}`], to: m[targetSide], transform: transformOf(m) };
      }
      return { from, to: m[targetSide], transform: transformOf(m) };
    });
  for (const [key, fixed] of Object.entries(targetFixed)) {
    constants[`dst:${key}`] = constantValue(fixed.value, fixed.db);
    inputs.push({ from: [CONST, `dst:${key}`], to: JSON.parse(key) as Path });
  }
  return { inputs, constants };
}
