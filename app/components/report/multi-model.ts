// Everything the multi-source report shows: the standard object, the coverage
// matrix, and for each source its cases (conditions, mappings, diagram links)
// plus its sample run through the matching case. Used by the report page and
// the PDF so they always agree.

import { type FlatLayout, type Format, defaultFlatLayout, formatInfo, writeFormat } from "@/lib/formats";
import { HEADERS, type Headers, applyWithHeaders, lookupTree, supportsHeaders } from "@/lib/headers";
import {
  type FieldNode,
  type Json,
  type Mapping,
  type Path,
  type Side,
  buildTree,
  isPrefix,
  joinsFor,
  pathId,
  pathLabel,
} from "@/lib/json-tree";
import { type Condition, type MappingCase, describeConditions, pickCase } from "@/lib/multi";
import { type FixedValues, describeDb, describeFixed, describeTranslation, engineInputs, isConstPath, sourceLabel } from "@/lib/transforms";
import type { DiagramLink } from "./MappingDiagram";

const COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"];

interface SavedSide {
  name?: string;
  data: Json | null;
  format?: Format;
  layout?: FlatLayout;
  headers?: Headers;
  fixed?: FixedValues;
}
interface SavedSource {
  id: string;
  name: string;
  side: SavedSide;
  cases: MappingCase[];
  activeCase: string;
}
export interface SavedMulti {
  sides: Record<Side, SavedSide>;
  primary: Side;
  mappings: Mapping[];
  docName?: string;
  multi?: { enabled: boolean; sources: SavedSource[]; activeSource: string };
}

export interface MultiReportMapping {
  n: number;
  from: Path;
  to: Path;
  fromLabel: string;
  toLabel: string;
  color: string;
  constant?: Json;
  db?: { table: string; column: string };
  notes: string[];
}

export interface MultiReportCase {
  /** Unique id, used to find the case's diagram. */
  id: string;
  n: number;
  name: string;
  when: Condition[];
  conditions: string;
  /** Whether the source's sample is handled by this case (the first match). */
  usedBySample: boolean;
  mappings: MultiReportMapping[];
  links: DiagramLink[];
}

export interface MultiReportSource {
  n: number;
  name: string;
  format: Format;
  tree: FieldNode;
  cases: MultiReportCase[];
  /** The sample run through its matching case. */
  test: { caseName: string; text: string } | { error: string };
}

export type MultiReportModel = NonNullable<ReturnType<typeof buildMultiReport>>;

const activeHeaders = (side: SavedSide) => (supportsHeaders(side.format ?? "json") ? side.headers : undefined);
const treeOf = (side: SavedSide) =>
  lookupTree(side.data, activeHeaders(side)) ?? buildTree(side.data ?? {});

function leafPaths(node: FieldNode, out: Path[] = []): Path[] {
  for (const child of node.children) {
    if (child.children.length === 0) out.push(child.path);
    else leafPaths(child, out);
  }
  return out;
}

export function buildMultiReport(saved: SavedMulti | null) {
  if (!saved?.multi?.enabled) return null;
  const primary = saved.primary ?? "left";
  const secondary: Side = primary === "left" ? "right" : "left";
  const standardSide = saved.sides?.[primary];
  if (!standardSide?.data) return null;

  // The source on screen lives in the editable side + mappings; fold it back in.
  const sources = saved.multi.sources.map((src) =>
    src.id !== saved.multi!.activeSource
      ? src
      : {
          ...src,
          side: saved.sides[secondary],
          cases: src.cases.map((c) => (c.id === src.activeCase ? { ...c, mappings: saved.mappings } : c)),
        },
  );

  const stdFormat = standardSide.format ?? "json";
  const stdTree = treeOf(standardSide);
  const stdFields = leafPaths(stdTree).filter((p) => !(p.length === 1 && p[0] === HEADERS));

  let colorIndex = 0;
  const reportSources: MultiReportSource[] = sources.map((src, si) => {
    const side = src.side ?? { data: null };
    const tree = treeOf(side);
    const body = side.data;
    const headers = activeHeaders(side);
    const firstMatch = body === null ? null : pickCase(src.cases, body, headers);

    const cases: MultiReportCase[] = src.cases.map((c, ci) => {
      const groups = new Map<string, Mapping[]>();
      for (const m of c.mappings) groups.set(pathId(m[primary]), [...(groups.get(pathId(m[primary])) ?? []), m]);
      const mappings: MultiReportMapping[] = c.mappings.map((m, mi) => {
        const from = m[secondary];
        const isConst = isConstPath(from);
        const group = groups.get(pathId(m[primary])) ?? [];
        const tag = side.fixed?.[pathId(from)];
        const notes = [
          ...(isConst ? [m.db ? `Comes from the ${describeDb(m.db)}.` : "A fixed value (constant)."] : []),
          ...(tag ? [`Source field tagged as a constant: ${describeFixed(tag)}.`] : []),
          ...(m.translate ? [`Values translated: ${describeTranslation(m.translate)}.`] : []),
          ...(group.length > 1
            ? [
                `Part ${group.indexOf(m) + 1} of ${group.length}, joined with ${JSON.stringify(group.find((g) => g.join !== undefined)?.join ?? " ")}.`,
              ]
            : []),
        ];
        return {
          n: mi + 1,
          from,
          to: m[primary],
          fromLabel: sourceLabel(m, secondary),
          toLabel: pathLabel(m[primary]),
          color: COLORS[colorIndex++ % COLORS.length],
          ...(isConst ? { constant: m.constant ?? "", ...(m.db ? { db: m.db } : {}) } : {}),
          notes,
        };
      });
      return {
        id: `case:${si}:${ci}`,
        n: ci + 1,
        name: c.name,
        when: c.when,
        conditions: describeConditions(c.when, pathLabel),
        usedBySample: firstMatch?.id === c.id,
        mappings,
        links: mappings.map((m) => ({ from: pathId(m.from), to: pathId(m.to), color: m.color })),
      };
    });

    let test: MultiReportSource["test"];
    if (body === null) test = { error: "No sample loaded." };
    else if (!firstMatch) test = { error: "No case matches the sample." };
    else {
      const { inputs, constants } = engineInputs(firstMatch.mappings, secondary, primary, side.fixed, standardSide.fixed);
      const out = applyWithHeaders(
        { body, headers },
        { body: standardSide.data!, headers: activeHeaders(standardSide) },
        inputs,
        joinsFor(firstMatch.mappings, primary),
        constants,
      );
      test = { caseName: firstMatch.name, text: writeFormat(stdFormat, out.body, standardSide.layout ?? defaultFlatLayout()) };
    }

    return { n: si + 1, name: src.name, format: side.format ?? "json", tree, cases, test };
  });

  // Coverage: which source field feeds each standard field (per case where they differ).
  const coverage = stdFields.map((path) => ({
    path,
    label: pathLabel(path),
    cells: sources.map((src) => {
      const perCase = src.cases.map((c) => ({
        caseName: c.name,
        fields: c.mappings.filter((m) => isPrefix(m[primary], path)).map((m) => sourceLabel(m, secondary)),
      }));
      const mapped = perCase.filter((c) => c.fields.length > 0);
      if (mapped.length === 0) return { text: "—", gap: true };
      const same = mapped.length === perCase.length && mapped.every((c) => c.fields.join() === mapped[0].fields.join());
      return {
        text: same ? mapped[0].fields.join(" + ") : perCase.map((c) => `${c.caseName}: ${c.fields.join(" + ") || "—"}`).join("; "),
        gap: false,
      };
    }),
  }));

  return {
    generated: new Date(),
    docName: (saved.docName ?? "").trim(),
    standard: {
      tree: stdTree,
      format: stdFormat,
      name: standardSide.name?.trim() || "Standard",
      title: `${standardSide.name?.trim() || "Standard"} · ${formatInfo(stdFormat).label}`,
      fieldCount: stdFields.length,
    },
    sources: reportSources,
    coverage,
    gapCount: coverage.reduce((n, r) => n + r.cells.filter((c) => c.gap).length, 0),
    caseCount: reportSources.reduce((n, s) => n + s.cases.length, 0),
    mappingCount: reportSources.reduce((n, s) => n + s.cases.reduce((k, c) => k + c.mappings.length, 0), 0),
  };
}

