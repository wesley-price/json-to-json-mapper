// Scenarios: one document holding several independent mappings (e.g. a 200
// response and a 422 response). The report covers them all: a contents page,
// then each scenario's own single-pair or multi-source report.

import { type ReportModel, type Saved, buildReport } from "./model";
import { type MultiReportModel, type SavedMulti, buildMultiReport } from "./multi-model";
import type { Spec } from "@/lib/spec";
import { type TestCase, numberCases } from "./test-cases";

/** A saved scenario (see ScenarioState in ObjectMapper). */
type SavedScenario = Omit<SavedMulti, "docName"> & Saved & { id: string; name: string };

export interface ScenarioReport {
  n: number;
  name: string;
  /** When the report was made (the same for every scenario). */
  generated: Date;
  /** Prefix for the scenario's diagram ids, so they stay unique across the page. */
  prefix: string;
  single: ReportModel | null;
  multi: MultiReportModel | null;
  /** "Order -> Invoice" / "Error standard <- 2 sources" */
  objects: string;
  /** "4 mappings - 5 of 7 target fields mapped" */
  counts: string;
}

export function buildScenarioReports(saved: {
  scenarios?: SavedScenario[];
  docName?: string;
  spec?: Partial<Spec>;
}): ScenarioReport[] | null {
  if (!Array.isArray(saved.scenarios) || saved.scenarios.length < 2) return null;
  const generated = new Date();
  return saved.scenarios.map((sc, i) => {
    const prefix = `s${i + 1}:`;
    const base = { n: i + 1, name: sc.name || `Scenario ${i + 1}`, prefix, generated };
    if (sc.multi?.enabled) {
      const multi = buildMultiReport({ ...sc, docName: sc.name, spec: saved.spec });
      return {
        ...base,
        single: null,
        multi,
        objects: multi
          ? `${multi.standard.name} <- ${multi.sources.length} source${multi.sources.length === 1 ? "" : "s"}`
          : "Nothing to report yet",
        counts: multi ? `${multi.caseCount} cases - ${multi.mappingCount} mappings - ${multi.gapCount} coverage gaps` : "",
      };
    }
    const single = buildReport({ ...sc, spec: saved.spec });
    const count = single ? single.singles.length + single.combined.length : 0;
    return {
      ...base,
      single,
      multi: null,
      objects: single ? `${single.sourceName} -> ${single.targetName}` : "Nothing to report yet",
      counts: single
        ? `${count} mapping${count === 1 ? "" : "s"} - ${single.mappedLeafCount} of ${single.targetLeafCount} target fields mapped`
        : "",
    };
  });
}

/** Every scenario's test cases, numbered across the whole report. */
export function allTestCases(scenarios: ScenarioReport[]): TestCase[] {
  return numberCases(
    scenarios.flatMap((sc) =>
      (sc.single?.testCases ?? sc.multi?.testCases ?? []).map(({ id: _id, ...c }) => {
        void _id;
        return { ...c, scenario: sc.name };
      }),
    ),
  );
}
