// The reference implementation for a saved document (single pair, sources one
// at a time, or merged sources), built from the same saved state the report uses.

import { type ImplDoc, type ImplMapping, type Implementation, generateImplementation } from "@/lib/codegen";
import type { Format } from "@/lib/formats";
import { type Headers, supportsHeaders } from "@/lib/headers";
import type { Json, Mapping, Side } from "@/lib/json-tree";
import type { MappingCase } from "@/lib/multi";
import { type FieldDecisions, type FieldQuestions, type Spec, normalizeSpec } from "@/lib/spec";
import { type FixedValues, isConstPath } from "@/lib/transforms";

interface SavedSide {
  name?: string;
  data: Json | null;
  format?: Format;
  headers?: Headers;
  fixed?: FixedValues;
  decisions?: FieldDecisions;
  questions?: FieldQuestions;
}
interface SavedDoc {
  sides: Record<Side, SavedSide>;
  primary: Side;
  mappings: Mapping[];
  docName?: string;
  spec?: Partial<Spec>;
  multi?: {
    enabled: boolean;
    combine?: "each" | "merge";
    activeSource: string;
    sources: { id: string; name: string; side: SavedSide; cases: MappingCase[]; activeCase: string }[];
  };
}

const implMapping = (m: Mapping, from: Side, to: Side): ImplMapping => ({
  ...(isConstPath(m[from]) ? { constant: m.constant ?? "", ...(m.db ? { db: m.db } : {}) } : { from: m[from] }),
  to: m[to],
  ...(m.join !== undefined ? { join: m.join } : {}),
  ...(m.translate ? { translate: m.translate } : {}),
  ...(m.steps?.length ? { steps: m.steps } : {}),
  ...(m.note ? { note: m.note } : {}),
});

export function implementationFor(saved: SavedDoc, title: string): Implementation | null {
  const spec = normalizeSpec(saved.spec);
  const primary = saved.primary ?? "left";
  const secondary: Side = primary === "left" ? "right" : "left";
  const headersOf = (s: SavedSide) => (supportsHeaders(s.format ?? "json") ? (s.headers ?? {}) : undefined);

  if (saved.multi?.enabled) {
    const std = saved.sides[primary];
    if (!std?.data) return null;
    // The source on screen lives in the editable side + mappings; fold it back in.
    const sources = saved.multi.sources.map((src) =>
      src.id !== saved.multi!.activeSource
        ? src
        : { ...src, side: saved.sides[secondary], cases: src.cases.map((c) => (c.id === src.activeCase ? { ...c, mappings: saved.mappings } : c)) },
    );
    const doc: ImplDoc = {
      title,
      version: spec.version.trim(),
      mode: saved.multi.combine === "merge" ? "merge" : "each",
      template: { body: std.data, headers: headersOf(std) },
      targetFixed: std.fixed,
      decisions: std.decisions,
      questions: std.questions,
      spec,
      sources: sources.map((s) => ({
        name: s.name,
        fixed: s.side?.fixed,
        cases: s.cases.map((c) => ({ name: c.name, when: c.when, mappings: c.mappings.map((m) => implMapping(m, secondary, primary)) })),
      })),
    };
    return generateImplementation(doc);
  }

  const src = saved.sides?.[primary];
  const dst = saved.sides?.[secondary];
  if (!src?.data || !dst?.data) return null;
  return generateImplementation({
    title,
    version: spec.version.trim(),
    mode: "single",
    template: { body: dst.data, headers: headersOf(dst) },
    targetFixed: dst.fixed,
    decisions: dst.decisions,
    questions: dst.questions,
    spec,
    sources: [
      {
        name: src.name?.trim() || "Source",
        fixed: src.fixed,
        cases: [{ name: "All", when: [], mappings: (saved.mappings ?? []).map((m) => implMapping(m, primary, secondary)) }],
      },
    ],
  });
}
