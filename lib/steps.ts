// Value transformations: a chain of steps per mapping (dates, text, numbers,
// defaults, if/then/else, type conversions), run before the translation table.
//
// The steps are written once, as plain JavaScript (STEPS_SOURCE): the app runs
// that code and the generated reference implementation embeds the very same
// text, so the two can never behave differently.

import type { Json } from "./json-tree";

export type Step =
  | { op: "trim" }
  | { op: "upper" }
  | { op: "lower" }
  | { op: "title" }
  | { op: "substring"; start: number; length?: number }
  | { op: "replace"; find: string; with: string }
  | { op: "prefix"; text: string }
  | { op: "suffix"; text: string }
  | { op: "date"; from: string; to: string }
  | { op: "number"; decimals?: number; multiply?: number; add?: number }
  | { op: "default"; value: string }
  | { op: "if"; test: "equals" | "not-equals" | "contains" | "empty" | "gt" | "lt"; value: string; then: string; else: string }
  | { op: "toString" }
  | { op: "toNumber" }
  | { op: "toBoolean" };

export type StepOp = Step["op"];

/** The step kinds, with a fresh step of each kind (the editor's "Add step" menu). */
export const STEP_KINDS: { op: StepOp; label: string; make: () => Step }[] = [
  { op: "date", label: "Date format", make: () => ({ op: "date", from: "ISO", to: "DD/MM/YYYY" }) },
  { op: "trim", label: "Trim spaces", make: () => ({ op: "trim" }) },
  { op: "upper", label: "UPPER CASE", make: () => ({ op: "upper" }) },
  { op: "lower", label: "lower case", make: () => ({ op: "lower" }) },
  { op: "title", label: "Title Case", make: () => ({ op: "title" }) },
  { op: "substring", label: "Part of the text", make: () => ({ op: "substring", start: 0, length: 3 }) },
  { op: "replace", label: "Replace text", make: () => ({ op: "replace", find: "", with: "" }) },
  { op: "prefix", label: "Add text before", make: () => ({ op: "prefix", text: "" }) },
  { op: "suffix", label: "Add text after", make: () => ({ op: "suffix", text: "" }) },
  { op: "number", label: "Number (round / multiply / add)", make: () => ({ op: "number", decimals: 2 }) },
  { op: "default", label: "Default when empty", make: () => ({ op: "default", value: "" }) },
  { op: "if", label: "If … then … else", make: () => ({ op: "if", test: "equals", value: "", then: "", else: "" }) },
  { op: "toString", label: "Convert to text", make: () => ({ op: "toString" }) },
  { op: "toNumber", label: "Convert to number", make: () => ({ op: "toNumber" }) },
  { op: "toBoolean", label: "Convert to true/false", make: () => ({ op: "toBoolean" }) },
];

/** Date patterns offered in the editor (any pattern with YYYY MM DD HH mm ss works). */
export const DATE_PATTERNS = ["ISO", "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD.MM.YYYY", "YYYYMMDD", "YYYY-MM-DD HH:mm:ss", "DD/MM/YYYY HH:mm", "epoch-ms", "epoch-s"];

/**
 * The step logic as plain JavaScript (no imports, no TypeScript), shared by the app
 * and the generated reference implementation.
 */
export const STEPS_SOURCE = String.raw`
/** Text for a value (null and missing are empty). */
function stepText(v) {
  return v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** Parse a date written in a pattern (YYYY MM DD HH mm ss), "ISO", "epoch-ms" or "epoch-s"; null when it doesn't match. */
function parseDateWith(value, pattern) {
  const text = stepText(value).trim();
  if (!text) return null;
  if (pattern === "epoch-ms" || pattern === "epoch-s") {
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    const d = new Date(pattern === "epoch-s" ? n * 1000 : n);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  }
  if (pattern === "ISO") {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  }
  const tokens = [];
  const source = pattern.replace(/YYYY|MM|DD|HH|mm|ss|[.*+?^(){}$|[\]\\]/g, (t) => {
    if (/^(YYYY|MM|DD|HH|mm|ss)$/.test(t)) {
      tokens.push(t);
      return t === "YYYY" ? "(\\d{4})" : "(\\d{1,2})";
    }
    return "\\" + t;
  });
  const m = new RegExp("^" + source + "$").exec(text);
  if (!m) return null;
  const parts = { y: 1970, mo: 1, d: 1, h: 0, mi: 0, s: 0 };
  const key = { YYYY: "y", MM: "mo", DD: "d", HH: "h", mm: "mi", ss: "s" };
  tokens.forEach((t, i) => (parts[key[t]] = Number(m[i + 1])));
  return parts;
}

/** Write date parts in a pattern, "ISO", "epoch-ms" or "epoch-s". */
function formatDateWith(p, pattern) {
  const pad = (n, w) => String(n).padStart(w, "0");
  if (pattern === "ISO") return p.y + "-" + pad(p.mo, 2) + "-" + pad(p.d, 2) + "T" + pad(p.h, 2) + ":" + pad(p.mi, 2) + ":" + pad(p.s, 2) + "Z";
  if (pattern === "epoch-ms" || pattern === "epoch-s") {
    const ms = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    return pattern === "epoch-s" ? Math.floor(ms / 1000) : ms;
  }
  return pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) =>
    t === "YYYY" ? pad(p.y, 4) : t === "MM" ? pad(p.mo, 2) : t === "DD" ? pad(p.d, 2) : t === "HH" ? pad(p.h, 2) : t === "mm" ? pad(p.mi, 2) : pad(p.s, 2),
  );
}

/** "19.99" -> 19.99, "true" -> true; other text stays text. */
function stepScalar(text) {
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text) && text.length <= 15) return Number(text);
  return text;
}

/** Run one step. A step that can't apply (a date that doesn't match, text that isn't a number) leaves the value as it is. */
function applyStep(v, step) {
  switch (step.op) {
    case "trim": return typeof v === "string" ? v.trim() : v;
    case "upper": return typeof v === "string" ? v.toUpperCase() : v;
    case "lower": return typeof v === "string" ? v.toLowerCase() : v;
    case "title": return typeof v === "string" ? v.toLowerCase().replace(/(^|[\s\-'])(\S)/g, (_, a, b) => a + b.toUpperCase()) : v;
    case "substring": {
      if (v === undefined || v === null) return v;
      const t = stepText(v);
      const start = Math.max(0, Number(step.start) || 0);
      return step.length === undefined || step.length === null || step.length === "" ? t.slice(start) : t.slice(start, start + Math.max(0, Number(step.length) || 0));
    }
    case "replace": return v === undefined || v === null || !step.find ? v : stepText(v).split(step.find).join(step.with ?? "");
    case "prefix": return v === undefined || v === null ? v : (step.text ?? "") + stepText(v);
    case "suffix": return v === undefined || v === null ? v : stepText(v) + (step.text ?? "");
    case "date": {
      const parts = parseDateWith(v, step.from || "ISO");
      return parts ? formatDateWith(parts, step.to || "ISO") : v;
    }
    case "number": {
      const n = typeof v === "number" ? v : Number(stepText(v).trim());
      if (v === undefined || v === null || stepText(v).trim() === "" || !Number.isFinite(n)) return v;
      let out = n * (step.multiply === undefined || step.multiply === "" ? 1 : Number(step.multiply)) + (step.add === undefined || step.add === "" ? 0 : Number(step.add));
      if (step.decimals !== undefined && step.decimals !== "" && step.decimals !== null) {
        const f = Math.pow(10, Number(step.decimals));
        out = Math.round(out * f) / f;
      }
      return out;
    }
    case "default": return v === undefined || v === null || v === "" ? stepScalar(step.value ?? "") : v;
    case "if": {
      const t = stepText(v);
      const a = Number(t);
      const b = Number(step.value);
      const numeric = t.trim() !== "" && String(step.value).trim() !== "" && !Number.isNaN(a) && !Number.isNaN(b);
      const holds =
        step.test === "empty" ? t === "" :
        step.test === "equals" ? (numeric ? a === b : t.toLowerCase() === String(step.value).toLowerCase()) :
        step.test === "not-equals" ? !(numeric ? a === b : t.toLowerCase() === String(step.value).toLowerCase()) :
        step.test === "contains" ? t.toLowerCase().includes(String(step.value).toLowerCase()) :
        step.test === "gt" ? numeric && a > b :
        step.test === "lt" ? numeric && a < b : false;
      const pick = holds ? step.then : step.else;
      // An empty "then"/"else" keeps the value as it is.
      return pick === undefined || pick === "" ? v : stepScalar(pick);
    }
    case "toString": return v === undefined || v === null ? v : stepText(v);
    case "toNumber": {
      const n = Number(stepText(v).trim());
      return v === undefined || v === null || stepText(v).trim() === "" || Number.isNaN(n) ? v : n;
    }
    case "toBoolean": {
      const t = stepText(v).trim().toLowerCase();
      return ["true", "yes", "y", "1"].includes(t) ? true : ["false", "no", "n", "0"].includes(t) ? false : v;
    }
    default: return v;
  }
}

/** Run every step, top to bottom. */
function applySteps(v, steps) {
  return (steps || []).reduce((acc, step) => applyStep(acc, step), v);
}
`;

/** The shared JavaScript, compiled once. */
export const applySteps: (value: Json, steps: Step[]) => Json = new Function(`${STEPS_SOURCE}\nreturn applySteps;`)();

const q = (s: string) => JSON.stringify(s);

/** One step in words: "date ISO → DD/MM/YYYY", "if = 402 then PAY else keep". */
export function describeStep(s: Step): string {
  switch (s.op) {
    case "trim": return "trim spaces";
    case "upper": return "upper case";
    case "lower": return "lower case";
    case "title": return "title case";
    case "substring": return s.length === undefined ? `characters from ${s.start + 1}` : `${s.length} characters from ${s.start + 1}`;
    case "replace": return `replace ${q(s.find)} with ${q(s.with)}`;
    case "prefix": return `add ${q(s.text)} before`;
    case "suffix": return `add ${q(s.text)} after`;
    case "date": return `date ${s.from} → ${s.to}`;
    case "number": {
      const parts = [s.multiply !== undefined && `× ${s.multiply}`, s.add !== undefined && `+ ${s.add}`, s.decimals !== undefined && `round to ${s.decimals} decimals`].filter(Boolean);
      return parts.length ? `number ${parts.join(", ")}` : "number";
    }
    case "default": return `${q(s.value)} when empty`;
    case "if": {
      const test = { equals: "=", "not-equals": "≠", contains: "contains", empty: "is empty", gt: ">", lt: "<" }[s.test];
      return `if ${test}${s.test === "empty" ? "" : ` ${q(s.value)}`} then ${s.then === "" ? "keep" : q(s.then)} else ${s.else === "" ? "keep" : q(s.else)}`;
    }
    case "toString": return "to text";
    case "toNumber": return "to number";
    case "toBoolean": return "to true/false";
  }
}

export const describeSteps = (steps: Step[] | undefined) => (steps ?? []).map(describeStep).join(" → ");
