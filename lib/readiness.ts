// "Is this ready to build?" — one checklist used by the app (the Readiness
// panel) and the report (its first page). Each item is ok, a warning, or a
// note, with the details a reader needs to act on it.

import { pathLabel, type Mapping, type Path } from "./json-tree";
import type { Spec, UnmappedField } from "./spec";
import { type DbRef, type FixedValues } from "./transforms";

export type ReadinessStatus = "ok" | "warn" | "info";

export interface ReadinessItem {
  id: string;
  status: ReadinessStatus;
  title: string;
  detail: string;
  /** Specific fields / sources involved (shown as a list). */
  items: string[];
}

export interface ReadinessInput {
  /** Leaf fields of the target / standard. */
  targetFieldCount: number;
  /** Target fields no mapping writes (merge-aware), with their decisions. */
  unmapped: UnmappedField[];
  /** Database constants (mappings and tags) and whether they say which row to read. */
  dbConstants: { label: string; db: DbRef }[];
  /** Merged sources: fields more than one source fills. */
  conflicts?: { field: string; sources: string[]; winner: string }[];
  /** Multi-source: sources whose sample no case matches. */
  noCase?: string[];
  /** One source at a time: "source: field" for standard fields a source doesn't fill (and that have no decision). */
  coverageGaps?: string[];
  /** The mapped result checked against the target's JSON Schema (absent: no schema). */
  schemaIssues?: string[];
  spec: Spec;
  /** Generated reference implementation checked against the test cases (when known). */
  implementation?: { passed: number; total: number; failed: string[] };
}

export function readinessOf(input: ReadinessInput): ReadinessItem[] {
  const out: ReadinessItem[] = [];
  const undecided = input.unmapped.filter((f) => !f.decision && f.effective !== "ask");
  const asks = input.unmapped.filter((f) => f.effective === "ask");
  const mapped = input.targetFieldCount - input.unmapped.length;

  out.push({
    id: "mapped",
    status: input.unmapped.length === 0 ? "ok" : "info",
    title: `${mapped} of ${input.targetFieldCount} target fields mapped`,
    detail:
      input.unmapped.length === 0
        ? "Every target field has a mapping or a constant."
        : `${input.unmapped.length} field${input.unmapped.length === 1 ? " has" : "s have"} no mapping; each gets its decision or the document rule.`,
    items: [],
  });
  out.push({
    id: "undecided",
    status: undecided.length ? "warn" : "ok",
    title: undecided.length ? `${undecided.length} unmapped field${undecided.length === 1 ? "" : "s"} without a decision` : "Every unmapped field has a decision",
    detail: undecided.length
      ? "These follow the document rule by default. Confirm that is intended, or decide each one (leave out, null, keep example, ask an expert)."
      : "",
    items: undecided.map((f) => f.label),
  });
  out.push({
    id: "questions",
    status: asks.length ? "warn" : "ok",
    title: asks.length ? `${asks.length} open question${asks.length === 1 ? "" : "s"} for a subject-matter expert` : "No open questions",
    detail: asks.length ? "Get these answered before the mapping is built." : "",
    items: asks.map((f) => (f.question ? `${f.label}: ${f.question}` : `${f.label}: (no question written yet)`)),
  });
  const noKey = input.dbConstants.filter((c) => !c.db.where?.trim());
  out.push({
    id: "dbkeys",
    status: noKey.length ? "warn" : "ok",
    title: noKey.length
      ? `${noKey.length} database constant${noKey.length === 1 ? "" : "s"} without a lookup key`
      : input.dbConstants.length
        ? "Every database constant says which row to read"
        : "No database constants",
    detail: noKey.length ? 'Say which row to read ("where code = errorCode"), or the value can\'t be fetched.' : "",
    items: noKey.map((c) => `${c.label} ← ${c.db.table}.${c.db.column}`),
  });
  if (input.noCase) {
    out.push({
      id: "nocase",
      status: input.noCase.length ? "warn" : "ok",
      title: input.noCase.length ? `${input.noCase.length} source${input.noCase.length === 1 ? "" : "s"} whose sample no case handles` : "Every source sample matches a case",
      detail: input.noCase.length ? "Add an \"otherwise\" case (no conditions), or fix the conditions." : "",
      items: input.noCase,
    });
  }
  if (input.coverageGaps) {
    out.push({
      id: "gaps",
      status: input.coverageGaps.length ? "warn" : "ok",
      title: input.coverageGaps.length
        ? `${input.coverageGaps.length} coverage gap${input.coverageGaps.length === 1 ? "" : "s"}: fields a source doesn't fill`
        : "Every source fills every standard field (or it has a decision)",
      detail: input.coverageGaps.length
        ? "Each source maps on its own, so each needs every field. Map these, or decide what the field gets (they follow the document rule until then)."
        : "",
      items: input.coverageGaps,
    });
  }
  if (input.conflicts) {
    out.push({
      id: "conflicts",
      status: input.conflicts.length ? "info" : "ok",
      title: input.conflicts.length ? `${input.conflicts.length} field${input.conflicts.length === 1 ? "" : "s"} filled by more than one source` : "No merge conflicts",
      detail: input.conflicts.length ? "The last source with a value wins. Check that order is intended (reorder the source tabs to change it)." : "",
      items: input.conflicts.map((c) => `${c.field}: ${c.sources.join(", ")} → ${c.winner}`),
    });
  }
  if (input.schemaIssues) {
    out.push({
      id: "schema",
      status: input.schemaIssues.length ? "warn" : "ok",
      title: input.schemaIssues.length
        ? `The result breaks the target's schema in ${input.schemaIssues.length} place${input.schemaIssues.length === 1 ? "" : "s"}`
        : "The result is valid against the target's schema",
      detail: input.schemaIssues.length ? "Fix the mappings (or their transformations) so the output passes; the Mapped result tab lists each problem." : "",
      items: input.schemaIssues,
    });
  }
  const missingSpec = (["version", "author", "purpose"] as const).filter((k) => !input.spec[k].trim());
  out.push({
    id: "spec",
    status: missingSpec.length ? "info" : "ok",
    title: missingSpec.length ? `Spec details missing: ${missingSpec.join(", ")}` : "Version, author and purpose are filled in",
    detail: missingSpec.length ? "Add them in Spec & rules so readers know which version they hold and who to ask." : "",
    items: [],
  });
  if (input.implementation) out.push(implementationItem(input.implementation));
  return out;
}

/** The reference implementation checked against the test cases. */
export function implementationItem({ passed, total, failed }: { passed: number; total: number; failed: string[] }): ReadinessItem {
  return {
    id: "implementation",
    status: total === 0 ? "info" : passed === total ? "ok" : "warn",
    title: total === 0 ? "No test cases to check the reference implementation" : `Reference implementation passes ${passed} of ${total} test cases`,
    detail: passed === total ? "" : "The generated code differs from the mapper's own results for these cases; treat them with care.",
    items: failed,
  };
}

export const readinessCounts = (items: ReadinessItem[]) => ({
  warnings: items.filter((i) => i.status === "warn").length,
  notes: items.filter((i) => i.status === "info").length,
});

/** Database constants in mappings (constant sources) and constant tags. */
export function dbConstantsOf(
  mappings: Mapping[],
  targetSide: "left" | "right",
  fixed: (FixedValues | undefined)[],
): { label: string; db: DbRef }[] {
  const out: { label: string; db: DbRef }[] = [];
  for (const m of mappings) if (m.db) out.push({ label: pathLabel(m[targetSide]), db: m.db });
  for (const f of fixed) for (const [id, tag] of Object.entries(f ?? {})) if (tag.db) out.push({ label: pathLabel(JSON.parse(id) as Path), db: tag.db });
  return out;
}
