"use client";

// Settings for reading/writing a flat (header / body / footer) file, edited
// live: each section shows its columns next to sample values, so fields are
// named where you can see them. Fixed-width columns are set by clicking on a
// ruler over a sample line. Changes apply as you go (no Apply button).

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Json } from "@/lib/json-tree";
import {
  type Delimiter,
  type FlatLayout,
  type FlatSection,
  SECTIONS,
  type SectionName,
  detectLayout,
  guessBreaks,
  sectionLines,
  splitRecord,
  widthsFromBreaks,
} from "@/lib/formats/flat";

const DELIMITERS: { id: Delimiter; label: string }[] = [
  { id: "|", label: "| pipe" },
  { id: ",", label: ", comma" },
  { id: "\t", label: "tab" },
  { id: ";", label: "; semicolon" },
  { id: "fixed", label: "fixed width" },
];

const delimiterLabel = (d: Delimiter) => DELIMITERS.find((x) => x.id === d)?.label ?? d;
const isDefaultName = (n: string | undefined) => !n || /^field\d+$/.test(n);
/** Typing pauses this long before the file is re-read / re-written. */
const LIVE_DELAY = 350;
const SAMPLE_RECORDS = 3;

interface Props {
  layout: FlatLayout;
  /** Source files are read with the layout; target files are written with it. */
  role: "source" | "target";
  /** The pasted file (source), for samples, detection and the ruler. */
  text: string;
  /** The object (target), for sample values. */
  data: Json | null;
  /** Field names currently in the data, per section. */
  currentFields: Record<SectionName, string[]>;
  /** False when the object has no header/body/footer to write. */
  hasSections: boolean;
  onApply: (layout: FlatLayout) => void;
  onAddSections: () => void;
  /** Top-level fields outside header / body / footer (not written to the file). */
  strayFields: string[];
  onMoveStray: (into: "body" | "header") => void;
  /** Rewrite the file with a new layout, keeping the data (instead of re-reading the text with it). */
  onConvert: (layout: FlatLayout) => void;
}

const cellText = (v: Json | undefined) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function FlatLayoutEditor({ layout, role, text, data, currentFields, hasSections, onApply, onAddSections, strayFields, onMoveStray, onConvert }: Props) {
  const source = role === "source";
  const unnamed = source && SECTIONS.some((s) => layout[s].enabled && (layout[s].fields.length === 0 || layout[s].fields.some(isDefaultName)));
  // Closed until asked for (unnamed fields are flagged on the bar instead).
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(layout);
  const lastSent = useRef(JSON.stringify(layout));
  const timer = useRef<number | undefined>(undefined);

  // Outside changes (a new file, undo, tree renames) replace the draft; our own echoes don't.
  useEffect(() => {
    const json = JSON.stringify(layout);
    if (json !== lastSent.current) {
      lastSent.current = json;
      setDraft(layout);
    }
  }, [layout]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /** Change the layout and apply it after a short pause (immediately for clicks). */
  const change = (next: FlatLayout, now = false) => {
    setDraft(next);
    window.clearTimeout(timer.current);
    const send = () => {
      lastSent.current = JSON.stringify(next);
      onApply(next);
    };
    if (now) send();
    else timer.current = window.setTimeout(send, LIVE_DELAY);
  };
  const setSection = (name: SectionName, patch: Partial<FlatSection>, now = false) =>
    change({ ...draft, [name]: { ...draft[name], ...patch } }, now);

  // A loaded source asked for another separator: convert the file, or re-read it?
  const [pendingSep, setPendingSep] = useState<Delimiter | null>(null);
  const loaded = source && data !== null && text.trim() !== "";
  const pickSeparator = (d: Delimiter) => {
    if (d === draft.delimiter) return setPendingSep(null);
    if (loaded) setPendingSep(d);
    else change({ ...draft, delimiter: d }, true);
  };
  const fixed = draft.delimiter === "fixed";
  const lines = useMemo(() => (source && text.trim() ? sectionLines(text, draft) : null), [source, text, draft]);
  const totalLines = useMemo(() => text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim()).length, [text]);
  const sorted = lines ? SECTIONS.reduce((n, s) => n + (draft[s].enabled ? lines[s].length : 0), 0) : 0;
  const skipped = source && draft.identifyBy === "code" ? totalLines - sorted : 0;

  const summary = `${delimiterLabel(layout.delimiter)} · records by ${layout.identifyBy === "code" ? "code" : "position"} · ${SECTIONS.filter((s) => layout[s].enabled).join(" / ")}`;

  return (
    <div className="border-b border-zinc-200 bg-zinc-50/60 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">File layout</span>
        <span className="text-zinc-500">{summary}</span>
        {!open && unnamed && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">some fields are unnamed</span>
        )}
        <button onClick={() => setOpen((o) => !o)} className="ml-auto text-blue-600 hover:underline dark:text-blue-400" aria-expanded={open}>
          {open ? "Done" : unnamed ? "Name the fields" : "Edit layout"}
        </button>
      </div>

      {strayFields.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>
            {strayFields.length === 1 ? "1 field sits" : `${strayFields.length} fields sit`} outside <code>header</code> / <code>body</code> / <code>footer</code>, so{" "}
            {strayFields.length === 1 ? "it isn't" : "they aren't"} in the file: <code>{strayFields.slice(0, 6).join(", ")}{strayFields.length > 6 ? ", …" : ""}</code>.
          </span>
          <button onClick={() => onMoveStray("body")} className="rounded bg-amber-600 px-1.5 py-0.5 font-medium text-white hover:bg-amber-700">
            Move into body (each record)
          </button>
          <button onClick={() => onMoveStray("header")} className="rounded border border-amber-400 px-1.5 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-900">
            Move into header
          </button>
          <span className="text-amber-800/80 dark:text-amber-300/80">or drag them one by one onto a section below.</span>
        </div>
      ) : (
        role === "target" &&
        !hasSections && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            A flat file is written from <code>header</code>, <code>body</code> (a list) and <code>footer</code> fields, and this object has none yet.{" "}
            <button onClick={onAddSections} className="font-medium underline">
              Add header, body &amp; footer
            </button>
          </p>
        )
      )}

      {open && (
        <div className="mt-2 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1">
              Fields separated by
              <select
                value={pendingSep ?? draft.delimiter}
                onChange={(e) => pickSeparator(e.target.value as Delimiter)}
                aria-label="Field separator"
                className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {DELIMITERS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              Records told apart by
              <select
                value={draft.identifyBy}
                onChange={(e) => change({ ...draft, identifyBy: e.target.value as FlatLayout["identifyBy"] }, true)}
                aria-label="Records told apart by"
                className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="position">position (first line = header, last = footer)</option>
                <option value="code">a record code at the start of each line</option>
              </select>
            </label>
            {source && text.trim() && (
              <button
                onClick={() => change(detectLayout(text, draft), true)}
                className="rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                title="Guess the separator and record codes from the file again"
              >
                ✨ Detect
              </button>
            )}
            <span className="text-zinc-500">{source ? "Changes re-read the file as you go." : "Changes re-write the output as you go."}</span>
          </div>
          {fixed && source && (
            <p className="text-zinc-500">
              Fixed width: click a character on a ruler to start a new column there; click a column&apos;s first character again to join it to the one before.
            </p>
          )}

          {pendingSep && (
            <div role="group" aria-label="Change separator" className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-blue-950 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-100">
              <span>
                Change from <b>{delimiterLabel(draft.delimiter)}</b> to <b>{delimiterLabel(pendingSep)}</b>:
              </span>
              <button
                onClick={() => {
                  const next = { ...draft, delimiter: pendingSep };
                  lastSent.current = "";
                  setPendingSep(null);
                  onConvert(next);
                }}
                className="rounded bg-blue-600 px-1.5 py-0.5 font-medium text-white hover:bg-blue-700"
                title="Keep the data and mappings; the file is written again with the new separator"
              >
                Convert the file
              </button>
              <button
                onClick={() => {
                  setPendingSep(null);
                  change({ ...draft, delimiter: pendingSep }, true);
                }}
                className="rounded border border-blue-300 px-1.5 py-0.5 hover:bg-blue-100 dark:border-blue-800 dark:hover:bg-blue-900"
                title="The file really is separated this way: read the same text again with it"
              >
                Re-read it as {delimiterLabel(pendingSep)}
              </button>
              <button onClick={() => setPendingSep(null)} className="text-blue-700 hover:underline dark:text-blue-300">
                Cancel
              </button>
              <span className="w-full text-blue-900/70 dark:text-blue-200/70">
                Convert keeps the data and mappings and rewrites the file{pendingSep === "fixed" ? " (each field as long as its longest value)" : ""}. Re-read is for a file that was read with the wrong separator.
              </span>
            </div>
          )}

          {skipped > 0 && (
            <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {skipped} line{skipped === 1 ? "" : "s"} {skipped === 1 ? "doesn't" : "don't"} start with any of the record codes below and {skipped === 1 ? "is" : "are"} skipped.
            </p>
          )}

          {SECTIONS.map((name) => (
            <SectionEditor
              key={name}
              name={name}
              sec={draft[name]}
              byCode={draft.identifyBy === "code"}
              fixed={fixed}
              source={source}
              lines={lines?.[name] ?? []}
              layout={draft}
              targetFields={currentFields[name]}
              targetRecords={recordsIn(data, name)}
              onChange={(patch, now) => setSection(name, patch, now)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A section's records in the object (target samples). */
function recordsIn(data: Json | null, name: SectionName): Record<string, Json>[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return [];
  const v = (data as Record<string, Json>)[name];
  const list = Array.isArray(v) ? v : v !== undefined ? [v] : [];
  return list.filter((r): r is Record<string, Json> => typeof r === "object" && r !== null && !Array.isArray(r));
}

function SectionEditor({
  name,
  sec,
  byCode,
  fixed,
  source,
  lines,
  layout,
  targetFields,
  targetRecords,
  onChange,
}: {
  name: SectionName;
  sec: FlatSection;
  byCode: boolean;
  fixed: boolean;
  source: boolean;
  lines: string[];
  layout: FlatLayout;
  targetFields: string[];
  targetRecords: Record<string, Json>[];
  onChange: (patch: Partial<FlatSection>, now?: boolean) => void;
}) {
  // Columns: the source's are counted from its lines; the target's come from its fields.
  const samples: string[][] = source
    ? lines.slice(0, SAMPLE_RECORDS).map((l) => splitRecord(l, sec, layout))
    : targetRecords.slice(0, SAMPLE_RECORDS).map((r) => targetFields.map((f) => cellText(r[f])));
  const count = source ? Math.max(sec.fields.length, ...samples.map((s) => s.length), 0) : targetFields.length;
  const names = source ? Array.from({ length: count }, (_, i) => sec.fields[i] ?? "") : targetFields;

  /** Source: rename column i (width and position kept). */
  const rename = (i: number, value: string) => {
    const fields = Array.from({ length: count }, (_, j) => (j === i ? value.trim() : sec.fields[j] || `field${j + 1}`));
    // Fixed width: the width moves with the name.
    const widths: Record<string, number> = {};
    fields.forEach((f, j) => {
      const old = sec.fields[j] || `field${j + 1}`;
      if (sec.widths[old]) widths[f || `field${j + 1}`] = sec.widths[old];
    });
    onChange({ fields: fields.map((f, j) => f || `field${j + 1}`), widths });
  };
  /** Set or clear one field's length. */
  const setWidth = (field: string, w: number | null) => {
    const widths = { ...sec.widths };
    if (w && w > 0) widths[field] = w;
    else delete widths[field];
    onChange({ widths });
  };
  const keyOf = (i: number) => (source ? names[i] || `field${i + 1}` : names[i]);
  /** Every length at once ("3, 14, 5", e.g. from a spec). The source gains fields for extra lengths. */
  const setLengths = (lengths: number[]) => {
    const fields = source ? Array.from({ length: Math.max(count, lengths.length) }, (_, i) => names[i] || `field${i + 1}`) : names;
    const widths: Record<string, number> = {};
    fields.forEach((f, i) => {
      if (lengths[i] > 0) widths[f] = lengths[i];
    });
    onChange(source ? { fields, widths } : { widths });
  };
  const lengthsNow = names.map((_, i) => sec.widths[keyOf(i)] ?? "").join(", ").replace(/(, )+$/, "");
  const [lengthsText, setLengthsText] = useState(lengthsNow);
  const editingLengths = useRef(false);
  useEffect(() => {
    if (!editingLengths.current) setLengthsText(lengthsNow);
  }, [lengthsNow]);
  const total = names.reduce((n, _, i) => n + (sec.widths[keyOf(i)] ?? 0), 0);
  const lineLength = source && lines.length ? Math.max(...lines.map((l) => l.length)) : 0;
  const missing = fixed ? names.filter((_, i) => !sec.widths[keyOf(i)]).length : 0;

  return (
    <section className={`rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${sec.enabled ? "" : "opacity-60"}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-2 py-1 dark:border-zinc-800">
        <label className="flex items-center gap-1 font-medium capitalize">
          <input type="checkbox" checked={sec.enabled} onChange={(e) => onChange({ enabled: e.target.checked }, true)} />
          {name}
        </label>
        {byCode && sec.enabled && (
          <label className="flex items-center gap-1 text-zinc-500">
            code
            <input
              value={sec.code}
              onChange={(e) => onChange({ code: e.target.value })}
              aria-label={`${name} record code`}
              className="w-12 rounded border border-zinc-300 bg-white px-1 py-0.5 font-mono dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        )}
        {source && sec.enabled && (
          <span className="text-zinc-500">
            {lines.length} line{lines.length === 1 ? "" : "s"}
            {name !== "body" && lines.length > 1 ? " (only the first is read)" : ""}
          </span>
        )}
        {source && sec.enabled && (
          <button
            onClick={() => onChange({ fields: [...names.map((n, i) => n || `field${i + 1}`), `field${count + 1}`] }, true)}
            className="rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            title="Add a column (e.g. one your sample line doesn't fill)"
          >
            ＋ Add field
          </button>
        )}
        {fixed && source && sec.enabled && lines.length > 0 && (
          <button
            onClick={() => {
              const len = Math.max(...lines.map((l) => l.length));
              const widths = widthsFromBreaks(guessBreaks(lines), len);
              const fields = widths.map((_, i) => sec.fields[i] || `field${i + 1}`);
              onChange({ fields, widths: Object.fromEntries(fields.map((f, i) => [f, widths[i]])) }, true);
            }}
            className="ml-auto rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            title="Put a column break wherever every line has a gap"
          >
            ✨ Guess columns
          </button>
        )}
      </header>

      {sec.enabled && (
        <div className="flex flex-col gap-2 p-2">
          {fixed && source && lines.length > 0 && <Ruler line={lines[0]} sec={sec} onChange={onChange} />}
          {fixed && (source || count > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-300">
                Field lengths
                <input
                  value={lengthsText}
                  onFocus={() => (editingLengths.current = true)}
                  onBlur={() => {
                    editingLengths.current = false;
                    setLengthsText(lengthsNow);
                  }}
                  onChange={(e) => {
                    setLengthsText(e.target.value);
                    setLengths(e.target.value.split(/[\s,;]+/).filter(Boolean).map((x) => parseInt(x, 10) || 0));
                  }}
                  placeholder="e.g. 3, 14, 5"
                  aria-label={`${name} field lengths`}
                  className="w-48 rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-mono font-normal dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
              <span className="text-zinc-500">
                in order, separated by commas{source ? "; more lengths than fields add fields" : ""}.
                {total > 0 && (
                  <>
                    {" "}
                    Total {total}
                    {lineLength > 0 && total !== lineLength && (
                      <span className="text-amber-700 dark:text-amber-400">
                        {" "}
                        (the sample line is {lineLength}: {total < lineLength ? lineLength - total === 1 ? "the last character is left over" : `the last ${lineLength - total} characters are left over` : "lengths run past its end"})
                      </span>
                    )}
                  </>
                )}
                {missing > 0 && count > 0 && <span className="text-amber-700 dark:text-amber-400"> {missing} field{missing === 1 ? " has" : "s have"} no length yet; fields after the first gap aren&apos;t split.</span>}
              </span>
            </div>
          )}
          {count === 0 ? (
            <p className="text-zinc-500">
              {source
                ? lines.length === 0
                  ? "No lines belong to this section with the settings above."
                  : "Click the ruler to split the line into columns."
                : "No fields yet: add them in the tree."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="border-collapse font-mono">
                <thead>
                  <tr>
                    {names.map((n, i) => (
                      <th key={i} className="min-w-24 border-b border-zinc-200 px-1 pb-1 text-left align-bottom font-normal dark:border-zinc-700">
                        <span className="mb-0.5 block font-sans text-[10px] text-zinc-400">#{i + 1}</span>
                        {source ? (
                          <input
                            value={isDefaultName(n) ? "" : n}
                            placeholder={`field${i + 1}`}
                            onChange={(e) => rename(i, e.target.value)}
                            aria-label={`${name} column ${i + 1} name`}
                            className={`w-full min-w-20 rounded border bg-white px-1 py-0.5 font-sans dark:bg-zinc-950 ${
                              isDefaultName(n) ? "border-amber-300 dark:border-amber-800" : "border-zinc-300 dark:border-zinc-700"
                            }`}
                          />
                        ) : (
                          <span className="font-sans font-medium text-zinc-700 dark:text-zinc-300">{n}</span>
                        )}
                        {fixed && (
                          <label className="mt-1 flex items-center gap-1 font-sans text-[11px] text-zinc-500">
                            length
                            <input
                              type="number"
                              min={1}
                              value={sec.widths[keyOf(i)] ?? ""}
                              onChange={(e) => {
                                const w = parseInt(e.target.value, 10);
                                setWidth(keyOf(i), w > 0 ? w : null);
                              }}
                              aria-label={`${name} column ${i + 1} length`}
                              className={`w-16 rounded border bg-white px-1 py-0.5 dark:bg-zinc-950 ${sec.widths[keyOf(i)] ? "border-zinc-300 dark:border-zinc-700" : "border-amber-300 dark:border-amber-800"}`}
                            />
                          </label>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {samples.map((row, r) => (
                    <tr key={r}>
                      {Array.from({ length: count }, (_, i) => (
                        <td key={i} className="max-w-48 truncate whitespace-pre border-b border-zinc-100 px-1 py-0.5 text-zinc-700 dark:border-zinc-800 dark:text-zinc-300" title={row[i]}>
                          {row[i] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const COLUMN_TINTS = ["bg-blue-100 dark:bg-blue-950", "bg-amber-100 dark:bg-amber-950", "bg-emerald-100 dark:bg-emerald-950", "bg-pink-100 dark:bg-pink-950"];

/** A sample line, character by character: click a character to start a new column there (click again to remove). */
function Ruler({ line, sec, onChange }: { line: string; sec: FlatSection; onChange: (patch: Partial<FlatSection>, now?: boolean) => void }) {
  const widths = sec.fields.map((f) => sec.widths[f] ?? 0).filter((w) => w > 0);
  const breaks: number[] = [];
  widths.reduce((pos, w) => {
    breaks.push(pos + w);
    return pos + w;
  }, 0);
  const inner = breaks.filter((b) => b < line.length);
  const columnAt = (i: number) => inner.filter((b) => b <= i).length;
  const shown = line.slice(0, 200);

  const toggle = (i: number) => {
    if (i === 0) return;
    const next = inner.includes(i) ? inner.filter((b) => b !== i) : [...inner, i];
    const ws = widthsFromBreaks(next, line.length);
    // Names stay with their column by position.
    const fields = ws.map((_, j) => sec.fields[j] || `field${j + 1}`);
    onChange({ fields, widths: Object.fromEntries(fields.map((f, j) => [f, ws[j]])) }, true);
  };

  return (
    <div>
      <div className="overflow-x-auto rounded border border-zinc-200 p-1 dark:border-zinc-700">
        <div className="whitespace-pre font-mono leading-5" aria-label="Column ruler">
          <div className="text-zinc-400">
            {Array.from(shown, (_, i) => (i % 10 === 0 ? String(i).padEnd(10, " ").slice(0, 10) : null)).filter((x) => x !== null).join("")}
          </div>
          <div>
            {Array.from(shown, (ch, i) => (
              <Fragment key={i}>
                <span
                  onClick={() => toggle(i)}
                  title={`Position ${i + 1}${inner.includes(i) ? " (column start: click to join)" : " (click to start a column here)"}`}
                  className={`cursor-pointer hover:outline hover:outline-1 hover:outline-blue-500 ${COLUMN_TINTS[columnAt(i) % COLUMN_TINTS.length]} ${
                    inner.includes(i) ? "border-l-2 border-blue-600" : ""
                  }`}
                >
                  {ch === " " ? " " : ch}
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
