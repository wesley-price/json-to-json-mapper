"use client";

// Multi-source mode controls: one tab per source, and the cases of the active
// source with their conditions. Cases are checked top to bottom; the first
// whose conditions all hold is used.

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { type Path, pathId } from "@/lib/json-tree";
import { CONDITION_OPS, type Condition, type ConditionOp, type MappingCase, describeConditions } from "@/lib/multi";

export interface MultiBarSource {
  id: string;
  name: string;
  cases: MappingCase[];
  activeCase: string;
}

interface Props {
  sources: MultiBarSource[];
  activeSource: string;
  onSelectSource: (id: string) => void;
  /** Add a source: a new empty object, or a copy of one (an id from addSourceFrom). */
  onAddSource: (copyFrom: string | null) => void;
  /** Objects a new source can start from: the standard and the existing sources. */
  addSourceFrom: { id: string; label: string }[];
  onRenameSource: (id: string, name: string) => void;
  onRemoveSource: (id: string) => void;
  onSelectCase: (id: string) => void;
  onAddCase: () => void;
  onRenameCase: (id: string, name: string) => void;
  onRemoveCase: (id: string) => void;
  onMoveCase: (id: string, dir: -1 | 1) => void;
  onSetConditions: (id: string, when: Condition[]) => void;
  /** A note for whoever implements the case (printed in the report). */
  onSetCaseNote: (id: string, note: string) => void;
  /** Fields of the active source that conditions can test. */
  fields: { path: Path; label: string }[];
  /** Does a case's conditions hold for the active source's sample? (null when there's no sample) */
  matchesSample: (c: MappingCase) => boolean | null;
  label: (p: Path) => string;
  /** "each": every source maps into the standard on its own; "merge": all sources fill one object together. */
  combine: "each" | "merge";
  onSetCombine: (mode: "each" | "merge") => void;
  /** Show only a one-line summary (the active source and case). */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function MultiBar(props: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const active = props.sources.find((s) => s.id === props.activeSource);
  const activeCase = active?.cases.find((c) => c.id === active.activeCase);
  // The case the sample would actually use: the first match.
  const firstMatch = active?.cases.find((c) => props.matchesSample(c) === true)?.id;

  const toggle = (
    <button
      onClick={props.onToggleCollapsed}
      aria-expanded={!props.collapsed}
      aria-label={props.collapsed ? "Show sources and cases" : "Hide sources and cases"}
      title={props.collapsed ? "Show sources and cases" : "Hide sources and cases"}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {props.collapsed ? "▸" : "▾"}
    </button>
  );

  if (props.collapsed) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {toggle}
        <button onClick={props.onToggleCollapsed} className="flex min-w-0 flex-1 items-center gap-2 text-left" title="Show sources and cases">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Sources &amp; cases{props.combine === "merge" ? " · merged" : ""}
          </span>
          <span className="truncate text-zinc-700 dark:text-zinc-300">
            <span className="font-medium">{active?.name}</span>
            {props.sources.length > 1 && <span className="text-zinc-400"> (1 of {props.sources.length})</span>}
            {activeCase && (
              <>
                <span className="text-zinc-400"> › </span>
                <span className="font-medium">{activeCase.name}</span>
                <span className="font-mono text-zinc-500"> · when {describeConditions(activeCase.when, props.label)}</span>
              </>
            )}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Sources */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="-ml-1">{toggle}</span>
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Sources</span>
        {props.sources.map((s) => (
          <Tab
            key={s.id}
            name={s.name}
            active={s.id === props.activeSource}
            onSelect={() => props.onSelectSource(s.id)}
            onRename={(name) => props.onRenameSource(s.id, name)}
            onRemove={props.sources.length > 1 ? () => props.onRemoveSource(s.id) : undefined}
            removeLabel={`Remove source ${s.name}`}
          />
        ))}
        <AddSource options={props.addSourceFrom} onAdd={props.onAddSource} />
        <span
          className="ml-auto inline-flex overflow-hidden rounded-md border border-zinc-300 text-xs dark:border-zinc-700"
          role="group"
          aria-label="How sources combine"
        >
          {(
            [
              ["each", "One at a time", "Each source maps into the standard on its own (e.g. different downstream errors)"],
              ["merge", "Merged into one", "All sources fill the same object together (e.g. customer + order + payment into one document)"],
            ] as const
          ).map(([id, label, title]) => (
            <button
              key={id}
              onClick={() => props.onSetCombine(id)}
              aria-pressed={props.combine === id}
              title={title}
              className={`px-2 py-1 ${
                props.combine === id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      {/* Cases of the active source */}
      {active && (
        <div className="flex flex-col gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Cases</span>
            {active.cases.map((c, i) => {
              const match = props.matchesSample(c);
              return (
                <div key={c.id} className="flex items-center">
                  <Tab
                    name={c.name}
                    active={c.id === active.activeCase}
                    onSelect={() => props.onSelectCase(c.id)}
                    onRename={(name) => props.onRenameCase(c.id, name)}
                    onRemove={active.cases.length > 1 ? () => props.onRemoveCase(c.id) : undefined}
                    removeLabel={`Remove case ${c.name}`}
                    badge={
                      match === null ? undefined : c.id === firstMatch ? (
                        <span title="The current sample uses this case" className="text-emerald-600 dark:text-emerald-400">
                          ● used
                        </span>
                      ) : match ? (
                        <span title="Matches, but an earlier case is used first" className="text-zinc-400">
                          ○ matches
                        </span>
                      ) : undefined
                    }
                  />
                  {active.cases.length > 1 && (
                    <span className="ml-0.5 flex flex-col">
                      <MiniButton label="Check earlier" disabled={i === 0} onClick={() => props.onMoveCase(c.id, -1)}>
                        ▲
                      </MiniButton>
                      <MiniButton
                        label="Check later"
                        disabled={i === active.cases.length - 1}
                        onClick={() => props.onMoveCase(c.id, 1)}
                      >
                        ▼
                      </MiniButton>
                    </span>
                  )}
                </div>
              );
            })}
            <button
              onClick={props.onAddCase}
              className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
              title="A new case starts with a copy of the current case's mappings"
            >
              + Add case
            </button>
          </div>

          {activeCase && (
            <ConditionEditor
              key={activeCase.id}
              kase={activeCase}
              fields={props.fields}
              label={props.label}
              onChange={(when) => props.onSetConditions(activeCase.id, when)}
              extra={
                !activeCase.note && !noteOpen ? (
                  <button
                    onClick={() => setNoteOpen(true)}
                    className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    title="A note for whoever implements this case (printed in the report)"
                  >
                    <Icon name="note" /> Note
                  </button>
                ) : null
              }
            />
          )}
          {activeCase && (activeCase.note || noteOpen) && (
            <label className="flex items-start gap-2 text-xs">
              <span className="mt-1 shrink-0 text-zinc-500"><Icon name="note" /> Note</span>
              <textarea
                key={activeCase.id}
                autoFocus={noteOpen && !activeCase.note}
                onBlur={() => setNoteOpen(false)}
                value={activeCase.note ?? ""}
                onChange={(e) => props.onSetCaseNote(activeCase.id, e.target.value)}
                rows={1}
                placeholder="Anything the implementer should know about this case (printed in the report)"
                aria-label="Case note"
                className="min-h-7 flex-1 resize-y rounded-md border border-zinc-200 bg-white px-2 py-1 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

export function Tab({
  name,
  active,
  onSelect,
  onRename,
  onRemove,
  removeLabel,
  badge,
}: {
  name: string;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onRemove?: () => void;
  removeLabel: string;
  badge?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== name) onRename(draft.trim());
  };
  return (
    <span
      className={`group inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
        active
          ? "border-blue-500 bg-blue-50 font-medium text-blue-900 dark:bg-blue-950/60 dark:text-blue-100"
          : "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label="Name"
          className="w-32 rounded border border-blue-500 bg-white px-1 text-xs text-zinc-900 outline-none dark:bg-zinc-900 dark:text-zinc-100"
        />
      ) : (
        <button
          onClick={onSelect}
          onDoubleClick={() => {
            setDraft(name);
            setEditing(true);
          }}
          title="Double-click to rename"
        >
          {name}
        </button>
      )}
      {badge && <span className="text-[10px]">{badge}</span>}
      {!editing && (
        <button
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
          aria-label={`Rename ${name}`}
          title="Rename"
          className={`rounded px-0.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 ${active ? "opacity-70" : "opacity-0 group-hover:opacity-100"}`}
        >
          ✎
        </button>
      )}
      {onRemove && !editing && (
        <button
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className={`ml-0.5 rounded px-0.5 text-zinc-400 hover:text-red-600 group-hover:opacity-100 ${active ? "opacity-60" : "opacity-0"}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

function MiniButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="h-2.5 px-0.5 text-[7px] leading-none text-zinc-400 hover:text-zinc-900 disabled:opacity-20 dark:hover:text-zinc-100"
    >
      {children}
    </button>
  );
}

function ConditionEditor({
  kase,
  fields,
  label,
  onChange,
  extra,
}: {
  kase: MappingCase;
  fields: { path: Path; label: string }[];
  label: (p: Path) => string;
  onChange: (when: Condition[]) => void;
  /** More controls for the summary line (e.g. the note button). */
  extra?: React.ReactNode;
}) {
  // A one-line summary until "Edit" is clicked.
  const [editing, setEditing] = useState(false);
  const update = (i: number, patch: Partial<Condition>) =>
    onChange(kase.when.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addCondition = () => {
    if (!fields.length) return;
    onChange([...kase.when, { path: fields[0].path, op: "equals", value: "" }]);
    setEditing(true);
  };
  const linkButton =
    "rounded px-1.5 py-0.5 text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:text-blue-400 dark:hover:bg-blue-950";
  const selectClass =
    "rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="rounded-md bg-zinc-50 px-2.5 py-2 text-xs dark:bg-zinc-950/40">
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-zinc-600 dark:text-zinc-400 ${editing ? "mb-1" : ""}`}>
        <span>
          <span className="font-medium text-zinc-800 dark:text-zinc-200">{kase.name}</span> is used when{" "}
          <span className="font-mono">{describeConditions(kase.when, label)}</span>
          <span className="text-zinc-400" title="Cases are checked top to bottom; the first whose conditions all hold is used">
            {" "}
            · first match wins
          </span>
        </span>
        <span className="ml-auto flex items-center gap-1">
          {kase.when.length === 0 && !editing ? (
            <button onClick={addCondition} disabled={!fields.length} className={linkButton}>
              + Add condition
            </button>
          ) : (
            <button onClick={() => setEditing((e) => !e)} aria-expanded={editing} className={linkButton}>
              {editing ? "Done" : "✎ Edit conditions"}
            </button>
          )}
          {extra}
        </span>
      </div>
      {editing && (
      <div className="flex flex-col gap-1">
        {kase.when.map((c, i) => {
          const op = CONDITION_OPS.find((o) => o.id === c.op);
          return (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <span className="w-8 text-right text-zinc-400">{i === 0 ? "when" : "and"}</span>
              <select
                value={pathId(c.path)}
                onChange={(e) => update(i, { path: JSON.parse(e.target.value) as Path })}
                aria-label="Condition field"
                className={`${selectClass} max-w-64 font-mono`}
              >
                {!fields.some((f) => pathId(f.path) === pathId(c.path)) && (
                  <option value={pathId(c.path)}>{label(c.path)}</option>
                )}
                {fields.map((f) => (
                  <option key={pathId(f.path)} value={pathId(f.path)}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                value={c.op}
                onChange={(e) => update(i, { op: e.target.value as ConditionOp })}
                aria-label="Condition operator"
                className={selectClass}
              >
                {CONDITION_OPS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {op?.needsValue && (
                <input
                  value={c.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  placeholder="value"
                  aria-label="Condition value"
                  className="w-28 rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
                />
              )}
              <button
                onClick={() => onChange(kase.when.filter((_, j) => j !== i))}
                aria-label="Remove condition"
                className="px-1 text-zinc-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          );
        })}
        <button onClick={addCondition} disabled={!fields.length} className={`self-start ${linkButton}`}>
          + Add condition
        </button>
      </div>
      )}
    </div>
  );
}

/** "+ Add source": start from a new empty object or a copy of the standard / another source. */
function AddSource({ options, onAdd }: { options: { id: string; label: string }[]; onAdd: (copyFrom: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const pick = (id: string | null) => {
    setOpen(false);
    onAdd(id);
  };
  const item = "block w-full rounded px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800";
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
      >
        + Add source
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Add source"
          className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-zinc-200 bg-white p-1.5 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Start the new source from</p>
          <button role="menuitem" onClick={() => pick(null)} className={item}>
            <span className="font-medium">A new object</span>
            <span className="block text-zinc-500">Empty: paste or build the source yourself</span>
          </button>
          {options.map((o) => (
            <button key={o.id} role="menuitem" onClick={() => pick(o.id)} className={item}>
              <span className="font-medium">Copy of {o.label}</span>
              <span className="block text-zinc-500">Same fields and values, ready to change</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
