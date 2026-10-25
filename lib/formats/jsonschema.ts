// JSON Schema (and OpenAPI schemas) as a format. Reading a schema gives an
// example object: $ref, allOf, oneOf/anyOf, enum, const, format, example and
// default are understood. A { "schema": …, "example": … } pair is read too.
// Writing produces that pair, keeping the declared properties (descriptions,
// formats, enums, required…) of an earlier schema. Also: field types in words
// and validating a value against the schema.

import YAML from "yaml";
import type { Json } from "../json-tree";
import { bigNumberNote, parseJsonLossless } from "./lossless";

type Obj = { [key: string]: unknown };
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON, or YAML when it isn't JSON. */
export function parseJsonOrYaml(text: string, notes: string[] = []): unknown {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    const { value, big } = parseJsonLossless(t);
    notes.push(...big.map(bigNumberNote));
    return value;
  }
  return YAML.parse(t);
}

/** Does this look like a JSON Schema (or a schema/example pair)? */
export function isJsonSchema(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (isObj(v.schema) && "example" in v) return true;
  return "$schema" in v || isObj(v.properties) || v.type === "object" || "$ref" in v || Array.isArray(v.allOf);
}

/** Follow a local "$ref" ("#/components/schemas/Order", "#/$defs/X", "#/definitions/X"). */
export function resolveRef(ref: string, root: unknown): unknown {
  if (!ref.startsWith("#")) return {};
  let node: unknown = root;
  for (const part of ref.slice(1).split("/").filter(Boolean)) {
    const key = decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~"));
    node = isObj(node) ? node[key] : undefined;
  }
  return node ?? {};
}

/** A schema with $ref resolved and allOf merged (one level). */
function flat(schema: unknown, root: unknown, depth = 0): Obj {
  if (!isObj(schema) || depth > 20) return {};
  if (typeof schema.$ref === "string") return flat(resolveRef(schema.$ref, root), root, depth + 1);
  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf.map((s) => flat(s, root, depth + 1));
    const { allOf: _allOf, ...rest } = schema;
    void _allOf;
    return parts.reduce<Obj>(
      (acc, p) => ({
        ...acc,
        ...p,
        properties: { ...(isObj(acc.properties) ? acc.properties : {}), ...(isObj(p.properties) ? p.properties : {}) },
        required: [...(Array.isArray(acc.required) ? acc.required : []), ...(Array.isArray(p.required) ? p.required : [])],
      }),
      rest,
    );
  }
  return schema;
}

const typeOf = (s: Obj): string | undefined => {
  if (Array.isArray(s.type)) return (s.type as string[]).find((t) => t !== "null") ?? "null";
  if (typeof s.type === "string") return s.type;
  if (isObj(s.properties)) return "object";
  if (s.items) return "array";
  return undefined;
};

const FORMAT_EXAMPLES: Record<string, Json> = {
  date: "2026-01-01",
  "date-time": "2026-01-01T00:00:00Z",
  time: "00:00:00",
  email: "user@example.com",
  uuid: "00000000-0000-0000-0000-000000000000",
  uri: "https://example.com",
  hostname: "example.com",
  ipv4: "192.0.2.1",
};

/** An example value for a schema. */
export function schemaExample(schema: unknown, root: unknown = schema, depth = 0): Json {
  const s = flat(schema, root);
  if (depth > 12) return null;
  if ("const" in s) return s.const as Json;
  if ("example" in s) return s.example as Json;
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0] as Json;
  if ("default" in s) return s.default as Json;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum.find((e) => e !== null) as Json ?? null;
  const branch = (Array.isArray(s.oneOf) && s.oneOf[0]) || (Array.isArray(s.anyOf) && s.anyOf.find((b) => !(isObj(b) && b.type === "null")));
  if (branch) return schemaExample(branch, root, depth + 1);
  switch (typeOf(s)) {
    case "object": {
      const out: { [key: string]: Json } = {};
      for (const [k, v] of Object.entries(isObj(s.properties) ? s.properties : {})) out[k] = schemaExample(v, root, depth + 1);
      return out;
    }
    case "array":
      return [schemaExample(s.items, root, depth + 1)];
    case "integer":
    case "number":
      return typeof s.minimum === "number" ? s.minimum : 0;
    case "boolean":
      return false;
    case "null":
      return null;
    case "string":
      return (typeof s.format === "string" && FORMAT_EXAMPLES[s.format]) || "";
    default:
      return null;
  }
}

/** The schema in a parsed text (a bare schema or a schema/example pair). */
export const schemaIn = (v: unknown): unknown => (isObj(v) && isObj(v.schema) && "example" in v ? v.schema : v);

export function parseJsonSchema(text: string, notes: string[] = []): Json {
  const v = parseJsonOrYaml(text, notes);
  if (isObj(v) && isObj(v.schema) && "example" in v) return v.example as Json;
  if (!isJsonSchema(v)) throw new Error("This doesn't look like a JSON Schema (expected properties, type or $ref).");
  return schemaExample(v, v);
}

// ---------- writing ----------

function inferSchema(v: Json): Obj {
  if (v === null) return { type: ["string", "null"] };
  if (typeof v === "boolean") return { type: "boolean" };
  if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "number" };
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return { type: "string", format: "date-time" };
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { type: "string", format: "date" };
    return { type: "string" };
  }
  if (Array.isArray(v)) return { type: "array", items: v.length ? inferSchema(v[0]) : {} };
  return { type: "object", properties: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, inferSchema(x)])) };
}

/** A schema for the data, keeping what an earlier schema declared for fields that still exist. */
function writeSchema(data: Json, declared: unknown, root: unknown): Obj {
  const d = flat(declared, root);
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const props = isObj(d.properties) ? d.properties : {};
    const properties = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, writeSchema(v, props[k], root)]));
    const required = Array.isArray(d.required) ? (d.required as string[]).filter((k) => k in data) : undefined;
    const { properties: _p, required: _r, ...rest } = d;
    void _p;
    void _r;
    return { ...rest, type: "object", properties, ...(required?.length ? { required } : {}) };
  }
  if (Array.isArray(data)) {
    const { items: _i, ...rest } = d;
    void _i;
    return { ...rest, type: "array", items: writeSchema(data[0] ?? null, d.items, root) };
  }
  // A leaf: what was declared, or inferred from the value.
  return Object.keys(d).length ? d : inferSchema(data);
}

/** `like`: an earlier schema (or schema/example pair) whose declarations are kept. */
export function toJsonSchema(data: Json, like?: string): string {
  let declared: unknown = {};
  try {
    declared = like ? schemaIn(parseJsonOrYaml(like)) : {};
  } catch {
    declared = {};
  }
  const schema = writeSchema(data, declared, declared);
  if (isObj(declared) && typeof declared.$schema === "string") schema.$schema = declared.$schema;
  return JSON.stringify({ schema, example: data }, null, 2);
}

// ---------- field types in words ----------

function describe(s: Obj, required: boolean): string {
  const t = typeOf(s) ?? "any";
  const nullable = (Array.isArray(s.type) && s.type.includes("null")) || s.nullable === true;
  const parts = [
    `${nullable ? "nullable " : ""}${Array.isArray(s.enum) ? `enum: ${(s.enum as unknown[]).map(String).join(" | ")}` : t}${typeof s.format === "string" ? ` (${s.format})` : ""}`,
    typeof s.minimum === "number" ? `≥ ${s.minimum}` : "",
    typeof s.maximum === "number" ? `≤ ${s.maximum}` : "",
    typeof s.maxLength === "number" ? `max ${s.maxLength} chars` : "",
    typeof s.pattern === "string" ? `pattern ${s.pattern}` : "",
    required ? "required" : "",
  ].filter(Boolean);
  return parts.join(", ");
}

/** Every field's declared type, keyed by path JSON ("[]" for list items). */
export function jsonSchemaFieldTypes(text: string, prefix: string[] = []): Map<string, string> {
  const out = new Map<string, string>();
  let root: unknown;
  try {
    root = schemaIn(parseJsonOrYaml(text));
  } catch {
    return out;
  }
  const walk = (schema: unknown, path: string[], required: boolean, depth: number) => {
    if (depth > 12) return;
    const s = flat(schema, root);
    if (path.length) out.set(JSON.stringify(path), describe(s, required));
    const t = typeOf(s);
    if (t === "object") {
      const req = Array.isArray(s.required) ? (s.required as string[]) : [];
      for (const [k, v] of Object.entries(isObj(s.properties) ? s.properties : {})) walk(v, [...path, k], req.includes(k), depth + 1);
    } else if (t === "array") walk(s.items, [...path, "[]"], false, depth + 1);
  };
  walk(root, prefix, false, 0);
  return out;
}

// ---------- validation ----------

export interface SchemaIssue {
  path: string;
  message: string;
}

const FORMAT_CHECKS: Record<string, RegExp> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/,
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
};

/** Check a value against a schema; every problem with the path where it is. */
export function validateJsonSchema(value: Json, schemaText: string): SchemaIssue[] {
  let root: unknown;
  try {
    root = schemaIn(parseJsonOrYaml(schemaText));
  } catch {
    return [];
  }
  const issues: SchemaIssue[] = [];
  const check = (v: Json | undefined, schema: unknown, path: string, depth: number): boolean => {
    if (depth > 30) return true;
    const s = flat(schema, root);
    const before = issues.length;
    const where = path || "(root)";
    if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
      const branches = (s.anyOf ?? s.oneOf) as unknown[];
      const ok = branches.some((b) => {
        const mark = issues.length;
        const good = check(v, b, path, depth + 1);
        issues.length = mark;
        return good;
      });
      if (!ok) issues.push({ path: where, message: "matches none of the allowed shapes" });
      return issues.length === before;
    }
    if (v === undefined) return true;
    const nullable = (Array.isArray(s.type) && s.type.includes("null")) || s.nullable === true;
    if (v === null) {
      if (!nullable && s.type !== "null" && s.type !== undefined) issues.push({ path: where, message: "is null but the schema doesn't allow null" });
      return issues.length === before;
    }
    if ("const" in s && JSON.stringify(s.const) !== JSON.stringify(v)) issues.push({ path: where, message: `must be ${JSON.stringify(s.const)}` });
    if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) {
      issues.push({ path: where, message: `${JSON.stringify(v)} isn't one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")}` });
    }
    const t = typeOf(s);
    const actual = Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;
    if (t && !(t === actual || (t === "number" && actual === "integer"))) {
      issues.push({ path: where, message: `is ${actual} but the schema says ${t}` });
      return false;
    }
    if (typeof v === "string") {
      if (typeof s.minLength === "number" && v.length < s.minLength) issues.push({ path: where, message: `is shorter than ${s.minLength} characters` });
      if (typeof s.maxLength === "number" && v.length > s.maxLength) issues.push({ path: where, message: `is longer than ${s.maxLength} characters` });
      if (typeof s.pattern === "string") {
        try {
          if (!new RegExp(s.pattern).test(v)) issues.push({ path: where, message: `doesn't match the pattern ${s.pattern}` });
        } catch {
          // an unusable pattern: not checked
        }
      }
      if (typeof s.format === "string" && FORMAT_CHECKS[s.format] && !FORMAT_CHECKS[s.format].test(v)) {
        issues.push({ path: where, message: `${JSON.stringify(v)} isn't a valid ${s.format}` });
      }
    }
    if (typeof v === "number") {
      if (typeof s.minimum === "number" && v < s.minimum) issues.push({ path: where, message: `is below the minimum ${s.minimum}` });
      if (typeof s.maximum === "number" && v > s.maximum) issues.push({ path: where, message: `is above the maximum ${s.maximum}` });
    }
    if (Array.isArray(v)) v.forEach((item, i) => check(item, s.items, `${path}[${i}]`, depth + 1));
    else if (typeof v === "object") {
      const props = isObj(s.properties) ? s.properties : {};
      for (const k of Array.isArray(s.required) ? (s.required as string[]) : []) {
        if (!(k in v)) issues.push({ path: path ? `${path}.${k}` : k, message: "is required but missing" });
      }
      for (const [k, x] of Object.entries(v)) {
        const childPath = path ? `${path}.${k}` : k;
        if (k in props) check(x, props[k], childPath, depth + 1);
        else if (s.additionalProperties === false) issues.push({ path: childPath, message: "isn't allowed (additionalProperties is false)" });
      }
    }
    return issues.length === before;
  };
  check(value, root, "", 0);
  return issues;
}
