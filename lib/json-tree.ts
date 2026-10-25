// Helpers for treating a JSON value as a tree of fields addressed by paths.
// A path is a list of segments: object keys, or ARRAY_ITEM ("[]") meaning
// "every element of this array".

import type { DbRef, Translation } from "./transforms";
import type { Step } from "./steps";

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type Path = string[];
export type Side = "left" | "right";
export type FieldType = "string" | "number" | "boolean" | "object" | "array" | "null";

export const ARRAY_ITEM = "[]";

export interface Mapping {
  id: string;
  left: Path;
  right: Path;
  /**
   * When several mappings share a target, their values are joined with this
   * text (a space by default). Every mapping in the group carries the same value.
   */
  join?: string;
  /** A fixed value written instead of a source field (the source path is [CONST, key]). */
  constant?: Json;
  /** Set when the constant comes from a database table/column (constant is then a sample value). */
  db?: DbRef;
  /** Value translation table applied on the way through. */
  translate?: Translation;
  /** Value transformations (dates, text, numbers…), run before the translation table. */
  steps?: Step[];
  /** Free text for whoever implements the mapping (business rules, open questions). */
  note?: string;
}

/** Separator per target (pathId) for mappings whose target is on `targetSide`. */
export function joinsFor(mappings: Mapping[], targetSide: Side): Map<string, string> {
  const joins = new Map<string, string>();
  for (const m of mappings) {
    const id = pathId(m[targetSide]);
    if (m.join !== undefined && !joins.has(id)) joins.set(id, m.join);
  }
  return joins;
}

export interface FieldNode {
  key: string; // segment name; ARRAY_ITEM for array elements
  path: Path;
  type: FieldType;
  sample?: Json; // example value for leaves
  items?: Json[]; // an array's actual items (its example values)
  children: FieldNode[];
}

export const pathId = (path: Path) => JSON.stringify(path);

/**
 * List selection: a source path segment that picks one item of a list instead of
 * walking every item — "[first]", "[last]", "[#3]" (the third) or
 * "[where type = billing]" (the first item whose field matches; "!=" and "~"
 * (contains) work too).
 */
export const isSelector = (seg: string) => seg !== ARRAY_ITEM && seg.length > 2 && seg.startsWith("[") && seg.endsWith("]");

/** The tree row a path belongs to (selectors become "[]"). */
export const rowPath = (path: Path): Path => (path.some(isSelector) ? path.map((s) => (isSelector(s) ? ARRAY_ITEM : s)) : path);

/** The item(s) of a list a selector picks. */
export function selectItems(list: Json[], seg: string): Json[] {
  const body = seg.slice(1, -1).trim();
  if (body === "first") return list.length ? [list[0]] : [];
  if (body === "last") return list.length ? [list[list.length - 1]] : [];
  if (body.startsWith("#")) {
    const n = Number(body.slice(1));
    return Number.isInteger(n) && n >= 1 && n <= list.length ? [list[n - 1]] : [];
  }
  const m = /^where\s+(.+?)\s*(!=|=|~)\s*(.*)$/.exec(body);
  if (!m) return [];
  const [, field, op, raw] = m;
  const want = raw.trim().replace(/^["']|["']$/g, "").toLowerCase();
  const hit = list.find((item) => {
    let v: Json | undefined = item;
    for (const key of field.split(".")) v = isObject(v) ? v[key] : undefined;
    const text = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    const t = text.toLowerCase();
    return op === "=" ? t === want : op === "!=" ? t !== want : t.includes(want);
  });
  return hit === undefined ? [] : [hit];
}

export function pathLabel(path: Path): string {
  if (path.length === 0) return "(root)";
  return path.reduce((out, seg) => {
    if (seg === ARRAY_ITEM) return out + "[]";
    if (isSelector(seg)) return out + seg;
    const safe = /^[A-Za-z_$][\w$]*$/.test(seg) ? seg : JSON.stringify(seg);
    if (!out) return safe;
    return /^[A-Za-z_$]/.test(safe) ? `${out}.${safe}` : `${out}[${safe}]`;
  }, "");
}

export const isPrefix = (prefix: Path, path: Path) =>
  prefix.length <= path.length && prefix.every((seg, i) => path[i] === seg);

export function typeOf(value: Json): FieldType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as FieldType;
}

export function defaultFor(type: FieldType): Json {
  switch (type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "object":
      return {};
    case "array":
      return [];
    case "null":
      return null;
  }
}

const isObject = (v: unknown): v is { [key: string]: Json } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Merge the shapes of all array elements so `[]` shows every key seen. */
function mergeShapes(items: Json[]): Json | undefined {
  if (items.length === 0) return undefined;
  if (!items.every(isObject)) return items[0];
  const merged: { [key: string]: Json } = {};
  for (const item of items as { [key: string]: Json }[]) {
    for (const [k, v] of Object.entries(item)) if (!(k in merged)) merged[k] = v;
  }
  return merged;
}

export function buildTree(value: Json, key = "", path: Path = []): FieldNode {
  const type = typeOf(value);
  const node: FieldNode = { key, path, type, children: [] };
  if (type === "object") {
    node.children = Object.entries(value as object).map(([k, v]) =>
      buildTree(v as Json, k, [...path, k]),
    );
  } else if (type === "array") {
    const shape = mergeShapes(value as Json[]);
    if (shape !== undefined) node.children = [buildTree(shape, ARRAY_ITEM, [...path, ARRAY_ITEM])];
    node.items = value as Json[];
  } else {
    node.sample = value;
  }
  return node;
}

/** Every path that exists in the tree (including the root). */
export function allPaths(node: FieldNode, out = new Set<string>()): Set<string> {
  out.add(pathId(node.path));
  node.children.forEach((c) => allPaths(c, out));
  return out;
}

export function findNode(node: FieldNode, path: Path): FieldNode | undefined {
  if (pathId(node.path) === pathId(path)) return node;
  for (const child of node.children) {
    if (isPrefix(child.path, path)) return findNode(child, path);
  }
  return undefined;
}

// ---------- Immutable edits (used on the editable side) ----------

/**
 * Apply `fn` to every container reached by `path` (fanning out across arrays)
 * and return a new root. `fn` receives a shallow copy it may mutate.
 */
function updateAt(root: Json, path: Path, fn: (target: Json) => Json): Json {
  if (path.length === 0) return fn(root);
  const [head, ...rest] = path;
  if (head === ARRAY_ITEM) {
    if (!Array.isArray(root)) return root;
    return root.map((item) => updateAt(item, rest, fn));
  }
  if (!isObject(root) || !(head in root)) return root;
  return { ...root, [head]: updateAt(root[head], rest, fn) };
}

/** Add `key` to the object at `parent`. For arrays, `itemType` seeds one item. */
export function addField(
  root: Json,
  parent: Path,
  key: string,
  type: FieldType,
  itemType?: FieldType,
): Json {
  const value = type === "array" && itemType ? [defaultFor(itemType)] : defaultFor(type);
  return updateAt(root, parent, (target) =>
    isObject(target) ? { ...target, [key]: value } : target,
  );
}

/** Set what an array holds; an empty array gets one item so its shape is visible. */
/** Replace the items of the array at `path` (in every enclosing array item). */
export function setArrayItems(root: Json, path: Path, items: Json[]): Json {
  return updateAt(root, path, (target) => (Array.isArray(target) ? structuredClone(items) : target));
}

/**
 * The example values of a list, ignoring the single blank placeholder item a
 * list gets when its item type is chosen (e.g. [""] or [0]).
 */
export function exampleItems(items: Json[] | undefined): Json[] {
  if (!items) return [];
  if (items.length === 1 && typeof items[0] !== "object" && items[0] === defaultFor(typeOf(items[0]))) return [];
  return items;
}

export function setArrayItemType(root: Json, path: Path, itemType: FieldType): Json {
  return updateAt(root, path, (target) => {
    if (!Array.isArray(target)) return target;
    return target.length ? target.map(() => defaultFor(itemType)) : [defaultFor(itemType)];
  });
}

export function removeField(root: Json, path: Path): Json {
  const parent = path.slice(0, -1);
  const key = path[path.length - 1];
  return updateAt(root, parent, (target) => {
    if (key === ARRAY_ITEM) return Array.isArray(target) ? [] : target;
    if (!isObject(target)) return target;
    const copy = { ...target };
    delete copy[key];
    return copy;
  });
}

export function renameField(root: Json, path: Path, newKey: string): Json {
  const parent = path.slice(0, -1);
  const oldKey = path[path.length - 1];
  return updateAt(root, parent, (target) => {
    if (!isObject(target) || !(oldKey in target)) return target;
    // Rebuild to keep key order.
    return Object.fromEntries(
      Object.entries(target).map(([k, v]) => [k === oldKey ? newKey : k, v]),
    );
  });
}

export function setFieldType(root: Json, path: Path, type: FieldType): Json {
  const parent = path.slice(0, -1);
  const key = path[path.length - 1];
  return updateAt(root, parent, (target) => {
    if (key === ARRAY_ITEM && Array.isArray(target)) return target.map(() => defaultFor(type));
    if (!isObject(target)) return target;
    return { ...target, [key]: defaultFor(type) };
  });
}

// ---------- Applying mappings ----------

interface Match {
  indexes: number[]; // array indexes chosen for each "[]" along the path
  value: Json;
}

function collect(value: Json, path: Path, indexes: number[] = []): Match[] {
  if (path.length === 0) return [{ indexes, value }];
  const [head, ...rest] = path;
  // A selector picks item(s) without adding a list index: the value counts as a single value.
  if (isSelector(head)) return Array.isArray(value) ? selectItems(value, head).flatMap((item) => collect(item, rest, indexes)) : [];
  if (head === ARRAY_ITEM) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, i) => collect(item, rest, [...indexes, i]));
  }
  if (!isObject(value) || !(head in value)) return [];
  return collect(value[head], rest, indexes);
}

type Templates = Map<string, Json>;

function assign(
  root: Json,
  path: Path,
  indexes: number[],
  value: Json,
  templates: Templates,
  at: Path = [],
): Json {
  if (path.length === 0) return structuredClone(value);
  const [head, ...rest] = path;
  if (head === ARRAY_ITEM) {
    const arr = Array.isArray(root) ? [...root] : [];
    const template = templates.get(pathId(at)) ?? {};
    if (indexes.length === 0) {
      // A single value mapped into a list field goes into every item
      // (e.g. an order number repeated on each CSV row).
      if (arr.length === 0) arr.push(structuredClone(template));
      return arr.map((item) => assign(item, rest, [], value, templates, [...at, ARRAY_ITEM]));
    }
    const [i, ...more] = indexes;
    while (arr.length <= i) arr.push(structuredClone(template));
    arr[i] = assign(arr[i], rest, more, value, templates, [...at, ARRAY_ITEM]);
    return arr;
  }
  const obj = isObject(root) ? { ...root } : {};
  obj[head] = assign(obj[head] ?? null, rest, indexes, value, templates, [...at, head]);
  return obj;
}

/**
 * Copy values from `source` into a clone of `template`, following each
 * mapping from `from` path to `to` path. Arrays are walked element by element,
 * so mapped target arrays end up the same length as the source arrays.
 */
export const DEFAULT_JOIN = " ";

/** A value as text for joining; null/missing is empty. */
const joinText = (v: Json | undefined) =>
  v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

/** How combined fields can be put together: text joins, or a number worked out from the parts. */
export const COMBINE_MODES = [
  { id: "join", label: "Join as text" },
  { id: "[sum]", label: "Sum" },
  { id: "[product]", label: "Multiply" },
  { id: "[decimal]", label: "Decimal (amount + decimal places)" },
] as const;
export const isNumericCombine = (sep: string | undefined) => sep === "[sum]" || sep === "[product]" || sep === "[decimal]";

/**
 * Combine the parts of a combined field. The separator is either text to join
 * with, or one of "[sum]", "[product]", "[decimal]" (the first part divided by
 * 10 to the power of the second, e.g. 2548 and 2 -> 25.48).
 */
export function combineParts(parts: (Json | undefined)[], sep: string): Json {
  if (sep === "[sum]" || sep === "[product]" || sep === "[decimal]") {
    const nums = parts.map((p) => (p === undefined || p === null || p === "" || typeof p === "object" ? NaN : Number(p)));
    const tidy = (n: number) => Number(n.toFixed(10));
    if (sep === "[decimal]") {
      const [amount, places] = nums;
      if (Number.isNaN(amount)) return parts[0] === undefined ? null : parts[0];
      const p = Number.isNaN(places) ? 0 : Math.trunc(places);
      return p >= 0 ? Number((amount / Math.pow(10, p)).toFixed(p)) : tidy(amount * Math.pow(10, -p));
    }
    const valid = nums.filter((n) => !Number.isNaN(n));
    if (!valid.length) return null;
    return tidy(sep === "[sum]" ? valid.reduce((a, b) => a + b, 0) : valid.reduce((a, b) => a * b, 1));
  }
  return parts.map(joinText).filter((t) => t !== "").join(sep);
}

/** True when `a` is a prefix of `b` (array indexes). */
const indexPrefix = (a: number[], b: number[]) => a.length <= b.length && a.every((n, i) => b[i] === n);

/**
 * Copy values from `source` into a clone of `template`. Mappings that share a
 * target are combined: their values are joined with `joins.get(pathId(to))`
 * (a space by default), skipping empty parts. Inside lists each item is joined
 * separately, and single values are combined with every item.
 */
export function applyMappings(
  source: Json,
  template: Json,
  mappings: { from: Path; to: Path; transform?: (v: Json) => Json }[],
  joins: Map<string, string> = new Map(),
): Json {
  const templates: Templates = new Map();
  let result = structuredClone(template);
  // Empty every target array a mapping writes into, remembering its first
  // element so new elements keep the target's shape and default values.
  for (const { to } of mappings) {
    to.forEach((seg, i) => {
      if (seg !== ARRAY_ITEM) return;
      const arrayPath = to.slice(0, i);
      const id = pathId(arrayPath);
      if (templates.has(id)) return;
      const first = collect(template, [...arrayPath, ARRAY_ITEM])[0];
      templates.set(id, first ? first.value : {});
      // Clear the array either in the result itself or, for nested arrays,
      // inside the enclosing array's element template.
      const outer = i === 0 ? -1 : to.lastIndexOf(ARRAY_ITEM, i - 1);
      const outerId = pathId(to.slice(0, outer));
      const rel = to.slice(outer + 1, i);
      const owner = outer === -1 ? result : templates.get(outerId)!;
      const cleared = emptyArrayAt(owner, rel);
      if (outer === -1) result = cleared;
      else templates.set(outerId, cleared);
    });
  }
  const depth = (p: Path) => p.filter((seg) => seg === ARRAY_ITEM).length;

  // Group mappings by target, keeping their order (it is the join order).
  const groups = new Map<string, { to: Path; froms: Path[]; transforms: ((v: Json) => Json)[] }>();
  const same = (v: Json) => v;
  for (const { from, to, transform } of mappings) {
    const id = pathId(to);
    if (!groups.has(id)) groups.set(id, { to, froms: [], transforms: [] });
    groups.get(id)!.froms.push(from);
    groups.get(id)!.transforms.push(transform ?? same);
  }
  // The source with the most list levels decides how many values are written.
  const units = [...groups.entries()].map(([id, g]) => {
    const driver = g.froms.reduce((best, f, i) => (depth(f) > depth(g.froms[best]) ? i : best), 0);
    return { id, ...g, driver };
  });

  // Fill lists from list mappings first, so single values copied into every
  // item land on all of the items rather than on a lone placeholder.
  const copiesIntoList = (u: (typeof units)[number]) => Number(depth(u.to) > depth(u.froms[u.driver]));
  units.sort((a, b) => copiesIntoList(a) - copiesIntoList(b));

  for (const u of units) {
    // Each part's values, already passed through its transform (e.g. a translation table).
    const sets = u.froms.map((f, k) => collect(source, f).map((m) => ({ ...m, value: u.transforms[k](m.value) })));
    if (u.froms.length === 1) {
      for (const { indexes, value } of sets[0]) result = assign(result, u.to, indexes, value, templates);
      continue;
    }
    const sep = joins.get(u.id) ?? DEFAULT_JOIN;
    for (const lead of sets[u.driver]) {
      const parts = sets.map((set, k) => {
        if (k === u.driver) return lead.value;
        // The part from the same list item (or a single value shared by all items).
        const match =
          set.find((m) => indexPrefix(m.indexes, lead.indexes)) ?? set.find((m) => indexPrefix(lead.indexes, m.indexes));
        return match?.value;
      });
      const joined = combineParts(parts, sep);
      result = assign(result, u.to, lead.indexes, joined, templates);
    }
  }
  return result;
}

function emptyArrayAt(root: Json, path: Path): Json {
  if (path.length === 0) return Array.isArray(root) ? [] : root;
  const key = path[path.length - 1];
  return updateAt(root, path.slice(0, -1), (parent) =>
    isObject(parent) && Array.isArray(parent[key]) ? { ...parent, [key]: [] } : parent,
  );
}

// ---------- Flattening ----------

/**
 * Flatten a JSON value into `{ "a.b[0].c": leaf }`. Empty objects and arrays
 * are kept as leaves so their keys are not lost.
 */
export function flatten(value: Json, prefix = "", out: Record<string, Json> = {}): Record<string, Json> {
  const join = (key: string) => {
    const safe = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `[${JSON.stringify(key)}]`;
    return !prefix ? safe : safe.startsWith("[") ? prefix + safe : `${prefix}.${safe}`;
  };
  if (Array.isArray(value) && value.length > 0) {
    value.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out));
  } else if (isObject(value) && Object.keys(value).length > 0) {
    for (const [k, v] of Object.entries(value)) flatten(v, join(k), out);
  } else {
    out[prefix || "(root)"] = value;
  }
  return out;
}

/**
 * Parse a path label (as produced by `pathLabel` or `flatten`) back into
 * segments: `a.b[0]["x y"][]` -> ["a", "b", 0, "x y", ARRAY_ITEM].
 */
export function parsePathLabel(label: string): (string | number)[] {
  const s = label.trim();
  if (s === "" || s === "(root)") return [];
  const out: (string | number)[] = [];
  let i = 0;
  const readQuoted = () => {
    let j = i + 1;
    while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
    if (j >= s.length) throw new Error(`Unterminated quote in path "${label}"`);
    const key = JSON.parse(s.slice(i, j + 1)) as string;
    i = j + 1;
    return key;
  };
  while (i < s.length) {
    const ch = s[i];
    if (ch === "[") {
      i++;
      const rest = s.slice(i, s.indexOf("]", i));
      if (s[i] === "]") {
        out.push(ARRAY_ITEM);
      } else if (/^(first|last|#\d+|where\s)/.test(rest)) {
        // A list selector: kept as one segment.
        out.push(`[${rest}]`);
        i += rest.length;
      } else if (s[i] === '"') {
        out.push(readQuoted());
      } else {
        const end = s.indexOf("]", i);
        const index = Number(s.slice(i, end));
        if (end === -1 || !Number.isInteger(index) || index < 0) throw new Error(`Bad index in path "${label}"`);
        out.push(index);
        i = end;
      }
      if (s[i] !== "]") throw new Error(`Expected "]" in path "${label}"`);
      i++;
    } else if (ch === '"' && i === 0) {
      out.push(readQuoted());
    } else {
      if (ch === ".") i++;
      let j = i;
      while (j < s.length && s[j] !== "." && s[j] !== "[") j++;
      if (j === i) throw new Error(`Empty key in path "${label}"`);
      out.push(s.slice(i, j));
      i = j;
    }
  }
  return out;
}

/** Inverse of `flatten`: rebuild a nested value from `[path, value]` pairs. */
export function unflatten(entries: [(string | number)[], Json][]): Json {
  let root: Json = null;
  for (const [path, value] of entries) {
    if (path.length === 0) {
      root = value;
      continue;
    }
    const container = (seg: string | number): Json => (typeof seg === "number" ? [] : {});
    if (root === null || typeof root !== "object") root = container(path[0]);
    let node = root as Json[] | { [key: string]: Json };
    path.forEach((seg, i) => {
      const last = i === path.length - 1;
      const holder = node as Record<string | number, Json>;
      if (last) {
        holder[seg] = value;
        return;
      }
      const existing = holder[seg];
      if (existing === null || typeof existing !== "object") holder[seg] = container(path[i + 1]);
      node = holder[seg] as Json[] | { [key: string]: Json };
    });
  }
  // Arrays written by index can have holes if rows were deleted; fill with null.
  return JSON.parse(JSON.stringify(root));
}

// ---------- Moving fields ----------

export type MoveResult = { data: Json; path: Path } | { error: string };

function insertKey(obj: { [key: string]: Json }, key: string, value: Json, after?: string) {
  const entries = Object.entries(obj).filter(([k]) => k !== key);
  const at = after === undefined ? entries.length : entries.findIndex(([k]) => k === after) + 1;
  entries.splice(at || entries.length, 0, [key, value]);
  return Object.fromEntries(entries);
}

/**
 * Move the field at `from` into the object or array at `parent` (an array
 * means "into each of its items"), placed after sibling `after` when given.
 * Values come from the first match when `from` sits inside an array.
 */
export function moveField(root: Json, from: Path, parent: Path, after?: string): MoveResult {
  const key = from[from.length - 1];
  if (from.length === 0 || key === ARRAY_ITEM) return { error: "Move the list itself rather than its items." };
  if (isPrefix(from, parent)) return { error: `Can't move "${key}" into itself.` };

  const target = collect(root, parent)[0]?.value;
  const label = pathLabel(parent) === "(root)" ? "the top level" : `"${pathLabel(parent)}"`;
  let container = parent;
  let emptyList = false;
  if (Array.isArray(target)) {
    const items = collect(root, [...parent, ARRAY_ITEM]);
    if (items.some((i) => !isObject(i.value))) {
      return {
        error: `${label} is a list of ${typeOf(items[0].value)}s, so it can't hold "${key}". Change it to a list of objects first.`,
      };
    }
    container = [...parent, ARRAY_ITEM];
    emptyList = items.length === 0;
  } else if (!isObject(target)) {
    return { error: `${label} isn't an object or list, so it can't hold fields.` };
  }

  const sameParent = pathId(from.slice(0, -1)) === pathId(container);
  const existing = collect(root, container)[0]?.value;
  if (!sameParent && isObject(existing) && key in existing) {
    return { error: `${label} already has a field named "${key}".` };
  }

  const value = collect(root, from)[0]?.value ?? null;
  let data = removeField(root, from);
  data = emptyList
    ? updateAt(data, parent, () => [{ [key]: value }])
    : updateAt(data, container, (obj) => (isObject(obj) ? insertKey(obj, key, value, after) : obj));
  return { data, path: [...container, key] };
}

/**
 * Set the value at `path`. Inside arrays this edits the first item (the one
 * the tree shows as the example), leaving the other items alone.
 */
export function setValueAt(root: Json, path: Path, value: Json): Json {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (head === ARRAY_ITEM) {
    if (!Array.isArray(root) || root.length === 0) return root;
    return [setValueAt(root[0], rest, value), ...root.slice(1)];
  }
  if (!isObject(root) || !(head in root)) return root;
  return { ...root, [head]: setValueAt(root[head], rest, value) };
}

/** Every value at `path` (one per array item along the way), e.g. for showing examples. */
export function valuesAt(root: Json, path: Path): Json[] {
  return collect(root, path).map((m) => m.value);
}
