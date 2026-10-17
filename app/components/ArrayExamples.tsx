"use client";

// Example values shown under a list row: chips for lists of strings, numbers
// or booleans, and a small JSON editor for lists of objects. The values live
// in the list itself, so they are exported and imported with the object.

import { useState } from "react";
import { type FieldNode, type FieldType, type Json, type Path, defaultFor, exampleItems } from "@/lib/json-tree";

const MAX_READONLY_CHIPS = 12;

interface Props {
  node: FieldNode;
  editable: boolean;
  /** Left padding so the line lines up under the list's children. */
  indent: number;
  onSetArrayItems: (arrayPath: Path, items: Json[]) => void;
}

export function ArrayExamples(props: Props) {
  const itemType = props.node.children[0]?.type;
  if (!itemType) return null; // item type not chosen yet
  const items = exampleItems(props.node.items);
  if (itemType === "object" || itemType === "array") return <ObjectExamples {...props} items={items} />;
  if (!props.editable) return <ReadOnlyChips items={items} indent={props.indent} />;
  return <ChipEditor {...props} itemType={itemType} items={items} />;
}

/** Turn typed text into a list item of the given type, or undefined if it doesn't fit. */
function parseItem(text: string, type: FieldType): Json | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (type === "number") return Number.isNaN(Number(t)) ? undefined : Number(t);
  if (type === "boolean") {
    if (/^(true|yes|1)$/i.test(t)) return true;
    if (/^(false|no|0)$/i.test(t)) return false;
    return undefined;
  }
  return t;
}

function Chip({ value, onRemove }: { value: Json; onRemove?: () => void }) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-zinc-300 bg-white py-px pl-2 pr-1 font-mono text-[11px] text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
      {text}
      {onRemove ? (
        <button
          onClick={onRemove}
          aria-label={`Remove example ${text}`}
          className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-zinc-400 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950 dark:hover:text-red-300"
        >
          ×
        </button>
      ) : (
        <span className="w-1" />
      )}
    </span>
  );
}

function ReadOnlyChips({ items, indent }: { items: Json[]; indent: number }) {
  if (items.length === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1 py-0.5 pr-2 font-sans text-[11px] text-zinc-500"
      style={{ paddingLeft: indent }}
    >
      <span>values:</span>
      {items.slice(0, MAX_READONLY_CHIPS).map((v, i) => (
        <Chip key={i} value={v} />
      ))}
      {items.length > MAX_READONLY_CHIPS && <span>+{items.length - MAX_READONLY_CHIPS} more</span>}
    </div>
  );
}

function ChipEditor({ node, itemType, items, indent, onSetArrayItems }: Props & { itemType: FieldType; items: Json[] }) {
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);

  // An emptied list keeps one blank item so it remembers what type it holds.
  const save = (next: Json[]) => onSetArrayItems(node.path, next.length ? next : [defaultFor(itemType)]);

  /** Add one or more comma/newline separated values. */
  const addFrom = (raw: string) => {
    const parts = raw
      .split(/[,\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const parsed = parts.map((p) => parseItem(p, itemType));
    if (parsed.some((p) => p === undefined)) {
      setInvalid(true);
      return;
    }
    save([...items, ...(parsed as Json[])]);
    setText("");
    setInvalid(false);
  };

  const placeholder =
    itemType === "number" ? "add a number…" : itemType === "boolean" ? "true or false…" : "add an example, e.g. standard…";

  return (
    <div
      className="flex flex-wrap items-center gap-1 py-0.5 pr-2 font-sans text-[11px] text-zinc-500"
      style={{ paddingLeft: indent }}
    >
      <span title="Example values for this list. They are included when you export.">examples:</span>
      {items.map((v, i) => (
        <Chip key={i} value={v} onRemove={() => save(items.filter((_, j) => j !== i))} />
      ))}
      <input
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) addFrom(v); // typing a comma commits the value before it
          else {
            setText(v);
            setInvalid(false);
          }
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text");
          if (/[,\n]/.test(pasted)) {
            e.preventDefault();
            addFrom(text + pasted);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addFrom(text);
          } else if (e.key === "Backspace" && text === "" && items.length) {
            save(items.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (text.trim()) addFrom(text);
        }}
        placeholder={items.length ? "add…" : placeholder}
        aria-label={`Add example to ${node.key}`}
        className={`min-w-28 flex-1 rounded border bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-zinc-800 outline-none placeholder:font-sans placeholder:text-zinc-400 dark:text-zinc-200 ${
          invalid
            ? "border-red-500"
            : "border-transparent hover:border-zinc-300 focus:border-blue-500 dark:hover:border-zinc-700"
        }`}
      />
      {invalid && <span className="w-full text-red-600 dark:text-red-400">That isn&apos;t a {itemType}.</span>}
    </div>
  );
}

function ObjectExamples({ node, editable, indent, items, onSetArrayItems }: Props & { items: Json[] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const count = items.length;

  const open = () => {
    setDraft(JSON.stringify(node.items ?? [], null, 2));
    setError(null);
    setEditing(true);
  };
  const save = () => {
    try {
      const parsed = JSON.parse(draft);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Enter a list with at least one item, like [ {…}, {…} ].");
      }
      onSetArrayItems(node.path, parsed);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-2 py-0.5 pr-2 font-sans text-[11px] text-zinc-500" style={{ paddingLeft: indent }}>
        <span>
          {count} example item{count === 1 ? "" : "s"}
        </span>
        {editable && (
          <button onClick={open} className="text-blue-600 hover:underline dark:text-blue-400">
            Edit examples
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="my-1 flex flex-col gap-1 pr-2 font-sans text-xs" style={{ paddingLeft: indent }}>
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        spellCheck={false}
        rows={Math.min(14, draft.split("\n").length + 1)}
        aria-label={`Example items for ${node.key}`}
        className={`w-full resize-y rounded-md border bg-zinc-50 p-2 font-mono text-[11px] outline-none dark:bg-zinc-950 ${
          error ? "border-red-500" : "border-zinc-300 focus:border-blue-500 dark:border-zinc-700"
        }`}
      />
      {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
      <div className="flex gap-2">
        <button onClick={save} className="rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-700">
          Save examples
        </button>
        <button
          onClick={() => setEditing(false)}
          className="px-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
