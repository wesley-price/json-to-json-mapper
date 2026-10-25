// One entry point for reading and writing each supported file format.

import type { Json } from "../json-tree";
import { parseCsv, toCsv } from "./csv";
import { type FlatLayout, defaultFlatLayout, parseFlat, toFlat } from "./flat";
import { avroFieldTypes, parseAvro, toAvro } from "./avro";
import { kafkaFieldTypes, parseKafka, toKafka } from "./kafka";
import { jsonSchemaFieldTypes, parseJsonSchema, toJsonSchema } from "./jsonschema";
import { declaredTypes, parseTable, toTable } from "./table";
import { parseXml, toXml } from "./xml";
import { bigNumberNote, parseJsonLossless } from "./lossless";

export type Format = "json" | "xml" | "csv" | "flat" | "table" | "avro" | "kafka" | "jsonschema";

export const FORMATS: { id: Format; label: string; extension: string; mime: string }[] = [
  { id: "json", label: "JSON", extension: "json", mime: "application/json" },
  { id: "xml", label: "XML", extension: "xml", mime: "application/xml" },
  { id: "csv", label: "CSV", extension: "csv", mime: "text/csv" },
  { id: "flat", label: "Flat file", extension: "txt", mime: "text/plain" },
  { id: "table", label: "Table (SQL)", extension: "sql", mime: "application/sql" },
  { id: "avro", label: "Avro schema", extension: "avsc", mime: "application/json" },
  { id: "kafka", label: "Kafka event", extension: "json", mime: "application/json" },
  { id: "jsonschema", label: "JSON Schema", extension: "json", mime: "application/schema+json" },
];

export const formatInfo = (format: Format) => FORMATS.find((f) => f.id === format) ?? FORMATS[0];

export const PLACEHOLDERS: Record<Format, string> = {
  json: '{\n  "id": 1,\n  "name": "Ada"\n}',
  xml: '<order id="1">\n  <customer>Ada</customer>\n  <item sku="A-1">2</item>\n</order>',
  csv: "id,name,city\n1,Ada,London\n2,Grace,New York",
  flat: "H|20261018|ACME\nD|A-1|19.99\nD|A-2|5.50\nT|2",
  table:
    "CREATE TABLE orders (\n  order_id VARCHAR(20) PRIMARY KEY,\n  total NUMERIC(10,2),\n  paid BOOLEAN\n);\nINSERT INTO orders VALUES ('A-1001', 25.48, TRUE);\n\n(or paste a grid copied from a spreadsheet or SQL client, header row first)",
  avro: '{\n  "type": "record",\n  "name": "OrderPlaced",\n  "fields": [\n    { "name": "orderId", "type": "string" },\n    { "name": "note", "type": ["null", "string"], "default": null }\n  ]\n}',
  kafka:
    '{\n  "topic": "orders",\n  "key": "A-1001",\n  "headers": { "event-type": "OrderPlaced" },\n  "value": { "orderId": "A-1001", "total": 25.48 }\n}\n\n(or just the payload; "value" can also be an Avro schema)',
  jsonschema:
    '{\n  "type": "object",\n  "required": ["orderId"],\n  "properties": {\n    "orderId": { "type": "string" },\n    "placedAt": { "type": "string", "format": "date-time" }\n  }\n}\n\n(JSON or YAML; ☰ Menu → Import from OpenAPI picks schemas from an API spec)',
};

export interface ReadResult {
  data: Json;
  warnings: string[];
}

export function readFormat(format: Format, text: string, layout: FlatLayout = defaultFlatLayout()): ReadResult {
  if (format === "xml") return { data: parseXml(text), warnings: [] };
  if (format === "csv") return { data: parseCsv(text), warnings: [] };
  if (format === "flat") return parseFlat(text, layout);
  // Notes about integers too large for JavaScript, kept as text (see lossless.ts).
  const notes: string[] = [];
  if (format === "table") return { data: parseTable(text, notes), warnings: notes };
  if (format === "avro") return { data: parseAvro(text, notes), warnings: notes };
  if (format === "kafka") return { data: parseKafka(text, notes), warnings: notes };
  if (format === "jsonschema") return { data: parseJsonSchema(text, notes), warnings: notes };
  const { value: data, big } = parseJsonLossless(text);
  if (typeof data !== "object" || data === null) throw new Error("Top level must be an object or array.");
  return { data, warnings: big.map(bigNumberNote) };
}

/** `like`: an earlier text of the same object, whose details are kept where the format allows (a table's column types). */
export function writeFormat(format: Format, data: Json, layout: FlatLayout = defaultFlatLayout(), like?: string): string {
  if (format === "xml") return toXml(data);
  if (format === "csv") return toCsv(data);
  if (format === "flat") return toFlat(data, layout);
  if (format === "table") return toTable(data, like);
  if (format === "avro") return toAvro(data, like);
  if (format === "kafka") return toKafka(data, like);
  if (format === "jsonschema") return toJsonSchema(data, like);
  return JSON.stringify(data, null, 2);
}

/**
 * Declared types from the schema an object was defined with (a table's CREATE TABLE,
 * an Avro schema, a Kafka event's Avro value), keyed by path JSON ("[]" for list items).
 * Empty for formats without a schema.
 */
export function schemaTypes(format: Format, text: string | undefined): Map<string, string> {
  if (!text) return new Map();
  if (format === "avro") return avroFieldTypes(text);
  if (format === "kafka") return kafkaFieldTypes(text);
  if (format === "jsonschema") return jsonSchemaFieldTypes(text);
  if (format === "table") {
    const out = new Map<string, string>();
    for (const [key, type] of declaredTypes(text)) {
      const dot = key.indexOf(".");
      out.set(JSON.stringify([key.slice(0, dot), key.slice(dot + 1)]), type);
    }
    return out;
  }
  return new Map();
}

export { defaultFlatLayout };
export type { FlatLayout };
