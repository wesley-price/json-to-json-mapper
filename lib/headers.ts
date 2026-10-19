// Headers: name/value pairs that travel with a JSON or XML document (like
// message or HTTP headers, e.g. "store-loc: STORE-042"), kept apart from the
// document body. Header fields are addressed by paths that start with the
// reserved segment HEADERS, so they never clash with body fields.

import type { Format } from "./formats";
import {
  type FieldNode,
  type Json,
  type Path,
  applyMappings,
  buildTree,
  pathId,
  valuesAt,
} from "./json-tree";

export const HEADERS = "$headers";
// Constant mappings read from this root (see lib/transforms.ts); it is never wrapped.
const CONSTS = "$const";
const BODY = "$body";

export type Headers = { [name: string]: Json };

export const isHeaderPath = (p: Path) => p[0] === HEADERS;

/** Headers are offered for documents; flat files and CSV have their own header rows. */
export const supportsHeaders = (format: Format) => format === "json" || format === "xml";

/** The headers as a tree whose paths start with HEADERS. */
export const headersTree = (headers: Headers): FieldNode => buildTree(headers, HEADERS, [HEADERS]);

/**
 * One tree holding the headers and the body, for looking fields up by path
 * (types, validity, labels). Without headers it is just the body tree.
 */
export function lookupTree(body: Json | null, headers: Headers | undefined): FieldNode | null {
  if (body === null) return null;
  const bodyTree = buildTree(body);
  if (!headers) return bodyTree;
  return { ...bodyTree, type: "object", children: [headersTree(headers), ...bodyTree.children] };
}

/** Values at a path, whether it points into the headers or the body. */
export function valuesAtPath(body: Json, headers: Headers | undefined, path: Path): Json[] {
  return isHeaderPath(path) ? (headers ? valuesAt(headers, path.slice(1)) : []) : valuesAt(body, path);
}

/** Header and body paths side by side under one root. */
const wrap = (p: Path): Path => (isHeaderPath(p) || p[0] === CONSTS ? p : [BODY, ...p]);

/**
 * applyMappings over headers and body together: sources and targets may be
 * header fields or body fields. Returns the target's body and headers.
 */
export function applyWithHeaders(
  source: { body: Json; headers?: Headers },
  target: { body: Json; headers?: Headers },
  mappings: { from: Path; to: Path; transform?: (v: Json) => Json }[],
  joins: Map<string, string> = new Map(),
  /** Values for constant mappings, by key. */
  constants: Record<string, Json> = {},
): { body: Json; headers: Headers } {
  const wrappedJoins = new Map<string, string>();
  for (const [id, sep] of joins) wrappedJoins.set(pathId(wrap(JSON.parse(id) as Path)), sep);
  const result = applyMappings(
    { [HEADERS]: source.headers ?? {}, [BODY]: source.body, [CONSTS]: constants },
    { [HEADERS]: target.headers ?? {}, [BODY]: target.body },
    mappings.map((m) => ({ from: wrap(m.from), to: wrap(m.to), transform: m.transform })),
    wrappedJoins,
  ) as { [key: string]: Json };
  return { body: result[BODY], headers: (result[HEADERS] ?? {}) as Headers };
}

/** Headers as "name: value" lines. */
export function headersText(headers: Headers): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
}
