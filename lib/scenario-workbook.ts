// A workbook holding several scenarios (independent mappings such as a 200
// response and a 422 response). Each scenario's own workbook (single-pair or
// multi-source) is kept whole, with its sheet names prefixed "1. ", "2. ", …
// A "Scenarios" sheet lists them.

import type { WorkbookMode } from "./workbook";
import type { Sheet } from "./xlsx";

export interface ScenarioSheets {
  name: string;
  mode: WorkbookMode;
  sheets: Sheet[];
}

const prefix = (n: number) => `${n}. `;

export function buildScenariosWorkbook(docName: string, scenarios: ScenarioSheets[]): Sheet[] {
  return [
    {
      name: "Document",
      rows: [
        ["Property", "Value"],
        ["Name", docName],
        ["Mode", "scenarios"],
        ["Scenarios", scenarios.length],
      ],
    },
    {
      name: "Scenarios",
      rows: [
        ["#", "Name", "Mode", "Sheets"],
        ...scenarios.map((s, i) => [i + 1, s.name, s.mode === "multi" ? "multi-source" : "single pair", `${prefix(i + 1)}…`]),
      ],
    },
    ...scenarios.flatMap((s, i) => s.sheets.map((sheet) => ({ ...sheet, name: prefix(i + 1) + sheet.name }))),
  ];
}

export const isScenariosWorkbook = (sheets: Sheet[]) => sheets.some((s) => s.name.toLowerCase() === "scenarios");

/** Each scenario's name and its sheets with their original names. */
export function parseScenariosWorkbook(sheets: Sheet[]): { name: string; sheets: Sheet[] }[] {
  const list = sheets.find((s) => s.name.toLowerCase() === "scenarios");
  if (!list) return [];
  return list.rows
    .slice(1)
    .map((row) => ({ n: Number(row[0]), name: String(row[1] ?? "").trim() }))
    .filter((r) => Number.isInteger(r.n) && r.n > 0)
    .map(({ n, name }) => ({
      name: name || `Scenario ${n}`,
      sheets: sheets
        .filter((s) => s.name.startsWith(prefix(n)))
        .map((s) => ({ ...s, name: s.name.slice(prefix(n).length) })),
    }))
    .filter((s) => s.sheets.length > 0);
}
