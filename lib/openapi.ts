// OpenAPI: import schemas from an API spec (OpenAPI 3.x or Swagger 2, JSON or
// YAML) — request bodies, responses per status, components — and export a
// spec of the mapping: the target schemas with every field annotated with
// where its value comes from (x-mapping), plus the source schemas.

import YAML from "yaml";
import { isJsonSchema, parseJsonOrYaml, resolveRef } from "./formats/jsonschema";

type Obj = { [key: string]: unknown };
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export interface ApiSchemaEntry {
  id: string;
  /** "POST /orders" or "Components". */
  group: string;
  /** "200 response: Order created", "request body", "Order". */
  label: string;
  kind: "request" | "response" | "component";
  method?: string;
  path?: string;
  status?: string;
  /** A self-contained JSON Schema ($refs inlined). */
  schema: Obj;
}

export interface ApiSpec {
  title: string;
  version: string;
  entries: ApiSchemaEntry[];
}

/** Inline every local $ref, so the schema stands on its own (recursive types stop after a few levels). */
export function bundleSchema(schema: unknown, root: unknown, seen: string[] = []): Obj {
  if (Array.isArray(schema)) return schema.map((s) => bundleSchema(s, root, seen)) as unknown as Obj;
  if (!isObj(schema)) return schema as Obj;
  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    if (seen.filter((r) => r === ref).length >= 2) return { description: `(recursive: ${ref.split("/").pop()})` };
    const { $ref: _r, ...siblings } = schema;
    void _r;
    return { ...bundleSchema(resolveRef(ref, root), root, [...seen, ref]), ...siblings };
  }
  return Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, typeof v === "object" ? bundleSchema(v, root, seen) : v]));
}

const jsonContent = (content: unknown): unknown => {
  if (!isObj(content)) return undefined;
  const key = Object.keys(content).find((k) => /json/i.test(k)) ?? Object.keys(content)[0];
  return key && isObj(content[key]) ? content[key].schema : undefined;
};

const METHODS = ["get", "put", "post", "delete", "patch", "options", "head"];

export function readOpenApi(text: string): ApiSpec {
  const doc = parseJsonOrYaml(text) as Obj;
  if (!isObj(doc) || !(doc.openapi || doc.swagger)) throw new Error('This isn\'t an OpenAPI or Swagger document (no "openapi" / "swagger" field).');
  const info = isObj(doc.info) ? doc.info : {};
  const entries: ApiSchemaEntry[] = [];
  const add = (e: Omit<ApiSchemaEntry, "id" | "schema">, schema: unknown) => {
    if (!isObj(schema)) return;
    entries.push({ ...e, id: `e${entries.length + 1}`, schema: bundleSchema(schema, doc) });
  };
  for (const [path, item] of Object.entries(isObj(doc.paths) ? doc.paths : {})) {
    if (!isObj(item)) continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!isObj(op)) continue;
      const group = `${method.toUpperCase()} ${path}`;
      // OpenAPI 3: requestBody.content; Swagger 2: a body parameter.
      const reqSchema = isObj(op.requestBody)
        ? jsonContent(op.requestBody.content)
        : (Array.isArray(op.parameters) ? (op.parameters as Obj[]).find((p) => p.in === "body")?.schema : undefined);
      add({ group, label: "request body", kind: "request", method, path }, reqSchema);
      for (const [status, res] of Object.entries(isObj(op.responses) ? op.responses : {})) {
        const r = isObj(res) && typeof res.$ref === "string" ? (resolveRef(res.$ref, doc) as Obj) : (res as Obj);
        if (!isObj(r)) continue;
        const schema = r.content ? jsonContent(r.content) : r.schema;
        add({ group, label: `${status} response${typeof r.description === "string" && r.description ? `: ${r.description}` : ""}`, kind: "response", method, path, status }, schema);
      }
    }
  }
  const components = isObj(doc.components) && isObj(doc.components.schemas) ? doc.components.schemas : isObj(doc.definitions) ? doc.definitions : {};
  for (const [name, schema] of Object.entries(components)) add({ group: "Components", label: name, kind: "component" }, schema);
  if (!entries.length) throw new Error("No schemas found in this spec.");
  return { title: String(info.title ?? "API"), version: String(info.version ?? ""), entries };
}

// ---------- export ----------

/** Where one target field's value comes from, as written into x-mapping. */
export interface FieldMappingNote {
  /** "Payments API: errorCode" (source name only with several sources). */
  from: string[];
  /** For combined fields: text join or sum / product / decimal. */
  combine?: string;
  steps?: string;
  translate?: string;
  constant?: string;
  case?: string;
  note?: string;
}

export interface OpenApiScenario {
  name: string;
  /** The target / standard schema (JSON Schema). */
  targetSchema: Obj;
  /** Target field path JSON -> how it is filled. */
  fields: Map<string, FieldMappingNote[]>;
  /** Target field path JSON -> what an unmapped field gets ("left out", "sent as null", …). */
  unmapped: Map<string, string>;
  sources: { name: string; schema: Obj; origin?: { method?: string; path?: string; status?: string } }[];
  /** Where the target came from, when it was imported from an OpenAPI spec. */
  origin?: { method?: string; path?: string; status?: string };
}

const componentName = (s: string) => s.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join("") || "Schema";

/** Annotate a schema's properties with x-mapping (and a readable description line). */
function annotate(schema: Obj, path: string[], sc: OpenApiScenario): Obj {
  const out: Obj = { ...schema };
  if (isObj(schema.properties)) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, isObj(v) ? annotate(v, [...path, k], sc) : v]));
  }
  if (isObj(schema.items)) out.items = annotate(schema.items, [...path, "[]"], sc);
  const id = JSON.stringify(path);
  const notes = sc.fields.get(id);
  if (notes?.length) {
    out["x-mapping"] = notes.length === 1 ? notes[0] : notes;
    const words = notes
      .map((n) => `${n.case ? `[${n.case}] ` : ""}${n.constant ? `constant ${n.constant}` : n.from.join(n.combine ? ` (${n.combine}) ` : " + ")}${n.steps ? `, then ${n.steps}` : ""}${n.translate ? `, translated` : ""}`)
      .join("; ");
    const own = typeof schema.description === "string" ? schema.description.trim() : "";
    out.description = `${own ? `${own.replace(/[.\s]*$/, "")}. ` : ""}Mapped from: ${words}.`;
  } else if (sc.unmapped.has(id)) {
    out["x-mapping"] = { unmapped: sc.unmapped.get(id) };
  }
  return out;
}

/** A schema as a component: $schema belongs to standalone documents, not inside OpenAPI. */
const asComponent = (schema: Obj): Obj => {
  const { $schema: _s, ...rest } = schema;
  void _s;
  return rest;
};

/** Put a schema back under the operation it was imported from (a response by status, else the request body). */
function placeUnder(paths: Obj, origin: OpenApiScenario["origin"], ref: string, description: string) {
  if (!origin?.path || !origin.method) return;
  const item = (paths[origin.path] ??= {}) as Obj;
  const op = (item[origin.method] ??= {}) as Obj;
  const content = { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } };
  if (origin.status) ((op.responses ??= {}) as Obj)[origin.status] = { description, content };
  else op.requestBody = { content };
}

export function buildOpenApi(opts: { title: string; version: string; description: string; scenarios: OpenApiScenario[] }, format: "yaml" | "json" = "yaml"): string {
  const schemas: Obj = {};
  const paths: Obj = {};
  const xScenarios: Obj[] = [];
  for (const sc of opts.scenarios) {
    const base = componentName(sc.name);
    const targetName = `${base}Target`;
    schemas[targetName] = asComponent(annotate(sc.targetSchema, [], sc));
    const sourceNames = sc.sources.map((s) => {
      const n = s.name === "Source" ? `${base}Source` : `${base}Source${componentName(s.name)}`;
      schemas[n] = asComponent(s.schema);
      placeUnder(paths, s.origin, n, s.name);
      return n;
    });
    xScenarios.push({ name: sc.name, target: `#/components/schemas/${targetName}`, sources: sourceNames.map((n) => `#/components/schemas/${n}`) });
    // Schemas imported from a spec go back under their operation.
    placeUnder(paths, sc.origin, targetName, sc.name);
  }
  const doc = {
    openapi: "3.1.0",
    info: { title: opts.title || "Mapping", version: opts.version || "1.0.0", ...(opts.description ? { description: opts.description } : {}) },
    paths,
    components: { schemas },
    "x-mapping-scenarios": xScenarios,
  };
  return format === "json" ? JSON.stringify(doc, null, 2) : YAML.stringify(doc, { lineWidth: 0 });
}

export { isJsonSchema };
