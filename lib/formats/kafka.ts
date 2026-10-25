// Kafka events as a format: the record envelope as mappable parts.
//   { "topic": "orders", "key": "A-1001", "headers": { "event-type": "OrderPlaced" },
//     "timestamp": "2026-10-18T09:30:00Z", "value": { …payload… } }
// A plain payload (no envelope) is wrapped as the value. A value that is an
// Avro schema expands to an example payload. Written back as JSON.

import type { Json } from "../json-tree";
import { avroExample, avroFieldTypes, isAvroSchema, toAvro } from "./avro";
import { bigNumberNote, parseJsonLossless } from "./lossless";

const ENVELOPE = ["topic", "partition", "offset", "key", "headers", "timestamp", "value"];

type Obj = { [key: string]: Json };
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** `notes`: collects a note for each integer too large for JavaScript (kept as text). */
export function parseKafka(text: string, notes: string[] = []): Json {
  const { value: v, big } = parseJsonLossless(text);
  notes.push(...big.map(bigNumberNote));
  if (!isObj(v)) throw new Error("A Kafka event is a JSON object (the envelope, or just the payload).");
  const isEnvelope = "value" in v && Object.keys(v).every((k) => ENVELOPE.includes(k));
  const env: Obj = isEnvelope ? v : { value: v };
  const value = env.value ?? {};
  return {
    topic: env.topic ?? "",
    key: env.key ?? "",
    headers: isObj(env.headers) ? env.headers : {},
    timestamp: env.timestamp ?? "",
    ...("partition" in env ? { partition: env.partition } : {}),
    ...("offset" in env ? { offset: env.offset } : {}),
    value: valueOf(value),
  };
}

/** A value that is a schema/example pair keeps its example; a bare schema expands to one. */
function valueOf(value: Json): Json {
  if (isObj(value) && isObj(value.schema) && "example" in value) return value.example;
  return isAvroSchema(value) ? avroExample(value) : value;
}

/** The Avro schema an event's value was defined with (in an earlier text of the event), if any. */
function valueSchema(like: string | undefined): Json | null {
  if (!like) return null;
  try {
    const v = JSON.parse(like) as Json;
    return isObj(v) && isAvroSchema(v.value) ? v.value : null;
  } catch {
    return null;
  }
}

/** `like`: an earlier text of the event; an Avro schema in its value is kept (the value is written as schema + example). */
export function toKafka(data: Json, like?: string): string {
  const schema = valueSchema(like);
  if (!schema || !isObj(data)) return JSON.stringify(data, null, 2);
  return JSON.stringify({ ...data, value: JSON.parse(toAvro(data.value ?? {}, JSON.stringify(schema))) }, null, 2);
}

/** Field types from an Avro schema in the event's value (paths start with "value"). */
export function kafkaFieldTypes(text: string): Map<string, string> {
  const schema = valueSchema(text);
  return schema ? avroFieldTypes(JSON.stringify(schema), ["value"]) : new Map();
}
