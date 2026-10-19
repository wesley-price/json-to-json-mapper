// Test cases for whoever implements the mapping: every sample, example and
// extra value as an exact input with its expected output. Printed in the
// report's appendix and downloadable as JSON for unit tests.

import type { Headers } from "@/lib/headers";
import type { Json } from "@/lib/json-tree";

export interface TestCase {
  /** "TC1", "TC2"… (numbered across the whole report). */
  id: string;
  /** "Payments API · sample", "Payments API · Card expired", "Payments API · errorMessage = …" */
  title: string;
  /** The scenario it belongs to (several scenarios only). */
  scenario?: string;
  /** The source it comes from (multi-source only). */
  source?: string;
  /** The case it should use (multi-source only). */
  caseName?: string;
  input: { body: Json; headers?: Headers; text: string };
  /** What the implementation must produce; absent when no case matches. */
  expected?: { body: Json; headers?: Headers; text: string };
  /** Why there is no expected output (e.g. no case matches). */
  error?: string;
}

/** A test case before numbering. */
export type TestCaseDraft = Omit<TestCase, "id">;

export const numberCases = (drafts: TestCaseDraft[], start = 1): TestCase[] =>
  drafts.map((d, i) => ({ id: `TC${start + i}`, ...d }));

/** Headers worth showing (none when empty). */
export const someHeaders = (h: Headers | undefined) => (h && Object.keys(h).length ? h : undefined);

/** The machine-readable file: inputs and expected outputs as JSON. */
export function testCasesFile(docName: string, version: string, cases: TestCase[]): string {
  return JSON.stringify(
    {
      document: docName || "Mapping",
      ...(version ? { version } : {}),
      generated: new Date().toISOString(),
      note: "Each test case is an input and the output the implementation must produce. Values come from the mapper's samples.",
      testCases: cases.map((c) => ({
        id: c.id,
        title: c.title,
        ...(c.scenario ? { scenario: c.scenario } : {}),
        ...(c.source ? { source: c.source } : {}),
        ...(c.caseName ? { case: c.caseName } : {}),
        input: { ...(c.input.headers ? { headers: c.input.headers } : {}), body: c.input.body },
        ...(c.expected
          ? { expected: { ...(c.expected.headers ? { headers: c.expected.headers } : {}), body: c.expected.body } }
          : { expectedError: c.error ?? "No output" }),
      })),
    },
    null,
    2,
  );
}
