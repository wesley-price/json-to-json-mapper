// Avro schemas (.avsc) as a format. Reading a schema gives an example object:
// records become nested objects, nullable unions use their non-null branch,
// enums use their first symbol, a field's "default" is its example value and
// logical types (timestamps, dates, decimals) get readable examples. A
// { "schema": …, "example": … } pair is read too, keeping the example.
//
// Writing produces that pair: the schema (reusing the declared field types,
// docs and defaults from an earlier schema where the field still exists) and
// the object as an example message, in plain JSON.

import type { Json } from "../json-tree";
import { bigNumberNote, parseJsonLossless } from "./lossless";

type Schema = string | Schema[] | { [key: string]: unknown };
type Obj = { [key: string]: unknown };

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Is this JSON an Avro schema (a record, a union containing one, or a schema/example pair)? */
export function isAvroSchema(v: unknown): boolean {
  if (isObj(v) && isObj(v.schema) && "example" in v) return true;
  if (isObj(v)) return v.type === "record";
  return Array.isArray(v) && v.some((x) => isObj(x) && x.type === "record");
}

function logicalSample(t: Obj): Json | undefined {
  switch (t.logicalType) {
    case "timestamp-millis":
    case "timestamp-micros":
    case "local-timestamp-millis":
    case "local-timestamp-micros":
      return "2026-01-01T00:00:00Z";
    case "date":
      return "2026-01-01";
    case "time-millis":
    case "time-micros":
      return "00:00:00";
    case "decimal":
      return 0;
    case "uuid":
      return "00000000-0000-0000-0000-000000000000";
    default:
      return undefined;
  }
}

/** An example value for a schema. `names` holds named types seen so far (records, enums, fixed). */
function sample(t: Schema, names: Map<string, Obj>, namespace = ""): Json {
  if (typeof t === "string") {
    switch (t) {
      case "null":
        return null;
      case "boolean":
        return false;
      case "int":
      case "long":
      case "float":
      case "double":
        return 0;
      case "bytes":
      case "string":
        return "";
      default: {
        const named = names.get(t) ?? names.get(namespace ? `${namespace}.${t}` : t);
        return named ? sample(named, names, namespace) : "";
      }
    }
  }
  if (Array.isArray(t)) {
    // A union: the first non-null branch (["null", "string"] is a nullable string).
    const branch = t.find((b) => b !== "null") ?? "null";
    return sample(branch, names, namespace);
  }
  const logical = logicalSample(t);
  if (logical !== undefined) return logical;
  const ns = typeof t.namespace === "string" ? t.namespace : namespace;
  const register = () => {
    if (typeof t.name === "string") {
      names.set(t.name, t);
      if (ns) names.set(`${ns}.${t.name}`, t);
    }
  };
  switch (t.type) {
    case "record":
    case "error": {
      register();
      const out: { [key: string]: Json } = {};
      for (const f of Array.isArray(t.fields) ? (t.fields as Obj[]) : []) {
        if (typeof f.name !== "string") continue;
        out[f.name] = f.default !== undefined ? (f.default as Json) : sample(f.type as Schema, names, ns);
      }
      return out;
    }
    case "enum":
      register();
      return Array.isArray(t.symbols) && typeof t.symbols[0] === "string" ? t.symbols[0] : "";
    case "fixed":
      register();
      return "";
    case "array":
      return [sample(t.items as Schema, names, ns)];
    case "map":
      return { key: sample(t.values as Schema, names, ns) };
    default:
      return typeof t.type === "string" || Array.isArray(t.type) || isObj(t.type) ? sample(t.type as Schema, names, ns) : "";
  }
}

/** The record schema in a parsed .avsc (or schema/example pair). */
function recordOf(v: unknown): Obj | null {
  if (isObj(v) && isObj(v.schema)) return recordOf(v.schema);
  if (isObj(v) && v.type === "record") return v;
  if (Array.isArray(v)) {
    const records = v.filter((x) => isObj(x) && x.type === "record") as Obj[];
    return records[records.length - 1] ?? null; // the last one usually uses the earlier ones
  }
  return null;
}

/** `notes`: collects a note for each integer too large for JavaScript (kept as text). */
export function parseAvro(text: string, notes: string[] = []): Json {
  const { value, big } = parseJsonLossless(text);
  notes.push(...big.map(bigNumberNote));
  const v = value as unknown;
  if (isObj(v) && isObj(v.schema) && "example" in v) return v.example as Json;
  return avroExample(v);
}

/** An example object for a parsed schema (throws when there is no record). */
export function avroExample(v: unknown): Json {
  const names = new Map<string, Obj>();
  // Named types defined in earlier schemas of a list.
  if (Array.isArray(v)) for (const x of v) if (isObj(x)) sample(x as Schema, names);
  const record = recordOf(v);
  if (!record) throw new Error('An Avro schema needs a record ({ "type": "record", "fields": [...] }).');
  return sample(record as Schema, names);
}

// ---------- field types in words (for spreadsheets and reports) ----------

/** "long (timestamp-millis)", "nullable string", "enum Status: PLACED | PAID", "array<record Line>"… */
function describe(t: unknown, names: Map<string, Obj>): string {
  if (typeof t === "string") return t;
  if (Array.isArray(t)) {
    const nullable = t.includes("null");
    const rest = t.filter((b) => b !== "null");
    const inner = rest.length === 1 ? describe(rest[0], names) : `union<${rest.map((b) => describe(b, names)).join(" | ")}>`;
    return nullable ? `nullable ${inner}` : inner;
  }
  if (!isObj(t)) return "";
  if (typeof t.logicalType === "string") {
    const extra = t.logicalType === "decimal" ? `, precision ${t.precision ?? "?"}, scale ${t.scale ?? 0}` : "";
    return `${String(t.type)} (${t.logicalType}${extra})`;
  }
  switch (t.type) {
    case "record":
    case "error":
      return `record ${String(t.name ?? "")}`.trim();
    case "enum":
      return `enum ${String(t.name ?? "")}: ${(Array.isArray(t.symbols) ? t.symbols : []).join(" | ")}`;
    case "array":
      return `array<${describe(t.items, names)}>`;
    case "map":
      return `map<${describe(t.values, names)}>`;
    case "fixed":
      return `fixed ${String(t.name ?? "")} (${String(t.size ?? "?")} bytes)`;
    default:
      return describe(t.type, names);
  }
}

/**
 * Every field's declared Avro type, keyed by its path (JSON of the path segments,
 * "[]" for list items). `prefix` places the record inside a larger object (a Kafka event's "value").
 */
export function avroFieldTypes(schemaText: string, prefix: string[] = []): Map<string, string> {
  const out = new Map<string, string>();
  let v: unknown;
  try {
    v = JSON.parse(schemaText);
  } catch {
    return out;
  }
  const names = new Map<string, Obj>();
  if (Array.isArray(v)) for (const x of v) if (isObj(x)) sample(x as Schema, names);
  const record = recordOf(v);
  if (!record) return out;
  sample(record as Schema, names);
  const walk = (rec: Obj, path: string[], seen: Set<Obj>) => {
    if (seen.has(rec)) return; // recursive types
    const next = new Set(seen).add(rec);
    for (const f of Array.isArray(rec.fields) ? (rec.fields as Obj[]) : []) {
      if (typeof f.name !== "string") continue;
      const p = [...path, f.name];
      const dflt = f.default !== undefined ? ` (default ${JSON.stringify(f.default)})` : "";
      out.set(JSON.stringify(p), describe(f.type, names) + dflt);
      // Nested records: directly, in a nullable union, as list items or map values.
      const inner = (t: unknown, at: string[]): void => {
        if (typeof t === "string") {
          const named = names.get(t);
          if (named?.type === "record") walk(named, at, next);
        } else if (Array.isArray(t)) t.forEach((b) => inner(b, at));
        else if (isObj(t)) {
          if (t.type === "record") walk(t, at, next);
          else if (t.type === "array") inner(t.items, [...at, "[]"]);
          else if (t.type === "map") inner(t.values, [...at, "key"]);
        }
      };
      inner(f.type, p);
    }
  };
  walk(record, prefix, new Set());
  return out;
}

// ---------- writing ----------

const capital = (s: string) => s.replace(/(^|[^A-Za-z0-9])([a-z])/g, (_, __, c: string) => c.toUpperCase()).replace(/[^A-Za-z0-9_]/g, "") || "Record";

function inferType(v: Json): Schema {
  if (v === null) return ["null", "string"];
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return Number.isInteger(v) ? (Math.abs(v) > 2147483647 ? "long" : "int") : "double";
  if (typeof v === "string") return "string";
  return "string";
}

/** The record schema a declared field type points at (directly, in a nullable union, or as array items). */
function declaredRecord(t: unknown, names: Map<string, Obj>): Obj | null {
  if (typeof t === "string") return names.get(t) ?? null;
  if (Array.isArray(t)) {
    for (const b of t) {
      const r = declaredRecord(b, names);
      if (r) return r;
    }
    return null;
  }
  if (isObj(t)) {
    if (t.type === "record") return t;
    if (t.type === "array") return declaredRecord(t.items, names);
  }
  return null;
}

function writeRecord(name: string, data: { [key: string]: Json }, declared: Obj | null, names: Map<string, Obj>): Obj {
  const declaredFields = new Map(
    (Array.isArray(declared?.fields) ? (declared!.fields as Obj[]) : []).map((f) => [String(f.name), f]),
  );
  const fields = Object.entries(data).map(([key, value]) => {
    const old = declaredFields.get(key);
    const nested = (v: Json): Schema => {
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        return writeRecord(capital(key), v as { [key: string]: Json }, old ? declaredRecord(old.type, names) : null, names);
      }
      return inferType(v);
    };
    let type: Schema;
    if (Array.isArray(value)) {
      const first = value[0] ?? null;
      type = old && !isObj(first) ? (old.type as Schema) : { type: "array", items: nested(first) };
    } else if (value !== null && typeof value === "object") {
      const rec = nested(value);
      // Keep a declared nullable union around the record.
      type = old && Array.isArray(old.type) && old.type.includes("null") ? ["null", rec] : rec;
    } else {
      type = old ? (old.type as Schema) : inferType(value);
    }
    return { ...(old ?? {}), name: key, type };
  });
  return {
    type: "record",
    name: (declared?.name as string) ?? capital(name),
    ...(declared?.namespace ? { namespace: declared.namespace } : {}),
    ...(declared?.doc ? { doc: declared.doc } : {}),
    fields,
  };
}

/** `like`: an earlier schema (or schema/example pair) whose field types, docs and defaults are kept. */
export function toAvro(data: Json, like?: string): string {
  let declared: Obj | null = null;
  const names = new Map<string, Obj>();
  if (like) {
    try {
      const v = JSON.parse(like) as unknown;
      declared = recordOf(v);
      if (Array.isArray(v)) for (const x of v) if (isObj(x)) sample(x as Schema, names);
      if (declared) sample(declared as Schema, names);
    } catch {
      // not a schema: infer everything
    }
  }
  const body = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as { [key: string]: Json }) : { value: data };
  return JSON.stringify({ schema: writeRecord("Record", body, declared, names), example: data }, null, 2);
}
