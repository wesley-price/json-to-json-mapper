"use client";

// Scenarios: one document can hold several independent mapping setups (for
// example a "200 OK" response and a "422 Unprocessable" response), each with
// its own primary. New scenarios can start from copies of objects already
// defined in any scenario.

import { useEffect, useRef, useState } from "react";
import { Tab } from "./MultiBar";

export interface ScenarioTab {
  id: string;
  name: string;
}

/** An object that a new scenario can start from (a copy is made). */
export interface ReusableObject {
  id: string;
  label: string;
}

interface Props {
  scenarios: ScenarioTab[];
  active: string;
  objects: ReusableObject[];
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onAdd: (name: string, primaryObjectId: string | null, otherObjectId: string | null) => void;
  /** Only the "+ Add scenario" button (used while there is a single scenario). */
  compact?: boolean;
}

export function ScenarioBar(props: Props) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!props.compact && <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Scenarios</span>}
      {!props.compact && props.scenarios.map((s) => (
        <Tab
          key={s.id}
          name={s.name}
          active={s.id === props.active}
          onSelect={() => props.onSelect(s.id)}
          onRename={(name) => props.onRename(s.id, name)}
          onRemove={props.scenarios.length > 1 ? () => props.onRemove(s.id) : undefined}
          removeLabel={`Remove scenario ${s.name}`}
        />
      ))}
      <div className="relative">
        <button
          onClick={() => setAdding((a) => !a)}
          aria-expanded={adding}
          className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
          title="Another mapping with its own primary, e.g. a 422 response next to a 200"
        >
          + Add scenario
        </button>
        {adding && (
          <AddScenario
            defaultName={`Scenario ${props.scenarios.length + 1}`}
            objects={props.objects}
            onAdd={(name, p, o) => {
              props.onAdd(name, p, o);
              setAdding(false);
            }}
            onClose={() => setAdding(false)}
          />
        )}
      </div>
    </div>
  );
}

function AddScenario({
  defaultName,
  objects,
  onAdd,
  onClose,
}: {
  defaultName: string;
  objects: ReusableObject[];
  onAdd: (name: string, primaryObjectId: string | null, otherObjectId: string | null) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [primaryObj, setPrimaryObj] = useState("");
  const [otherObj, setOtherObj] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [onClose]);

  const picker = (label: string, value: string, set: (v: string) => void, hint: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <select
        value={value}
        onChange={(e) => set(e.target.value)}
        aria-label={label}
        className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-900"
      >
        <option value="">{hint}</option>
        {objects.length > 0 && (
          <optgroup label="Copy an object you already defined">
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Add scenario"
      className="absolute left-0 top-full z-30 mt-1 flex w-96 flex-col gap-2.5 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      <p className="text-zinc-500">A scenario is its own mapping (e.g. a 200 response vs a 422 response) with its own primary.</p>
      <label className="flex flex-col gap-1">
        <span className="text-zinc-600 dark:text-zinc-400">Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd(name.trim() || defaultName, primaryObj || null, otherObj || null);
          }}
          aria-label="Scenario name"
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      {picker("Primary object", primaryObj, setPrimaryObj, "Start empty (paste it later)")}
      {picker("Other object", otherObj, setOtherObj, "Start empty (paste it later)")}
      <p className="text-zinc-500">Copied objects are independent: editing one scenario doesn&apos;t change another.</p>
      <div className="flex gap-2">
        <button
          onClick={() => onAdd(name.trim() || defaultName, primaryObj || null, otherObj || null)}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Add scenario
        </button>
        <button onClick={onClose} className="px-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          Cancel
        </button>
      </div>
    </div>
  );
}
