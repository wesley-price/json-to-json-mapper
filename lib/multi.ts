// Multi-source mode: one standard object (the primary) fed by several source
// objects, e.g. many downstream error formats normalised into one standard
// error response. Each source has cases; a case has conditions and its own
// mappings. Cases are checked top to bottom and the first match is used.

import { type Headers, valuesAtPath } from "./headers";
import type { Json, Mapping, Path } from "./json-tree";

export type ConditionOp =
  | "equals"
  | "not-equals"
  | "contains"
  | "starts-with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "exists"
  | "missing";

export const CONDITION_OPS: { id: ConditionOp; label: string; needsValue: boolean }[] = [
  { id: "equals", label: "equals", needsValue: true },
  { id: "not-equals", label: "does not equal", needsValue: true },
  { id: "contains", label: "contains", needsValue: true },
  { id: "starts-with", label: "starts with", needsValue: true },
  { id: "gte", label: "≥", needsValue: true },
  { id: "gt", label: ">", needsValue: true },
  { id: "lte", label: "≤", needsValue: true },
  { id: "lt", label: "<", needsValue: true },
  { id: "exists", label: "has a value", needsValue: false },
  { id: "missing", label: "is empty / missing", needsValue: false },
];

export interface Condition {
  path: Path;
  op: ConditionOp;
  value: string;
}

export interface MappingCase {
  id: string;
  name: string;
  /** All must hold. No conditions = always matches (an "otherwise" case). */
  when: Condition[];
  mappings: Mapping[];
}

export interface SourceDef<S> {
  id: string;
  name: string;
  /** The source document (format, sample, headers…). */
  side: S;
  cases: MappingCase[];
  activeCase: string;
}

const isEmpty = (v: Json | undefined) => v === undefined || v === null || v === "";

/** Does one condition hold for this source document? Lists match when any item does. */
export function conditionHolds(cond: Condition, body: Json, headers: Headers | undefined): boolean {
  const values = valuesAtPath(body, headers, cond.path);
  if (cond.op === "missing") return values.length === 0 || values.every(isEmpty);
  if (cond.op === "exists") return values.some((v) => !isEmpty(v));
  const want = cond.value.trim();
  return values.some((v) => {
    if (isEmpty(v)) return false;
    const text = typeof v === "object" ? JSON.stringify(v) : String(v);
    const a = Number(text);
    const b = Number(want);
    const numeric = want !== "" && !Number.isNaN(a) && !Number.isNaN(b);
    switch (cond.op) {
      case "equals":
        return numeric ? a === b : text.toLowerCase() === want.toLowerCase();
      case "not-equals":
        return numeric ? a !== b : text.toLowerCase() !== want.toLowerCase();
      case "contains":
        return text.toLowerCase().includes(want.toLowerCase());
      case "starts-with":
        return text.toLowerCase().startsWith(want.toLowerCase());
      case "gt":
        return numeric && a > b;
      case "gte":
        return numeric && a >= b;
      case "lt":
        return numeric && a < b;
      case "lte":
        return numeric && a <= b;
      default:
        return false;
    }
  });
}

/** The first case whose conditions all hold, or null when none does. */
export function pickCase(cases: MappingCase[], body: Json, headers: Headers | undefined): MappingCase | null {
  return cases.find((c) => c.when.every((cond) => conditionHolds(cond, body, headers))) ?? null;
}

/** "status ≥ 400 and status < 500" */
export function describeConditions(when: Condition[], label: (p: Path) => string): string {
  if (when.length === 0) return "always (otherwise)";
  return when
    .map((c) => {
      const op = CONDITION_OPS.find((o) => o.id === c.op);
      return `${label(c.path)} ${op?.label ?? c.op}${op?.needsValue ? ` ${c.value || '""'}` : ""}`;
    })
    .join(" and ");
}
