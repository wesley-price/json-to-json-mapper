"use client";

// Multi-source mode controls: one tab per source, and the cases of the active
// source with their conditions. Cases are checked top to bottom; the first
// whose conditions all hold is used.

import { useState } from "react";
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
  onAddSource: () => void;
  onRenameSource: (id: string, name: string) => void;
  onRemoveSource: (id: string) => void;
  onSelectCase: (id: string) => void;
  onAddCase: () => void;
  onRenameCase: (id: string, name: string) => void;
  onRemoveCase: (id: string) => void;
  onMoveCase: (id: string, dir: -1 | 1) => void;
  onSetConditions: (id: string, when: Condition[]) => void;
  /** Fields of the active source that conditions can test. */
  fields: { path: Path; label: string }[];
  /** Does a case's conditions hold for the active source's sample? (null when there's no sample) */
  matchesSample: (c: MappingCase) => boolean | null;
  label: (p: Path) => string;
}

export function MultiBar(props: Props) {
  const active = props.sources.find((s) => s.id === props.activeSource);
  const activeCase = active?.cases.find((c) => c.id === active.activeCase);
  // The case the sample would actually use: the first match.
  const firstMatch = active?.cases.find((c) => props.matchesSample(c) === true)?.id;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Sources */}
      <div className="flex flex-wrap items-center gap-1.5">
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
        <button
          onClick={props.onAddSource}
          className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
        >
          + Add source
        </button>
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
            />
          )}
        </div>
      )}
    </div>
  );
}

function Tab({
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
          className="ml-0.5 rounded px-0.5 text-zinc-400 opacity-0 hover:text-red-600 group-hover:opacity-100"
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
}: {
  kase: MappingCase;
  fields: { path: Path; label: string }[];
  label: (p: Path) => string;
  onChange: (when: Condition[]) => void;
}) {
  const update = (i: number, patch: Partial<Condition>) =>
    onChange(kase.when.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const selectClass =
    "rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="rounded-md bg-zinc-50 px-2.5 py-2 text-xs dark:bg-zinc-950/40">
      <div className="mb-1 text-zinc-600 dark:text-zinc-400">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">{kase.name}</span> is used when{" "}
        <span className="font-mono">{describeConditions(kase.when, label)}</span>
        <span className="text-zinc-400"> · cases are checked top to bottom, first match wins</span>
      </div>
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
        <button
          onClick={() =>
            fields.length && onChange([...kase.when, { path: fields[0].path, op: "equals", value: "" }])
          }
          disabled={!fields.length}
          className="self-start rounded px-1.5 py-0.5 text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:text-blue-400 dark:hover:bg-blue-950"
        >
          + Add condition
        </button>
      </div>
    </div>
  );
}
