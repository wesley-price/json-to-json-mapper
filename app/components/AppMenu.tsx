"use client";

// The top-right "☰ Menu": every page-level action grouped in one dropdown.
// It opens on hover (and on click / keyboard). Once you interact with
// something inside it, it stays open until you click outside or press Esc,
// so native dropdowns inside it don't close it.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FORMATS, type Format } from "@/lib/formats";
import { ThemeSwitch } from "./ThemeSwitch";
import { type DocEntry, listDocs } from "@/lib/documents";

interface Props {
  bothEditable: boolean;
  onBothEditable: (on: boolean) => void;
  onSwap: () => void;
  onExport: () => void;
  exportDisabled: boolean;
  onImport: () => void;
  onImportOpenApi: () => void;
  onExportOpenApi: (format: "yaml" | "json") => void;
  onLoadExample: (source: Format, target: Format) => void;
  onClear: () => void;
  /** Multi-source mode: one standard (primary) object fed by several sources. */
  multiMode: boolean;
  onMultiMode: (on: boolean) => void;
  onLoadMultiExample: () => void;
  onLoadMergeExample: () => void;
  /** Documents kept in this browser, and files. */
  currentDocId: string;
  onOpenDoc: (id: string) => void;
  onNewDoc: () => void;
  onDeleteDoc: (id: string) => void;
  onSaveFile: () => void;
  onOpenFile: () => void;
}

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

const CLOSE_DELAY = 250; // ms; lets the pointer cross the gap between button and panel

export function AppMenu(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [source, setSource] = useState<Format>("json");
  const [target, setTarget] = useState<Format>("json");
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const close = () => {
    setOpen(false);
    setPinned(false);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A new tab keeps the mapper open; fall back to this tab if pop-ups are blocked.
  const openReport = (url: string) => {
    if (!window.open(url, "_blank")) router.push(url);
  };

  /** Run a menu action, then close the menu. */
  const act = (fn: () => void) => () => {
    fn();
    close();
  };

  const formatSelect = (label: string, value: Format, set: (f: Format) => void) => (
    <label className="flex items-center justify-between gap-2">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <select
        value={value}
        onChange={(e) => set(e.target.value as Format)}
        aria-label={`Example ${label.toLowerCase()} format`}
        className="w-28 rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
      >
        {FORMATS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => {
        window.clearTimeout(closeTimer.current);
        setOpen(true);
      }}
      onMouseLeave={() => {
        if (pinned) return;
        closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
      }}
      onPointerDown={() => setPinned(true)}
    >
      <button
        // The button handles its own clicks: hovering opens, a click pins open, a second click closes.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          if (open && pinned) close();
          else {
            setOpen(true);
            setPinned(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <span aria-hidden className="text-base leading-none">
          ☰
        </span>
        Menu
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Menu"
          className="absolute right-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          <Group title="Documents">
            <DocList current={props.currentDocId} onOpen={(id) => act(() => props.onOpenDoc(id))()} onDelete={props.onDeleteDoc} />
            <Item onClick={act(props.onNewDoc)}>＋ New document</Item>
            <Item onClick={act(props.onSaveFile)}>⬇ Save to file (.json)</Item>
            <Item onClick={act(props.onOpenFile)}>⬆ Open file…</Item>
          </Group>
          <Group title="Workspace">
            {/* The standard must stay the primary in multi-source mode. */}
            {!props.multiMode && <Item onClick={act(props.onSwap)}>⇄ Swap primary side</Item>}
            <SwitchRow label="✎ Both sides editable" checked={props.bothEditable} onChange={props.onBothEditable} />
            <SwitchRow
              label="⧉ Multi-source mode"
              hint="Map several source objects (e.g. downstream errors) into one standard primary object"
              checked={props.multiMode}
              onChange={props.onMultiMode}
            />
          </Group>

          <Group title="Export & import">
            <Item onClick={act(() => openReport("/report?download"))} disabled={props.exportDisabled}>
              ⬇ Download report (PDF)
            </Item>
            <Item onClick={act(() => openReport("/report"))} disabled={props.exportDisabled}>
              📄 View report…
            </Item>
            <Item onClick={act(props.onExport)} disabled={props.exportDisabled}>
              ⬇ Export to Excel
            </Item>
            <Item onClick={act(props.onImport)}>
              ⬆ Import from Excel…
            </Item>
            <Item onClick={act(() => props.onExportOpenApi("yaml"))} disabled={props.exportDisabled}>
              ⬇ Export to OpenAPI (.yaml)
            </Item>
            <Item onClick={act(() => props.onExportOpenApi("json"))} disabled={props.exportDisabled}>
              ⬇ Export to OpenAPI (.json)
            </Item>
            <Item onClick={act(props.onImportOpenApi)}>
              ⬆ Import from OpenAPI…
            </Item>
          </Group>

          <Group title="Load example">
            {props.multiMode ? (
              <div className="flex flex-col gap-1.5 px-2 py-1 text-xs">
                <p className="text-zinc-500">
                  A standard error response fed by three downstream errors (JSON, XML, CSV), with cases.
                </p>
                <button
                  onClick={act(props.onLoadMultiExample)}
                  className="mt-0.5 rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Load error example
                </button>
                <p className="mt-1.5 text-zinc-500">
                  An order summary filled by three systems at once (a CRM table, an order service, a payments XML).
                </p>
                <button
                  onClick={act(props.onLoadMergeExample)}
                  className="mt-0.5 rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Load merge example
                </button>
              </div>
            ) : (
            <div className="flex flex-col gap-1.5 px-2 py-1 text-xs">
              <p className="text-zinc-500">An order (source) and an empty invoice (target).</p>
              {formatSelect("Source", source, setSource)}
              {formatSelect("Target", target, setTarget)}
              <button
                onClick={act(() => props.onLoadExample(source, target))}
                className="mt-0.5 rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Load example
              </button>
            </div>
            )}
          </Group>

          <Group title="Appearance">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-zinc-600 dark:text-zinc-400">Theme</span>
              <ThemeSwitch />
            </div>
          </Group>

          <div className="border-t border-zinc-200 p-1 dark:border-zinc-800">
            <Item onClick={act(props.onClear)} danger>
              Clear everything
            </Item>
          </div>
        </div>
      )}
    </div>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      title={hint}
    >
      <span>{label}</span>
      <span className="relative inline-flex h-4 w-7 shrink-0 items-center">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="absolute inset-0 rounded-full bg-zinc-300 transition-colors peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400 dark:bg-zinc-600" />
        <span className="absolute left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform peer-checked:translate-x-3" />
      </span>
    </label>
  );
}

/** The documents kept in this browser (read when the menu opens). */
function DocList({ current, onOpen, onDelete }: { current: string; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  const [docs, setDocs] = useState<DocEntry[]>(() => listDocs());
  if (!docs.length) return <p className="px-2 py-1 text-xs text-zinc-500">Documents you work on are kept here.</p>;
  return (
    <ul className="max-h-48 overflow-auto py-0.5">
      {docs.map((d) => (
        <li key={d.id} className="group flex items-center gap-1 rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <button
            onClick={() => d.id !== current && onOpen(d.id)}
            className={`min-w-0 flex-1 truncate text-left text-sm ${d.id === current ? "font-semibold" : ""}`}
            title={d.id === current ? "The document on screen" : `Open "${d.name}"`}
          >
            {d.id === current ? "● " : ""}
            {d.name}
          </button>
          <span className="shrink-0 text-[11px] text-zinc-400">{ago(d.updated)}</span>
          {d.id !== current && (
            <button
              onClick={() => {
                onDelete(d.id);
                setDocs(listDocs());
              }}
              aria-label={`Delete ${d.name}`}
              title="Delete from this browser"
              className="shrink-0 px-1 text-zinc-400 opacity-0 hover:text-red-600 group-hover:opacity-100"
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-zinc-200 p-1 last:border-b-0 dark:border-zinc-800">
      <div className="px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</div>
      {children}
    </div>
  );
}

function Item({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center rounded-md px-2 py-1.5 text-left disabled:opacity-40 ${
        danger
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          : "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}
