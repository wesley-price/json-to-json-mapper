// Merged multi-source mode: every source feeds the same standard object at once
// (e.g. customer, order and payment records combined into one JSON document).
// Sources run in order, each through its first matching case; a later source
// only overwrites a field when it actually has a value for it. The hand-off
// rules (unmapped fields, missing values, types) are applied once at the end.

import { type FlatLayout, type Format, defaultFlatLayout, writeFormat } from "./formats";
import { type Headers, applyWithHeaders, lookupTree, supportsHeaders, valuesAtPath } from "./headers";
import { type Json, type Path, type Side, joinsFor, pathId, pathLabel } from "./json-tree";
import { type MappingCase, pickCase } from "./multi";
import { type FieldDecisions, type Spec, applyRules } from "./spec";
import { type FixedValues, engineInputs, isConstPath } from "./transforms";

export type CombineMode = "each" | "merge";

export interface MergeSide {
  data: Json | null;
  format?: Format;
  layout?: FlatLayout;
  headers?: Headers;
  fixed?: FixedValues;
  decisions?: FieldDecisions;
  text?: string;
}

export interface MergeResult {
  body: Json;
  headers: Headers;
  /** The merged object written in the standard's format. */
  text: string;
  /** Which case each source used (or why it was skipped). */
  used: { name: string; caseName?: string; error?: string }[];
  /** Standard field -> the sources that feed it (in order). */
  feeds: { field: string; sources: string[] }[];
  /** Fields fed by more than one source with a value: the last one wins. */
  conflicts: { field: string; sources: string[]; winner: string }[];
}

const headersOf = (side: MergeSide) => (supportsHeaders(side.format ?? "json") ? side.headers : undefined);

export function mergeSources(
  standard: MergeSide,
  sources: { name: string; side: MergeSide; cases: MappingCase[] }[],
  /** The standard's side (mappings are stored by side). */
  primary: Side,
  spec: Spec,
): MergeResult | null {
  if (standard.data === null) return null;
  const secondary: Side = primary === "left" ? "right" : "left";
  let current: { body: Json; headers: Headers } = { body: standard.data, headers: headersOf(standard) ?? {} };
  const allInputs: { from: Path; to: Path; source: { body: Json; headers: Headers | undefined; fixed?: FixedValues } }[] = [];
  const used: MergeResult["used"] = [];
  const fed = new Map<string, { label: string; sources: string[]; withValue: string[] }>();

  for (const src of sources) {
    const body = src.side.data;
    if (body === null) {
      used.push({ name: src.name, error: "No sample loaded." });
      continue;
    }
    const headers = headersOf(src.side);
    const kase = pickCase(src.cases, body, headers);
    if (!kase) {
      used.push({ name: src.name, error: "No case matches its sample." });
      continue;
    }
    used.push({ name: src.name, caseName: kase.name });
    const { inputs, constants } = engineInputs(kase.mappings, secondary, primary, src.side.fixed, standard.fixed);
    // A source only writes the fields it has values for, so earlier sources' values survive its gaps.
    const present = inputs.filter(
      (m) => isConstPath(m.from) || valuesAtPath(body, headers, m.from).some((v) => v !== null && v !== undefined),
    );
    current = applyWithHeaders({ body, headers }, current, present, joinsFor(kase.mappings, primary), constants);
    for (const m of inputs) {
      const id = pathId(m.to);
      const entry = fed.get(id) ?? { label: pathLabel(m.to), sources: [], withValue: [] };
      if (!entry.sources.includes(src.name)) entry.sources.push(src.name);
      if (present.includes(m) && !entry.withValue.includes(src.name)) entry.withValue.push(src.name);
      fed.set(id, entry);
      allInputs.push({ ...m, source: { body, headers, fixed: src.side.fixed } });
    }
  }

  const out = applyRules(current, {
    targetTree: lookupTree(standard.data, headersOf(standard)),
    mappings: allInputs,
    source: { body: null, headers: undefined },
    targetFixed: standard.fixed,
    decisions: standard.decisions,
    spec,
  });
  const feeds = [...fed.values()].map((f) => ({ field: f.label, sources: f.sources }));
  const conflicts = [...fed.values()]
    .filter((f) => f.withValue.length > 1)
    .map((f) => ({ field: f.label, sources: f.withValue, winner: f.withValue[f.withValue.length - 1] }));
  return {
    body: out.body,
    headers: out.headers,
    text: writeFormat(standard.format ?? "json", out.body, standard.layout ?? defaultFlatLayout(), standard.text),
    used,
    feeds,
    conflicts,
  };
}
