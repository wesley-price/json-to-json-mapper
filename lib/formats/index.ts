// One entry point for reading and writing each supported file format.

import type { Json } from "../json-tree";
import { parseCsv, toCsv } from "./csv";
import { type FlatLayout, defaultFlatLayout, parseFlat, toFlat } from "./flat";
import { parseXml, toXml } from "./xml";

export type Format = "json" | "xml" | "csv" | "flat";

export const FORMATS: { id: Format; label: string; extension: string; mime: string }[] = [
  { id: "json", label: "JSON", extension: "json", mime: "application/json" },
  { id: "xml", label: "XML", extension: "xml", mime: "application/xml" },
  { id: "csv", label: "CSV", extension: "csv", mime: "text/csv" },
  { id: "flat", label: "Flat file", extension: "txt", mime: "text/plain" },
];

export const formatInfo = (format: Format) => FORMATS.find((f) => f.id === format) ?? FORMATS[0];

export const PLACEHOLDERS: Record<Format, string> = {
  json: '{\n  "id": 1,\n  "name": "Ada"\n}',
  xml: '<order id="1">\n  <customer>Ada</customer>\n  <item sku="A-1">2</item>\n</order>',
  csv: "id,name,city\n1,Ada,London\n2,Grace,New York",
  flat: "H|20261018|ACME\nD|A-1|19.99\nD|A-2|5.50\nT|2",
};

export interface ReadResult {
  data: Json;
  warnings: string[];
}

export function readFormat(format: Format, text: string, layout: FlatLayout = defaultFlatLayout()): ReadResult {
  if (format === "xml") return { data: parseXml(text), warnings: [] };
  if (format === "csv") return { data: parseCsv(text), warnings: [] };
  if (format === "flat") return parseFlat(text, layout);
  const data = JSON.parse(text) as Json;
  if (typeof data !== "object" || data === null) throw new Error("Top level must be an object or array.");
  return { data, warnings: [] };
}

export function writeFormat(format: Format, data: Json, layout: FlatLayout = defaultFlatLayout()): string {
  if (format === "xml") return toXml(data);
  if (format === "csv") return toCsv(data);
  if (format === "flat") return toFlat(data, layout);
  return JSON.stringify(data, null, 2);
}

export { defaultFlatLayout };
export type { FlatLayout };
