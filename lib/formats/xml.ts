// XML <-> JSON tree.
//
// Conventions (the common "Badgerfish-lite" shape):
//   <order id="7"><item>a</item><item>b</item><note>hi</note></order>
//   -> { order: { "@id": 7, item: ["a", "b"], note: "hi" } }
// - attributes become "@name" fields
// - repeated sibling elements become a list
// - text next to attributes/children becomes "#text"
// - numbers and booleans are detected; codes with leading zeros (02134) stay
//   strings

import type { Json } from "../json-tree";

export const ATTR_PREFIX = "@";
export const TEXT_KEY = "#text";

type Obj = { [key: string]: Json };

/**
 * "19.99" / "5.50" -> numbers, "true" -> true. Codes with leading zeros
 * ("02134"), signs, exponents or spaces stay strings.
 */
export function inferScalar(text: string): Json {
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text) && text.length <= 15) return Number(text);
  return text;
}

export function parseXml(text: string): Json {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) {
    const detail = (error.textContent ?? "").split("\n").find((l) => l.trim()) ?? "invalid XML";
    throw new Error(`Couldn't read the XML: ${detail.trim()}`);
  }
  const root = doc.documentElement;
  return { [root.nodeName]: readElement(root) };
}

function readElement(el: Element): Json {
  const obj: Obj = {};
  for (const attr of Array.from(el.attributes)) {
    obj[ATTR_PREFIX + attr.name] = inferScalar(attr.value);
  }

  let text = "";
  let hasChildElements = false;
  const repeated = new Set<string>(); // element names already turned into a list
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      hasChildElements = true;
      const child = node as Element;
      const value = readElement(child);
      const name = child.nodeName;
      if (!(name in obj)) obj[name] = value;
      else if (repeated.has(name)) (obj[name] as Json[]).push(value);
      else {
        obj[name] = [obj[name], value];
        repeated.add(name);
      }
    } else if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      text += node.nodeValue ?? "";
    }
  }
  const trimmed = text.trim();
  const hasAttrs = el.attributes.length > 0;
  if (!hasAttrs && !hasChildElements) return inferScalar(trimmed);
  if (trimmed) obj[TEXT_KEY] = inferScalar(trimmed);
  return obj;
}

// ---------- Writing ----------

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

/** XML names can't contain spaces etc.; replace anything invalid with "_". */
function xmlName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_.:-]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

const scalar = (v: Json) => (v === null ? "" : String(v));

export function toXml(data: Json): string {
  const isObj = typeof data === "object" && data !== null && !Array.isArray(data);
  const keys = isObj ? Object.keys(data as Obj) : [];
  // A single top-level key is the root element; otherwise wrap in <root>.
  const body =
    isObj && keys.length === 1 && !keys[0].startsWith(ATTR_PREFIX)
      ? writeElement(keys[0], (data as Obj)[keys[0]], "")
      : writeElement("root", data, "");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
}

function writeElement(name: string, value: Json, indent: string): string {
  const tag = xmlName(name);
  if (Array.isArray(value)) {
    // A list is written as repeated elements with the same name.
    return value.map((v) => writeElement(name, v, indent)).join("\n");
  }
  if (value === null || typeof value !== "object") {
    const text = scalar(value);
    return text === "" ? `${indent}<${tag}/>` : `${indent}<${tag}>${escapeText(text)}</${tag}>`;
  }
  const attrs: string[] = [];
  const children: string[] = [];
  let text = "";
  for (const [key, v] of Object.entries(value)) {
    if (key.startsWith(ATTR_PREFIX)) attrs.push(` ${xmlName(key.slice(1))}="${escapeAttr(scalar(v))}"`);
    else if (key === TEXT_KEY) text = scalar(v);
    else children.push(writeElement(key, v, indent + "  "));
  }
  const open = `${indent}<${tag}${attrs.join("")}`;
  if (children.length === 0) return text === "" ? `${open}/>` : `${open}>${escapeText(text)}</${tag}>`;
  const inner = (text ? `${indent}  ${escapeText(text)}\n` : "") + children.join("\n");
  return `${open}>\n${inner}\n${indent}</${tag}>`;
}
