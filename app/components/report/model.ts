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
  applyMappings,
  buildTree,
  findNode,
  isPrefix,
  DEFAULT_JOIN,
  joinsFor,
  pathId,
  pathLabel,
  valuesAt,
} from "@/lib/json-tree";
import type { DiagramLink } from "./MappingDiagram";

export const STORAGE_KEY = "object-mapper:v1";
const COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"];

interface SavedSide {
  data: Json | null;
  format?: Format;
  layout?: FlatLayout;
}
export interface Saved {
  sides: Record<Side, SavedSide>;
  primary: Side;
  mappings: Mapping[];
}

export interface ReportMapping {
  id: string;
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
function notesFor(from: Path, to: Path, fromType?: string, toType?: string, sourceCount = 0): string[] {
  const notes: string[] = [];
  if (fromType && toType && fromType !== toType) {
    notes.push(`Type changes from ${fromType} to ${toType}; the value is copied as-is.`);
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
  const srcTree = buildTree(src.data);
  const dstTree = buildTree(dst.data);
  const joins = joinsFor(saved.mappings ?? [], secondary);

  const pairs = (saved.mappings ?? []).map((m, i) => ({
    id: m.id,
    from: m[primary],
    to: m[secondary],
    color: COLORS[i % COLORS.length],
  }));
  const result = applyMappings(
    src.data,
    dst.data,
    pairs.map((m) => ({ from: m.from, to: m.to })),
    joins,
  );

  // Group by target, in order of first appearance; each group is one numbered entry.
  const groups = new Map<string, typeof pairs>();
  for (const p of pairs) {
    const id = pathId(p.to);
    groups.set(id, [...(groups.get(id) ?? []), p]);
  }

  const entries: ReportEntry[] = [];
  let n = 0;
  for (const [targetId, group] of groups) {
    n++;
    const to = group[0].to;
    const toType = findNode(dstTree, to)?.type;
    const written = valuesAt(result, to);
    const combined = group.length > 1;
    const parts: ReportMapping[] = group.map((p) => {
      const fromType = findNode(srcTree, p.from)?.type;
      const sourceValues = valuesAt(src.data!, p.from);
      return {
        ...p,
        n,
        fromLabel: pathLabel(p.from),
        toLabel: pathLabel(to),
        fromType,
        toType,
        sourceValues,
        written,
        // Combined values are always text, so per-part type notes would be noise.
        notes: combined ? [] : notesFor(p.from, to, fromType, toType, sourceValues.length),
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
          notes: combinedNotes(parts, to, written),
        },
      });
    }
  }
  const singles = entries.flatMap((e) => (e.kind === "single" ? [e.item] : []));
  const combinedFields = entries.flatMap((e) => (e.kind === "combined" ? [e.item] : []));

  // A target field is covered when it, or an object/list containing it, is mapped.
  const targetLeaves = leafPaths(dstTree);
  const covered = (p: Path) => pairs.some((m) => isPrefix(m.to, p));
  const links: DiagramLink[] = pairs.map((m) => ({ from: pathId(m.from), to: pathId(m.to), color: m.color }));

  return {
    // Only computed in the browser (the workspace lives in localStorage), so "now" is when the report is viewed.
    generated: new Date(),
    primary,
    secondary,
    src: { data: src.data, tree: srcTree, format: srcFormat },
    dst: { data: dst.data, tree: dstTree, format: dstFormat },
    sourceTitle: `Source · ${formatInfo(srcFormat).label}`,
    targetTitle: `Target · ${formatInfo(dstFormat).label}`,
    links,
    /** Number of individual source → target links. */
    linkCount: pairs.length,
    entries,
    singles,
    combined: combinedFields,
    result,
    resultText: writeFormat(dstFormat, result, dstLayout),
    unmapped: targetLeaves.filter((p) => !covered(p)).map(pathLabel),
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
