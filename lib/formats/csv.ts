// CSV <-> JSON tree.
//
//   id,name,customer.city        [ { id: 1, name: "Ada", customer: { city: "London" } },
//   1,Ada,London           <->     { id: 2, name: "Grace", customer: { city: "NYC" } } ]
//   2,Grace,NYC
//
// The first line holds the column names; every other line is one record.
// Dotted column names become nested fields, and nested fields are written
// back as dotted columns. Quoting follows RFC 4180 ("a, b", "say ""hi""").

import { type Json, flatten, parsePathLabel, unflatten } from "../json-tree";
import { inferScalar } from "./xml";

/** Split CSV text into rows of cells, honouring quotes (which may span lines). */
function readRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Ignore blank lines.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function parseCsv(text: string): Json[] {
  const rows = readRows(text.replace(/^﻿/, "")); // drop a byte-order mark
  if (rows.length === 0) throw new Error("The CSV is empty.");
  const [header, ...records] = rows;
  const columns = header.map((name, i) => {
    const label = name.trim() || `column${i + 1}`;
    try {
      return parsePathLabel(label);
    } catch {
      return [label]; // not a path; use the name as-is
    }
  });
  if (records.length === 0) {
    // Only column names: one blank record so the columns show up as fields.
    return [unflatten(columns.map((path) => [path, ""])) as Json];
  }
  return records.map((cells) => unflatten(columns.map((path, i) => [path, inferScalar((cells[i] ?? "").trim())])));
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;
}

const cellText = (v: Json) => (v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Records of the data: a list as-is, otherwise the object as a single record. */
function recordsOf(data: Json): Json[] {
  return Array.isArray(data) ? data : [data];
}

export function toCsv(data: Json): string {
  const flat = recordsOf(data).map((r) => (typeof r === "object" && r !== null ? flatten(r) : { value: r }));
  // Columns in order of first appearance across all records.
  const columns: string[] = [];
  for (const record of flat) for (const key of Object.keys(record)) if (!columns.includes(key)) columns.push(key);
  const lines = [
    columns.map(quote).join(","),
    ...flat.map((record) => columns.map((c) => quote(cellText(record[c] ?? ""))).join(",")),
  ];
  return lines.join("\n") + "\n";
}
