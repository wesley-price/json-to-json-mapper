// Everything the multi-source report shows: the standard object, the coverage
// matrix, and for each source its cases (conditions, mappings, diagram links)
// plus its sample run through the matching case. Used by the report page and
// the PDF so they always agree.

import { type FlatLayout, type Format, defaultFlatLayout, formatInfo, schemaTypes, writeFormat } from "@/lib/formats";
import { HEADERS, type Headers, applyWithHeaders, lookupTree, supportsHeaders } from "@/lib/headers";
import {
  type FieldNode,
  type Json,
  type Mapping,
  type Path,
  type Side,
  buildTree,
  flatten,
  isPrefix,
  joinsFor,
  pathId,
  pathLabel, rowPath } from "@/lib/json-tree";
import { type Condition, type MappingCase, type SourceExample, applyExample, describeConditions, describeExample, pickCase } from "@/lib/multi";
import { type FixedValues, describeDb, describeFixed, describeTranslation, engineInputs, isConstPath, sourceLabel } from "@/lib/transforms";
import { type FieldDecisions, type FieldQuestions, type Spec, UNMAPPED_OPTIONS, UNMAPPED_SHORT, applyRules, normalizeSpec } from "@/lib/spec";
import type { DiagramLink } from "./MappingDiagram";
import { type TestCase, type TestCaseDraft, numberCases, someHeaders } from "./test-cases";
import { mergeSources } from "@/lib/merge";
import { dbConstantsOf, readinessOf } from "@/lib/readiness";
import { describeSteps } from "@/lib/steps";
import { describeJoin } from "./model";
import { unmappedFields } from "@/lib/spec";

const COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"];

interface SavedSide {
  name?: string;
  text?: string;
  data: Json | null;
  format?: Format;
  layout?: FlatLayout;
  headers?: Headers;
  fixed?: FixedValues;
  moreValues?: Record<string, Json[]>;
  decisions?: FieldDecisions;
  questions?: FieldQuestions;
}
interface SavedSource {
  id: string;
  name: string;
  side: SavedSide;
  cases: MappingCase[];
  activeCase: string;
  examples?: SourceExample[];
}
export interface SavedMulti {
  sides: Record<Side, SavedSide>;
  primary: Side;
  mappings: Mapping[];
  docName?: string;
  spec?: Partial<Spec>;
  multi?: { enabled: boolean; sources: SavedSource[]; activeSource: string; combine?: "each" | "merge" };
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
  /** The implementer note for this case ("" when none). */
  note: string;
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
  test: MultiReportTest;
  /** More messages of the same object (values that differ from the sample), each run through its case. */
  examples: { name: string; changes: string; test: MultiReportTest }[];
  /** More values a field can carry, each with the case it lands in. */
  moreValues: { field: string; value: string; caseName: string; sameCase: boolean }[];
  /** This source's test cases (numbered across the report in testCases). */
  drafts: TestCaseDraft[];
}

export type MultiReportTest = { caseName: string; text: string; out: { body: Json; headers: Headers } } | { error: string };

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
  const spec = normalizeSpec(saved.spec);
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
  const stdSchema = schemaTypes(standardSide.format ?? "json", standardSide.text);

  let colorIndex = 0;
  const reportSources: MultiReportSource[] = sources.map((src, si) => {
    const side = src.side ?? { data: null };
    const tree = treeOf(side);
    const body = side.data;
    const headers = activeHeaders(side);
    const firstMatch = body === null ? null : pickCase(src.cases, body, headers);
    const srcSchema = schemaTypes(side.format ?? "json", side.text);

    const cases: MultiReportCase[] = src.cases.map((c, ci) => {
      const groups = new Map<string, Mapping[]>();
      for (const m of c.mappings) groups.set(pathId(m[primary]), [...(groups.get(pathId(m[primary])) ?? []), m]);
      const mappings: MultiReportMapping[] = c.mappings.map((m, mi) => {
        const from = m[secondary];
        const isConst = isConstPath(from);
        const group = groups.get(pathId(m[primary])) ?? [];
        const tag = side.fixed?.[pathId(from)];
        const fromSchema = isConst ? undefined : srcSchema.get(pathId(from));
        const toSchema = stdSchema.get(pathId(m[primary]));
        const notes = [
          ...(fromSchema || toSchema ? [`Schema types: ${fromSchema ?? "?"} → ${toSchema ?? "?"}.`] : []),
          ...(isConst ? [m.db ? `Comes from the ${describeDb(m.db)}.` : "A fixed value (constant)."] : []),
          ...(tag ? [`Source field tagged as a constant: ${describeFixed(tag)}.`] : []),
          ...(m.steps?.length ? [`Transformed: ${describeSteps(m.steps)}.`] : []),
          ...(m.translate ? [`Values translated: ${describeTranslation(m.translate)}.`] : []),
          ...(m.note?.trim() ? [`Note: ${m.note.trim()}`] : []),
          ...(group.length > 1
            ? [
                `Part ${group.indexOf(m) + 1} of ${group.length}, combined as ${describeJoin(group.find((g) => g.join !== undefined)?.join ?? " ")}.`,
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
        note: c.note?.trim() ?? "",
        usedBySample: firstMatch?.id === c.id,
        mappings,
        links: mappings.map((m) => ({ from: pathId(rowPath(m.from)), to: pathId(m.to), color: m.color })),
      };
    });

    /** A message run through the first case that matches it. */
    const run = (msgBody: Json, msgHeaders: Headers | undefined): MultiReportTest => {
      const kase = pickCase(src.cases, msgBody, msgHeaders);
      if (!kase) return { error: "No case matches this message." };
      const { inputs, constants } = engineInputs(kase.mappings, secondary, primary, side.fixed, standardSide.fixed);
      // The hand-off rules (unmapped fields, missing values, types) apply to the sample results too.
      const out = applyRules(
        applyWithHeaders(
          { body: msgBody, headers: msgHeaders },
          { body: standardSide.data!, headers: activeHeaders(standardSide) },
          inputs,
          joinsFor(kase.mappings, primary),
          constants,
        ),
        {
          targetTree: treeOf(standardSide),
          mappings: inputs,
          source: { body: msgBody, headers: msgHeaders },
          sourceFixed: side.fixed,
          targetFixed: standardSide.fixed,
          decisions: standardSide.decisions,
          spec,
        },
      );
      return { caseName: kase.name, text: writeFormat(stdFormat, out.body, standardSide.layout ?? defaultFlatLayout(), standardSide.text), out };
    };
    // Every message of this source becomes a test case: input -> expected output.
    const drafts: TestCaseDraft[] = [];
    const sampleTitle = `${src.name} · sample`;
    let sampleOut: Record<string, Json> | null = null;
    /** Output fields that differ from the sample's output. */
    const outputChanges = (r: MultiReportTest) => {
      if ("error" in r || !sampleOut) return [];
      const now = flatten(r.out.body);
      const keys = new Set([...Object.keys(sampleOut), ...Object.keys(now)]);
      return [...keys]
        .filter((k) => JSON.stringify(now[k]) !== JSON.stringify(sampleOut![k]))
        .map((k) => ({ field: k, value: k in now ? JSON.stringify(now[k]) : "(left out)" }));
    };
    const addCase = (title: string, msgBody: Json, msgHeaders: Headers | undefined, r: MultiReportTest, changes?: string) =>
      drafts.push({
        ...(changes !== undefined ? { variant: { of: sampleTitle, inputChanges: changes, outputChanges: outputChanges(r) } } : {}),
        title: `${src.name} · ${title}`,
        source: src.name,
        input: { body: msgBody, headers: someHeaders(msgHeaders), text: writeFormat(side.format ?? "json", msgBody, side.layout ?? defaultFlatLayout(), side.text) },
        ...("error" in r
          ? { error: r.error }
          : {
              caseName: r.caseName,
              expected: { body: r.out.body, headers: supportsHeaders(stdFormat) ? someHeaders(r.out.headers) : undefined, text: r.text },
            }),
      });
    const test: MultiReportTest = body === null ? { error: "No sample loaded." } : run(body, headers);
    if (body !== null) {
      addCase("sample", body, headers, test);
      if (!("error" in test)) sampleOut = flatten(test.out.body);
    }
    const examples =
      body === null
        ? []
        : (src.examples ?? []).map((ex) => {
            const msg = applyExample(body, headers, ex.values);
            const r = run(msg.body, msg.headers);
            addCase(`example "${ex.name}"`, msg.body, msg.headers, r, describeExample(ex.values, pathLabel));
            return { name: ex.name, changes: describeExample(ex.values, pathLabel), test: r };
          });

    const moreValues =
      body === null
        ? []
        : Object.entries(side.moreValues ?? {}).flatMap(([id, values]) =>
            values.map((value) => {
              const msg = applyExample(body, headers, { [id]: value });
              const r = run(msg.body, msg.headers);
              addCase(`${pathLabel(JSON.parse(id) as Path)} = ${JSON.stringify(value)}`, msg.body, msg.headers, r, `${pathLabel(JSON.parse(id) as Path)} = ${JSON.stringify(value)}`);
              return {
                field: pathLabel(JSON.parse(id) as Path),
                value: JSON.stringify(value),
                caseName: "error" in r ? r.error : r.caseName,
                sameCase: "caseName" in r && "caseName" in test && r.caseName === test.caseName,
              };
            }),
          );

    return { n: si + 1, name: src.name, format: side.format ?? "json", tree, cases, test, examples, moreValues, drafts };
  });

  // Coverage: which source field feeds each standard field (per case where they differ).
  const stdFixed = standardSide.fixed ?? {};
  // Merged mode: all sources fill one object together.
  const merge = saved.multi.combine === "merge";
  const merged = merge
    ? mergeSources(
        standardSide,
        sources.map((s) => ({ name: s.name, side: s.side ?? { data: null }, cases: s.cases })),
        primary,
        spec,
      )
    : null;
  if (merged) {
    const inputs = sources.filter((s) => s.side?.data != null);
    reportSources[0]?.drafts.unshift({
      title: "All sources merged into one",
      input: {
        // Each source as { body, headers } (the generated mapAll takes the same shape).
        body: Object.fromEntries(
          inputs.map((s) => [s.name, { body: s.side.data as Json, ...(activeHeaders(s.side) ? { headers: activeHeaders(s.side) as Json } : {}) }]),
        ),
        text: inputs
          .map((s) => `-- ${s.name} --\n${writeFormat(s.side.format ?? "json", s.side.data as Json, s.side.layout ?? defaultFlatLayout(), s.side.text)}`)
          .join("\n"),
      },
      expected: { body: merged.body, headers: supportsHeaders(stdFormat) ? someHeaders(merged.headers) : undefined, text: merged.text },
    });
  }

  const coverage = stdFields.map((path) => ({
    path,
    label: pathLabel(path),
    cells: sources.map((src) => {
      // A standard field tagged as a constant is the same for every source.
      const tag = stdFixed[pathId(path)];
      if (tag) return { text: `constant ${describeFixed(tag)}`, gap: false };
      const perCase = src.cases.map((c) => ({
        caseName: c.name,
        fields: c.mappings.filter((m) => isPrefix(m[primary], path)).map((m) => sourceLabel(m, secondary)),
      }));
      const mapped = perCase.filter((c) => c.fields.length > 0);
      if (mapped.length === 0) {
        // No mapping: say what the field gets (its decision, or the document rule).
        const decided = standardSide.decisions?.[pathId(path)];
        const gets = UNMAPPED_OPTIONS.find((o) => o.id === (decided ?? spec.unmapped))!;
        const short = UNMAPPED_SHORT[gets.id];
        // Merged: only a gap when no source at all feeds the field.
        const fedElsewhere =
          merge && sources.some((o) => o.cases.some((c) => c.mappings.some((m) => isPrefix(m[primary], path))));
        if (fedElsewhere) return { text: "— (another source)", gap: false };
        return { text: `— (${short}${decided ? "" : ", by rule"})`, gap: !decided || gets.id === "ask" };
      }
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
    /** Standard fields tagged as constants: the same value whatever the source. */
    spec,
    /** "merge": all sources fill one object together (see merged). */
    combine: (merge ? "merge" : "each") as "merge" | "each",
    merged,
    /** Unmapped standard fields marked "ask a subject-matter expert", with their questions. */
    openQuestions: stdFields
      .filter((p) => !(pathId(p) in stdFixed) && (standardSide.decisions?.[pathId(p)] ?? spec.unmapped) === "ask")
      .filter((p) => reportSources.every((s) => s.cases.every((c) => !c.mappings.some((m) => isPrefix(m.to, p)))))
      .map((p) => ({ field: pathLabel(p), question: standardSide.questions?.[pathId(p)]?.trim() ?? "" })),
    /** Is it ready to build? (the report's first page) */
    readiness: readinessOf({
      targetFieldCount: stdFields.length,
      // Fields no source maps at all (a field one source maps is covered when merging; per source otherwise, see coverage).
      unmapped: unmappedFields(
        stdTree,
        sources.flatMap((s) => s.cases.flatMap((c) => c.mappings.map((m) => m[primary]))),
        standardSide.fixed,
        standardSide.decisions,
        spec,
        standardSide.questions,
      ),
      dbConstants: dbConstantsOf(
        sources.flatMap((s) => s.cases.flatMap((c) => c.mappings)),
        primary,
        [standardSide.fixed, ...sources.map((s) => s.side?.fixed)],
      ),
      conflicts: merged ? merged.conflicts : undefined,
      noCase: reportSources.filter((s) => "error" in s.test && /no case/i.test(s.test.error)).map((s) => s.name),
      coverageGaps: merge ? undefined : coverage.flatMap((row) => row.cells.flatMap((c, i) => (c.gap ? [`${sources[i].name}: ${row.label}`] : []))),
      spec,
    }),
    /** Every message as an input with its expected output. */
    testCases: numberCases(reportSources.flatMap((s) => s.drafts)) as TestCase[],
    standardConstants: Object.entries(stdFixed).map(([id, tag]) => ({ label: pathLabel(JSON.parse(id) as Path), text: describeFixed(tag) })),
    gapCount: coverage.reduce((n, r) => n + r.cells.filter((c) => c.gap).length, 0),
    caseCount: reportSources.reduce((n, s) => n + s.cases.length, 0),
    mappingCount: reportSources.reduce((n, s) => n + s.cases.reduce((k, c) => k + c.mappings.length, 0), 0),
  };
}

