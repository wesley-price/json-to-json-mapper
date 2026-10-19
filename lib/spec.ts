// The hand-off spec: document details (version, author, purpose) and the
// implementation rules a developer needs beyond the field-to-field mappings —
// what unmapped fields get, what happens when a source value is missing, and
// whether values are converted to the target's type. The rules are applied to
// the app's own results too, so the samples in the report match them.

import { HEADERS, type Headers, valuesAtPath } from "./headers";
import { type FieldNode, type Json, type Path, isPrefix, pathId, pathLabel } from "./json-tree";
import { type FixedValues, isConstPath } from "./transforms";

/** What a target field with no mapping gets. */
export type UnmappedPolicy = "example" | "omit" | "null" | "ask";
/** What a mapped target field gets when its source value is missing. */
export type MissingPolicy = "example" | "omit" | "null" | "empty";
/** Whether mapped values are converted to the target field's type. */
export type CoercePolicy = "as-is" | "convert";

export interface Spec {
  version: string;
  author: string;
  /** What the mapping is for (shown on the report cover). */
  purpose: string;
  unmapped: UnmappedPolicy;
  missing: MissingPolicy;
  coerce: CoercePolicy;
  /** Header names are matched without regard to case. */
  headersCaseInsensitive: boolean;
  /** Anything else the implementer should know. */
  notes: string;
}

export const DEFAULT_SPEC: Spec = {
  version: "",
  author: "",
  purpose: "",
  unmapped: "example",
  missing: "example",
  coerce: "as-is",
  headersCaseInsensitive: true,
  notes: "",
};

/** A decision for one unmapped target field (overrides the document rule). */
export type FieldDecision = UnmappedPolicy;
export type FieldDecisions = Record<string, FieldDecision>;
/** The open question for a field marked "ask" (pathId -> question / who to ask). */
export type FieldQuestions = Record<string, string>;

export const UNMAPPED_OPTIONS: { id: UnmappedPolicy; label: string; rule: string }[] = [
  { id: "example", label: "Keep its example value as a default", rule: "is sent with the example value shown in the target object (a fixed default)" },
  { id: "omit", label: "Leave it out", rule: "is left out of the output" },
  { id: "null", label: "Send null", rule: "is sent as null" },
  {
    id: "ask",
    label: "Ask a subject-matter expert (open question)",
    rule: "is an open question for a subject-matter expert; until it is answered, the example value is sent",
  },
];

/** Short wording for an unmapped field's outcome. */
export const UNMAPPED_SHORT: Record<UnmappedPolicy, string> = {
  example: "keeps example value",
  omit: "left out",
  null: "sent as null",
  ask: "open question",
};

export const MISSING_OPTIONS: { id: MissingPolicy; label: string; rule: string }[] = [
  { id: "example", label: "Keep the target's example value", rule: "the target keeps the example value shown in the target object" },
  { id: "omit", label: "Leave the field out", rule: "the target field is left out of the output" },
  { id: "null", label: "Send null", rule: "the target field is sent as null" },
  { id: "empty", label: 'Send an empty string ("")', rule: 'the target field is sent as an empty string ("")' },
];
export const COERCE_OPTIONS: { id: CoercePolicy; label: string; rule: string }[] = [
  { id: "as-is", label: "Copy values as they are", rule: "Values are copied as they are; no type conversion." },
  {
    id: "convert",
    label: "Convert to the target field's type",
    rule: 'Values are converted to the target field\'s type: text that reads as a number becomes a number, numbers become text for text fields, "true"/"false" become booleans.',
  },
];

export const normalizeSpec = (s: Partial<Spec> | null | undefined): Spec => ({ ...DEFAULT_SPEC, ...(s ?? {}) });

/** The rules in plain sentences, for the report. */
export function describeRules(spec: Spec): { title: string; text: string }[] {
  const unmapped = UNMAPPED_OPTIONS.find((o) => o.id === spec.unmapped)!;
  const missing = MISSING_OPTIONS.find((o) => o.id === spec.missing)!;
  return [
    {
      title: "Target fields with no mapping",
      text: `Unless a field says otherwise (see "Target fields without a mapping" and the coverage table), a target field with no mapping ${unmapped.rule}.`,
    },
    {
      title: "Missing source values",
      text: `When a mapped source field is absent from the input, ${missing.rule}. An empty value ("") counts as present.`,
    },
    { title: "Types", text: COERCE_OPTIONS.find((o) => o.id === spec.coerce)!.rule },
    {
      title: "Case conditions",
      text:
        "Cases are checked top to bottom and the first whose conditions all hold is used. When both sides read as numbers they are compared as numbers (402 equals \"402\"); otherwise as text, ignoring upper/lower case. " +
        "≥ > ≤ < only hold for numbers. When the field is a list, a condition holds if any item matches. An empty or missing value never matches, except for \"is empty / missing\".",
    },
    {
      title: "Header names",
      text: spec.headersCaseInsensitive
        ? "Header names are matched without regard to upper/lower case (X-Request-Id = x-request-id)."
        : "Header names are matched exactly, including upper/lower case.",
    },
    {
      title: "Combined fields",
      text: "Parts are joined in the order listed with the separator shown; empty parts are skipped, so no doubled separators appear.",
    },
    {
      title: "Lists",
      text: "A mapping from a list into a list writes one target item per source item. A list feeding a single field uses the last item's value.",
    },
  ];
}

// ---------- applying the rules to a result ----------

const REMOVE = Symbol("remove");
type Edit = (v: Json | undefined) => Json | typeof REMOVE;

/** Change the value at `path` ("[]" = every list item); REMOVE deletes the key. Missing keys are added unless removed. */
function editAt(root: Json, path: Path, fn: Edit): Json {
  if (path.length === 0) {
    const v = fn(root);
    return v === REMOVE ? root : v;
  }
  const [head, ...rest] = path;
  if (head === "[]") return Array.isArray(root) ? root.map((item) => editAt(item, rest, fn)) : root;
  if (root === null || typeof root !== "object" || Array.isArray(root)) return root;
  if (rest.length === 0) {
    const v = fn(root[head]);
    if (v === REMOVE) {
      const { [head]: _gone, ...others } = root;
      void _gone;
      return others;
    }
    return { ...root, [head]: v };
  }
  if (!(head in root)) return root;
  return { ...root, [head]: editAt(root[head], rest, fn) };
}

function leaves(node: FieldNode, out: { path: Path; type: string }[] = []) {
  for (const c of node.children) {
    if (c.children.length === 0 && c.type !== "object" && c.type !== "array") out.push({ path: c.path, type: c.type });
    else leaves(c, out);
  }
  return out;
}

function convert(v: Json | undefined, type: string): Json | undefined {
  if (v === undefined || v === null) return v;
  if (type === "number" && typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (type === "string" && (typeof v === "number" || typeof v === "boolean")) return String(v);
  if (type === "boolean" && typeof v === "string" && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === "true";
  return v;
}

/** One target field with no mapping on the current screen, and what it gets. */
export interface UnmappedField {
  path: Path;
  label: string;
  /** The field's own decision, if one was made. */
  decision?: FieldDecision;
  /** What it actually gets (its decision, or the document rule). */
  effective: UnmappedPolicy;
  /** The open question, when it is one ("ask"). */
  question?: string;
}

/** Target fields that no mapping writes and no constant tag covers. */
export function unmappedFields(
  targetTree: FieldNode | null,
  targets: Path[],
  targetFixed: FixedValues | undefined,
  decisions: FieldDecisions | undefined,
  spec: Spec,
  questions?: FieldQuestions,
): UnmappedField[] {
  if (!targetTree) return [];
  return leaves(targetTree)
    .filter(({ path }) => !(path.length === 1 && path[0] === HEADERS))
    .filter(({ path }) => !targets.some((t) => isPrefix(t, path)) && !(pathId(path) in (targetFixed ?? {})))
    .map(({ path }) => {
      const decision = decisions?.[pathId(path)];
      const effective = decision ?? spec.unmapped;
      const question = effective === "ask" ? questions?.[pathId(path)]?.trim() || undefined : undefined;
      return { path, label: pathLabel(path), decision, effective, ...(question ? { question } : {}) };
    });
}

/**
 * Apply the rules to a mapped result: unmapped fields, missing source values and
 * type conversion. `mappings` are {from, to} pairs as the engine got them (constants
 * have a $const source path).
 */
export function applyRules(
  out: { body: Json; headers: Headers },
  ctx: {
    targetTree: FieldNode | null;
    mappings: { from: Path; to: Path }[];
    source: { body: Json; headers: Headers | undefined };
    sourceFixed?: FixedValues;
    targetFixed?: FixedValues;
    decisions?: FieldDecisions;
    spec: Spec;
  },
): { body: Json; headers: Headers } {
  const { targetTree, mappings, source, spec } = ctx;
  if (!targetTree) return out;
  let body = out.body;
  let headers: Json = out.headers;
  const edit = (path: Path, fn: Edit) => {
    if (path[0] === HEADERS) headers = editAt(headers, path.slice(1), fn);
    else body = editAt(body, path, fn);
  };
  const valueFor = (p: UnmappedPolicy | MissingPolicy): Edit | null =>
    p === "omit" ? () => REMOVE : p === "null" ? () => null : p === "empty" ? () => "" : null;

  for (const { path, type } of leaves(targetTree)) {
    if (path.length === 1 && path[0] === HEADERS) continue;
    if (pathId(path) in (ctx.targetFixed ?? {})) continue;
    const into = mappings.filter((m) => isPrefix(m.to, path));
    if (into.length === 0) {
      const fn = valueFor(ctx.decisions?.[pathId(path)] ?? spec.unmapped);
      if (fn) edit(path, fn);
      continue;
    }
    // Missing: every mapping into this field reads a source field that isn't there.
    const missing = into.every((m) => {
      if (isConstPath(m.from) || pathId(m.from) in (ctx.sourceFixed ?? {})) return false;
      const from = [...m.from, ...path.slice(m.to.length)];
      return valuesAtPath(source.body, source.headers, from).length === 0;
    });
    if (missing) {
      const fn = valueFor(spec.missing);
      if (fn) edit(path, fn);
      continue;
    }
    if (spec.coerce === "convert") edit(path, (v) => (v === undefined ? REMOVE : (convert(v, type) as Json)));
  }
  return { body, headers: headers as Headers };
}

// ---------- Excel (Document sheet rows) ----------

const ROWS: [keyof Spec, string][] = [
  ["version", "Version"],
  ["author", "Author"],
  ["purpose", "Purpose"],
  ["unmapped", "Rule: target field with no mapping"],
  ["missing", "Rule: missing source value"],
  ["coerce", "Rule: value types"],
  ["headersCaseInsensitive", "Rule: header names ignore case"],
  ["notes", "Notes for the implementer"],
];

/** Property | Value rows for the Document sheet. */
export function specRows(spec: Spec): [string, string][] {
  return ROWS.map(([key, label]) => {
    const v = spec[key];
    return [label, typeof v === "boolean" ? (v ? "yes" : "no") : v];
  });
}

/** Read the spec back from Document sheet rows (`get` takes a lower-case property name). */
export function readSpec(get: (key: string) => string): Spec | null {
  const raw = Object.fromEntries(ROWS.map(([key, label]) => [key, get(label.toLowerCase())]));
  if (ROWS.every(([key]) => !raw[key])) return null;
  const pick = <T extends string>(v: string, ids: T[], fallback: T) => (ids.includes(v as T) ? (v as T) : fallback);
  return {
    version: raw.version,
    author: raw.author,
    purpose: raw.purpose,
    unmapped: pick(raw.unmapped, UNMAPPED_OPTIONS.map((o) => o.id), DEFAULT_SPEC.unmapped),
    missing: pick(raw.missing, MISSING_OPTIONS.map((o) => o.id), DEFAULT_SPEC.missing),
    coerce: pick(raw.coerce, COERCE_OPTIONS.map((o) => o.id), DEFAULT_SPEC.coerce),
    headersCaseInsensitive: raw.headersCaseInsensitive ? !/^(no|false|0)$/i.test(raw.headersCaseInsensitive) : true,
    notes: raw.notes,
  };
}

/** Rows for an "Unmapped" sheet: Object | Field | Decision | Question. */
export function decisionRows(
  object: string,
  decisions: FieldDecisions | undefined,
  questions?: FieldQuestions,
): [string, string, string, string][] {
  return Object.entries(decisions ?? {}).map(([id, d]) => [object, pathLabel(JSON.parse(id) as Path), d, d === "ask" ? (questions?.[id] ?? "") : ""]);
}
