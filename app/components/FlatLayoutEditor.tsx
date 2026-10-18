"use client";

// Settings for reading/writing a flat (header / body / footer) file.

import { useState } from "react";
import { type Delimiter, type FlatLayout, type FlatSection, SECTIONS, type SectionName } from "@/lib/formats/flat";

const DELIMITERS: { id: Delimiter; label: string }[] = [
  { id: "|", label: "| pipe" },
  { id: ",", label: ", comma" },
  { id: "\t", label: "tab" },
  { id: ";", label: "; semicolon" },
  { id: "fixed", label: "fixed width" },
];

const delimiterLabel = (d: Delimiter) => DELIMITERS.find((x) => x.id === d)?.label ?? d;

interface Props {
  layout: FlatLayout;
  /** Source files are read with the layout; target files are written with it. */
  role: "source" | "target";
  /** Field names currently in the data, per section (used for widths). */
  currentFields: Record<SectionName, string[]>;
  /** False when the object has no header/body/footer to write. */
  hasSections: boolean;
  onApply: (layout: FlatLayout) => void;
  onAddSections: () => void;
}

export function FlatLayoutEditor({ layout, role, currentFields, hasSections, onApply, onAddSections }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(layout);
  const fixed = draft.delimiter === "fixed";

  const summary = `${delimiterLabel(layout.delimiter)} · records by ${layout.identifyBy === "code" ? "code" : "position"} · ${SECTIONS.filter((s) => layout[s].enabled).join(" / ")}`;

  const setSection = (name: SectionName, patch: Partial<FlatSection>) =>
    setDraft((d) => ({ ...d, [name]: { ...d[name], ...patch } }));

  // Field names shown for each section: typed names on the source, the tree's names on the target.
  const fieldsFor = (name: SectionName) =>
    role === "source" && draft[name].fields.length ? draft[name].fields : currentFields[name];

  return (
    <div className="border-b border-zinc-200 bg-zinc-50/60 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">File layout</span>
        <span className="text-zinc-500">{summary}</span>
        <button
          onClick={() => {
            setDraft(layout);
            setOpen((o) => !o);
          }}
          className="ml-auto text-blue-600 hover:underline dark:text-blue-400"
          aria-expanded={open}
        >
          {open ? "Close" : "Edit layout"}
        </button>
      </div>

      {role === "target" && !hasSections && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          A flat file is written from <code>header</code>, <code>body</code> (a list) and <code>footer</code>{" "}
          fields, and this object has none yet.{" "}
          <button onClick={onAddSections} className="font-medium underline">
            Add header, body &amp; footer
          </button>
        </p>
      )}

      {open && (
        <div className="mt-2 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1">
              Fields separated by
              <select
                value={draft.delimiter}
                onChange={(e) => setDraft((d) => ({ ...d, delimiter: e.target.value as Delimiter }))}
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
              Records identified by
              <select
                value={draft.identifyBy}
                onChange={(e) => setDraft((d) => ({ ...d, identifyBy: e.target.value as FlatLayout["identifyBy"] }))}
                className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="position">position (first = header, last = footer)</option>
                <option value="code">record code at the start of the line</option>
              </select>
            </label>
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-1 pr-2 font-normal">Section</th>
                {draft.identifyBy === "code" && <th className="py-1 pr-2 font-normal">Code</th>}
                <th className="py-1 pr-2 font-normal">
                  {role === "source" ? "Field names (comma separated)" : "Fields (from the tree)"}
                </th>
                {fixed && <th className="py-1 font-normal">Widths (comma separated)</th>}
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((name) => {
                const sec = draft[name];
                const fields = fieldsFor(name);
                return (
                  <tr key={name} className="align-top">
                    <td className="py-1 pr-2">
                      <label className="flex items-center gap-1 capitalize">
                        <input
                          type="checkbox"
                          checked={sec.enabled}
                          onChange={(e) => setSection(name, { enabled: e.target.checked })}
                        />
                        {name}
                      </label>
                    </td>
                    {draft.identifyBy === "code" && (
                      <td className="py-1 pr-2">
                        <input
                          value={sec.code}
                          disabled={!sec.enabled}
                          onChange={(e) => setSection(name, { code: e.target.value })}
                          aria-label={`${name} record code`}
                          className="w-14 rounded border border-zinc-300 bg-white px-1 py-0.5 font-mono disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
                        />
                      </td>
                    )}
                    <td className="py-1 pr-2">
                      {role === "source" ? (
                        <input
                          value={sec.fields.join(", ")}
                          disabled={!sec.enabled}
                          placeholder="field1, field2, …"
                          onChange={(e) =>
                            setSection(name, {
                              fields: e.target.value
                                .split(",")
                                .map((f) => f.trim())
                            })
                          }
                          aria-label={`${name} field names`}
                          className="w-full rounded border border-zinc-300 bg-white px-1 py-0.5 font-mono disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
                        />
                      ) : (
                        <span className="font-mono text-zinc-600 dark:text-zinc-400">
                          {fields.length ? fields.join(", ") : "—"}
                        </span>
                      )}
                    </td>
                    {fixed && (
                      <td className="py-1">
                        <input
                          defaultValue={fields.map((f) => sec.widths[f] ?? "").join(", ")}
                          key={fields.join("|")}
                          disabled={!sec.enabled || fields.length === 0}
                          placeholder={fields.length ? "e.g. 1, 8, 10" : "name the fields first"}
                          onChange={(e) => {
                            const nums = e.target.value.split(",").map((w) => parseInt(w.trim(), 10));
                            const widths: Record<string, number> = {};
                            fields.forEach((f, i) => {
                              if (nums[i] > 0) widths[f] = nums[i];
                            });
                            setSection(name, { widths });
                          }}
                          aria-label={`${name} field widths`}
                          className="w-full rounded border border-zinc-300 bg-white px-1 py-0.5 font-mono disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
              className="rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700"
            >
              {role === "source" ? "Apply & re-read file" : "Apply"}
            </button>
            <button onClick={() => setOpen(false)} className="px-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              Cancel
            </button>
            <span className="text-zinc-500">
              {role === "source"
                ? "The pasted file is read again with these settings."
                : "The output file is written with these settings."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
