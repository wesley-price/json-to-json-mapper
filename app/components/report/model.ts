// Everything the mapping report shows, computed once from the saved workspace.
// Both the on-screen/printable report and the downloadable PDF use this, so
// they always say the same thing.

import { type FlatLayout, type Format, defaultFlatLayout, formatInfo, writeFormat } from "@/lib/formats";
import {
  ARRAY_ITEM,
  type FieldNode,
  type FieldType,
  type Json,
  type Mapping,
  type Path,
  type Side,
  buildTree,
  findNode,
  typeOf,
  isPrefix,
  DEFAULT_JOIN,
  joinsFor,
  pathId,
  pathLabel,
} from "@/lib/json-tree";
import type { DiagramLink } from "./MappingDiagram";
import {
  CONST,
  type DbRef,
  type FixedValues,
  type Translation,
  constantValue,
  describeDb,
  describeTranslation,
  engineInputs,
  isConstPath,
  sourceLabel,
} from "@/lib/transforms";
import { type Headers, applyWithHeaders, headersText, lookupTree, supportsHeaders, valuesAtPath } from "@/lib/headers";
import { type FieldDecisions, type FieldQuestions, type Spec, UNMAPPED_OPTIONS, applyRules, normalizeSpec, unmappedFields } from "@/lib/spec";
import { type TestCase, numberCases, someHeaders } from "./test-cases";

export const STORAGE_KEY = "object-mapper:v1";
const COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"];

interface SavedSide {
  name?: string;
  data: Json | null;
  format?: Format;
  layout?: FlatLayout;
  headers?: Headers;
  fixed?: FixedValues;
  decisions?: FieldDecisions;
  questions?: FieldQuestions;
}
export interface Saved {
  sides: Record<Side, SavedSide>;
  primary: Side;
  mappings: Mapping[];
  spec?: Partial<Spec>;
}

/** What an unmapped target field gets, in words. */
export const unmappedGets = (id: string) => UNMAPPED_OPTIONS.find((o) => o.id === id)?.rule ?? id;

export interface ReportMapping {
  id: string;
  /** Set for a constant mapping (a fixed value instead of a source field). */
  constant?: Json;
  /** Set when that constant comes from a database table/column. */
  db?: DbRef;
  translate?: Translation;
  n: number;
  from: Path;
  to: Path;
  fromLabel: string;
  toLabel: string;
  color: string;
  fromType?: FieldType;
  toType?: FieldType;
  /** Example values read from the source, and the values written to the target. */
  sourceValues: Json[];
  written: Json[];
  notes: string[];
}

export type ReportModel = NonNullable<ReturnType<typeof buildReport>>;

const other = (side: Side): Side => (side === "left" ? "right" : "left");
const depthOf = (p: Path) => p.filter((s) => s === ARRAY_ITEM).length;

/** A short, readable list of values: `"X1", "Y2" … (+3)`. */
export function showValues(values: Json[], max = 3): string {
  if (values.length === 0) return "—";
  const shown = values.slice(0, max).map((v) => JSON.stringify(v)).join(", ");
  return values.length > max ? `${shown} … (+${values.length - max})` : shown;
}

/** Every leaf field (no children) of a tree, for the "unmapped fields" list. */
function leafPaths(node: FieldNode, out: Path[] = []): Path[] {
  for (const child of node.children) {
    if (child.children.length === 0) out.push(child.path);
    else leafPaths(child, out);
  }
  return out;
}

/** Plain-language notes about how a mapping behaves. */
function notesFor(from: Path, to: Path, fromType?: string, toType?: string, sourceCount = 0, convert = false): string[] {
  const notes: string[] = [];
  if (fromType && toType && fromType !== toType) {
    notes.push(
      convert
        ? `Type changes from ${fromType} to ${toType}; the value is converted to ${toType}.`
        : `Type changes from ${fromType} to ${toType}; the value is copied as-is.`,
    );
  }
  const df = depthOf(from);
  const dt = depthOf(to);
  if (dt > df) notes.push("A single value copied into every item of the target list.");
  else if (df > 0 && dt === df) {
    notes.push(`One value per list item (${sourceCount} item${sourceCount === 1 ? "" : "s"} in the source).`);
  } else if (df > dt) notes.push("A list mapped onto a single field: the last item's value is used.");
  return notes;
}

/** Several sources joined into one target field. */
export interface ReportCombined {
  /** Unique id (used to find its diagram). */
  id: string;
  n: number;
  to: Path;
  toLabel: string;
  toType?: FieldType;
  /** The parts, in join order. */
  parts: ReportMapping[];
  join: string;
  /** Values written to the target. */
  written: Json[];
  notes: string[];
}

/** One numbered entry of the report: a single mapping or a combined field. */
export type ReportEntry = { kind: "single"; item: ReportMapping } | { kind: "combined"; item: ReportCombined };

/** How a combined field behaves with lists. */
function combinedNotes(parts: ReportMapping[], to: Path, written: Json[]): string[] {
  const deepest = Math.max(...parts.map((p) => depthOf(p.from)));
  const notes: string[] = [];
  if (depthOf(to) > 0 && deepest > 0) {
    notes.push(`Joined separately for each list item (${written.length} item${written.length === 1 ? "" : "s"}).`);
    const shared = parts.filter((p) => depthOf(p.from) < deepest).map((p) => p.fromLabel);
    if (shared.length) notes.push(`${shared.join(", ")} ${shared.length === 1 ? "is" : "are"} repeated in every item.`);
  } else if (depthOf(to) > deepest) {
    notes.push("The joined value is copied into every item of the target list.");
  } else if (deepest > depthOf(to)) {
    notes.push("A list feeds a single field: the last item's values are used.");
  }
  notes.push("Empty parts are skipped, so no extra separators appear.");
  return notes;
}

export function buildReport(saved: Saved | null) {
  if (!saved) return null;
  const primary = saved.primary ?? "left";
  const secondary = other(primary);
  const src = saved.sides?.[primary];
  const dst = saved.sides?.[secondary];
  if (!src?.data || !dst?.data) return null;
  const srcFormat = src.format ?? "json";
  const dstFormat = dst.format ?? "json";
  const dstLayout = dst.layout ?? defaultFlatLayout();
  // Header fields (JSON/XML) are part of each side's tree, ahead of the body.
  const srcHeaders = supportsHeaders(srcFormat) ? src.headers : undefined;
  const dstHeaders = supportsHeaders(dstFormat) ? dst.headers : undefined;
  const srcTree = lookupTree(src.data, srcHeaders) ?? buildTree(src.data);
  const dstTree = lookupTree(dst.data, dstHeaders) ?? buildTree(dst.data);
  const joins = joinsFor(saved.mappings ?? [], secondary);

  const pairs = (saved.mappings ?? []).map((m, i) => ({
    id: m.id,
    from: m[primary],
    to: m[secondary],
    color: COLORS[i % COLORS.length],
    mapping: m,
  }));
  const { inputs, constants } = engineInputs(saved.mappings ?? [], primary, secondary, src.fixed, dst.fixed);
  const spec = normalizeSpec(saved.spec);
  // The hand-off rules (unmapped fields, missing values, types) apply to the sample result too.
  const mapped = applyRules(
    applyWithHeaders({ body: src.data, headers: srcHeaders }, { body: dst.data, headers: dstHeaders }, inputs, joins, constants),
    {
      targetTree: lookupTree(dst.data, dstHeaders),
      mappings: inputs,
      source: { body: src.data, headers: srcHeaders },
      sourceFixed: src.fixed,
      targetFixed: dst.fixed,
      decisions: dst.decisions,
      spec,
    },
  );
  const targetTags = dst.fixed ?? {};
  const result = mapped.body;
  const resultHeaders = dstHeaders ? mapped.headers : undefined;

  // Group by target, in order of first appearance; each group is one numbered entry.
  const groups = new Map<string, typeof pairs>();
  for (const p of pairs) {
    const id = pathId(p.to);
    if (id in targetTags) continue; // tagged targets always get their constant (listed below)
    groups.set(id, [...(groups.get(id) ?? []), p]);
  }

  const entries: ReportEntry[] = [];
  let n = 0;
  for (const [targetId, group] of groups) {
    n++;
    const to = group[0].to;
    const toType = findNode(dstTree, to)?.type;
    const written = valuesAtPath(result, resultHeaders, to);
    const combined = group.length > 1;
    const parts: ReportMapping[] = group.map(({ mapping, ...p }) => {
      const isConst = isConstPath(p.from);
      const fromType = isConst ? typeOf(mapping.constant ?? "") : findNode(srcTree, p.from)?.type;
      const sourceValues = isConst ? [constantValue(mapping.constant, mapping.db)] : valuesAtPath(src.data!, srcHeaders, p.from);
      const extraNotes = [
        ...(isConst
          ? [
              mapping.db
                ? `Comes from the ${describeDb(mapping.db)} (constant).`
                : "A fixed value (constant), not read from the source.",
            ]
          : []),
        ...(mapping.translate ? [`Values translated: ${describeTranslation(mapping.translate)}.`] : []),
        ...(mapping.note?.trim() ? [`Note: ${mapping.note.trim()}`] : []),
      ];
      return {
        ...p,
        n,
        ...(isConst ? { constant: mapping.constant ?? "", ...(mapping.db ? { db: mapping.db } : {}) } : {}),
        ...(mapping.translate ? { translate: mapping.translate } : {}),
        fromLabel: sourceLabel(mapping, primary),
        toLabel: pathLabel(to),
        fromType,
        toType,
        sourceValues,
        written,
        // Combined values are always text, so per-part type notes would be noise.
        notes: combined ? extraNotes : [...extraNotes, ...(isConst ? [] : notesFor(p.from, to, fromType, toType, sourceValues.length, spec.coerce === "convert"))],
      };
    });
    if (!combined) {
      entries.push({ kind: "single", item: parts[0] });
    } else {
      entries.push({
        kind: "combined",
        item: {
          id: `combined:${targetId}`,
          n,
          to,
          toLabel: pathLabel(to),
          toType,
          parts,
          join: joins.get(targetId) ?? DEFAULT_JOIN,
          written,
          notes: [...combinedNotes(parts, to, written), ...parts.flatMap((p) => p.notes.map((n) => `${p.fromLabel}: ${n}`))],
        },
      });
    }
  }
  // Fields tagged as constants on the target: each is its own entry.
  for (const [key, tag] of Object.entries(targetTags)) {
    n++;
    const to = JSON.parse(key) as Path;
    const value = constantValue(tag.value, tag.db);
    entries.push({
      kind: "single",
      item: {
        id: `tag:${key}`,
        n,
        from: [CONST, `dst:${key}`],
        to,
        color: COLORS[(pairs.length + n) % COLORS.length],
        constant: tag.value,
        ...(tag.db ? { db: tag.db } : {}),
        fromLabel: tag.db ? `${describeDb(tag.db)} (constant)` : `${JSON.stringify(tag.value)} (constant)`,
        toLabel: pathLabel(to),
        fromType: typeOf(value),
        toType: findNode(dstTree, to)?.type,
        sourceValues: [value],
        written: valuesAtPath(result, resultHeaders, to),
        notes: [
          tag.db
            ? `Tagged as a constant on the target; comes from the ${describeDb(tag.db)}.`
            : "Tagged as a constant on the target: always this value.",
        ],
      },
    });
  }
  const singles = entries.flatMap((e) => (e.kind === "single" ? [e.item] : []));
  const combinedFields = entries.flatMap((e) => (e.kind === "combined" ? [e.item] : []));

  // A target field is covered when it, or an object/list containing it, is mapped.
  const targetLeaves = leafPaths(dstTree);
  const covered = (p: Path) => pairs.some((m) => isPrefix(m.to, p));
  const links: DiagramLink[] = [
    ...pairs.filter((m) => !(pathId(m.to) in targetTags)).map((m) => ({ from: pathId(m.from), to: pathId(m.to), color: m.color })),
    ...singles.filter((m) => m.id.startsWith("tag:")).map((m) => ({ from: pathId(m.from), to: pathId(m.to), color: m.color })),
  ];

  return {
    // Only computed in the browser (the workspace lives in localStorage), so "now" is when the report is viewed.
    generated: new Date(),
    primary,
    secondary,
    src: { data: src.data, tree: srcTree, format: srcFormat },
    dst: { data: dst.data, tree: dstTree, format: dstFormat },
    // Object names (when set) replace "Source" / "Target".
    sourceName: src.name?.trim() || "Source",
    targetName: dst.name?.trim() || "Target",
    sourceTitle: `${src.name?.trim() || "Source"} · ${formatInfo(srcFormat).label}`,
    targetTitle: `${dst.name?.trim() || "Target"} · ${formatInfo(dstFormat).label}`,
    links,
    /** Number of individual source → target links. */
    linkCount: pairs.length,
    entries,
    singles,
    combined: combinedFields,
    result,
    resultText: writeFormat(dstFormat, result, dstLayout),
    /** The target's headers after mapping as "name: value" lines (empty when none). */
    resultHeadersText: resultHeaders && Object.keys(resultHeaders).length ? headersText(resultHeaders) : "",
    /** Target fields no mapping writes, with what each gets (its decision or the document rule). */
    unmapped: unmappedFields(
      lookupTree(dst.data, dstHeaders),
      (saved.mappings ?? []).map((m) => m[secondary]),
      dst.fixed,
      dst.decisions,
      spec,
      dst.questions,
    ).map((f) => ({
      label: f.label,
      gets: unmappedGets(f.effective) + (f.question ? ` — question: ${f.question}` : ""),
      decided: !!f.decision,
      ask: f.effective === "ask",
      question: f.question ?? "",
    })),
    spec,
    /** The sample as an input with its expected output. */
    testCases: numberCases([
      {
        title: `${src.name?.trim() || "Source"} sample`,
        input: { body: src.data, headers: someHeaders(srcHeaders), text: writeFormat(srcFormat, src.data, src.layout ?? defaultFlatLayout()) },
        expected: { body: result, headers: someHeaders(resultHeaders), text: writeFormat(dstFormat, result, dstLayout) },
      },
    ]) as TestCase[],
    targetLeafCount: targetLeaves.length,
    mappedLeafCount: targetLeaves.filter(covered).length,
  };
}

/** Separator shown in words: " " -> "a space". */
export function describeJoin(join: string): string {
  if (join === "") return "nothing";
  if (join === " ") return "a space";
  return JSON.stringify(join);
}
