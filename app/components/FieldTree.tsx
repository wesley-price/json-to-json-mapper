"use client";

import { useState } from "react";
import { ArrayExamples } from "./ArrayExamples";
import { MoreValuesEditor } from "./MoreValues";
import { ConstantFields, draftOf, fromDraft } from "./TranslationEditor";
import { type DbRef, type FixedValues, describeDb } from "@/lib/transforms";
import { type Drag, type DropIntent, type DropKind, beginDrag, useDropZone, useIsDragSource } from "./drag";
import {
  ARRAY_ITEM,
  type FieldNode,
  type FieldType,
  type Json,
  type Path,
  type Side,
  isPrefix,
  pathId,
} from "@/lib/json-tree";

export const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "object", "array", "null"];
/** What an array can hold, most common first. */
export const ITEM_TYPES: FieldType[] = ["object", "string", "number", "boolean", "array"];

export interface FieldSuggestion {
  key: string;
  type: FieldType;
  itemType?: FieldType;
  label: string;
}

/** A field at one end of a spotlighted mapping, and a note naming the other end. */
export interface FieldHighlight {
  color: string;
  note: string;
}

export interface FieldTreeProps {
  root: FieldNode;
  side: Side;
  editable: boolean;
  selectedId: string | null;
  /** pathId -> color for fields that take part in a mapping */
  mappedColors: Map<string, string>;
  /** Suggested key/type for new fields (from the currently selected primary field). */
  suggestion: FieldSuggestion | null;
  onSelect: (path: Path) => void;
  onDropField: (path: Path, from: { side: Side; path: Path }) => void;
  onAdd: (
    parent: Path,
    key: string,
    type: FieldType,
    itemType: FieldType | undefined,
    mapSelected: boolean,
  ) => void;
  onRemove: (path: Path) => void;
  onRename: (path: Path, newKey: string) => void;
  onRetype: (path: Path, type: FieldType) => void;
  onSetItemType: (arrayPath: Path, itemType: FieldType) => void;
  /** Move a field on the editable side into `parent`, optionally after sibling `after`. */
  onMoveField: (from: Path, parent: Path, after?: string) => void;
  /** Remove every mapping that uses this field. */
  onUnmap: (path: Path) => void;
  /** pathId -> highlight for fields linked to whatever is hovered */
  highlights: Map<string, FieldHighlight>;
  /** Hovering a field (null when the pointer leaves it). */
  onHoverField: (path: Path | null) => void;
  /** Replace a list's example items. */
  onSetArrayItems: (arrayPath: Path, items: Json[]) => void;
  /** Change a field's example value. */
  onSetValue: (path: Path, value: Json) => void;
  /** Fields tagged as constants (pathId -> value); only passed for the non-primary side. */
  fixed?: FixedValues;
  /** Tag / untag a field value as a constant. */
  onToggleFixed?: (path: Path) => void;
  /** Change a tagged constant (hardcoded value or database table/column). */
  onSetFixed?: (path: Path, fixed: { value: Json; db?: DbRef }) => void;
  /** More values a field can carry (pathId -> values), e.g. other messages for the same error. */
  moreValues?: Record<string, Json[]>;
  /** Set a field's extra values; only passed where they apply (a source in multi-source mode). */
  onSetMoreValues?: (path: Path, values: Json[]) => void;
  /** pathId -> the case each extra value lands in ("!" prefix = not the sample's case). */
  moreValueCases?: Record<string, string[]>;
  /** The case the sample uses. */
  sampleCase?: string;
  /** pathId -> a warning tag for the row (e.g. "not mapped · left out"). */
  flagged?: Map<string, string>;
  /** Rows to tint so they catch the eye (e.g. unmapped fields with no decision). */
  attention?: Set<string>;
  /** While searching: the rows to show (matches, their parents and children). Everything expands. */
  visibleIds?: Set<string>;
  /** Tinted rows also pulse (e.g. while the unmapped button is hovered). */
  pulse?: boolean;
  /** Title for the root row instead of "{ root }" (e.g. "Headers"). */
  rootLabel?: React.ReactNode;
  /** Wording for the add row at the top level (e.g. "Add header"). */
  addLabel?: string;
}

const TYPE_STYLES: Record<FieldType, string> = {
  string: "text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950",
  number: "text-sky-700 bg-sky-50 dark:text-sky-300 dark:bg-sky-950",
  boolean: "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950",
  object: "text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-950",
  array: "text-fuchsia-700 bg-fuchsia-50 dark:text-fuchsia-300 dark:bg-fuchsia-950",
  null: "text-zinc-600 bg-zinc-100 dark:text-zinc-400 dark:bg-zinc-800",
};

const INDENT = 16;
const itemTypeOf = (node: FieldNode) => node.children[0]?.type;

// --- Drag and drop ---
// Dragging to the other side maps fields; dragging within the editable side
// moves them into objects and lists (see ./drag.tsx for the mechanics).

const DROP_STYLES: Record<DropKind, string> = {
  map: "border-dashed border-blue-400 bg-blue-50/60 dark:bg-blue-950/40",
  into: "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50",
  after: "border-transparent border-b-emerald-500 border-b-2 rounded-b-none",
  blocked: "border-dashed border-red-400 bg-red-50/50 dark:bg-red-950/30",
};

const nameOf = (path: Path) => {
  const key = path[path.length - 1];
  return key === undefined ? "top level" : key === ARRAY_ITEM ? "each item" : key;
};

function dropIntentFor(drag: Drag, props: FieldTreeProps, node: FieldNode): DropIntent | null {
  const { side, editable } = props;
  if (drag.side !== side) return node.path.length ? { kind: "map", label: "map to this field" } : null;
  if (isPrefix(drag.path, node.path)) return null; // the field itself or something inside it
  if (!editable) return { kind: "blocked", label: "primary is locked" };
  const itemType = node.type === "array" ? node.children[0]?.type : undefined;
  if (itemType && itemType !== "object") {
    return { kind: "blocked", label: `list of ${itemType}s can't hold fields` };
  }
  if (node.type === "object" || node.type === "array" || node.path.length === 0) {
    return { kind: "into", label: `move into ${nameOf(node.path)}` };
  }
  if (node.key === ARRAY_ITEM) return null; // items of a primitive list hold no fields
  const parent = node.path.slice(0, -1);
  return {
    kind: "after",
    label: parent.length ? `move into ${nameOf(parent)}, after ${node.key}` : `move after ${node.key}`,
  };
}

/** Drop zone for a field row (or the root header): map onto it or move into/next to it. */
function useFieldDropZone(props: FieldTreeProps, node: FieldNode) {
  return useDropZone(
    `${props.side}:row:${pathId(node.path)}`,
    (drag) => dropIntentFor(drag, props, node),
    (drag, intent) => {
      if (intent.kind === "map") props.onDropField(node.path, drag);
      else if (intent.kind === "into") props.onMoveField(drag.path, node.path);
      else props.onMoveField(drag.path, node.path.slice(0, -1), node.key);
    },
  );
}

function DropLabel({ text }: { text: string }) {
  return (
    <span className="pointer-events-none rounded bg-zinc-900 px-1.5 py-0.5 font-sans text-[10px] text-white dark:bg-zinc-100 dark:text-zinc-900">
      {text}
    </span>
  );
}

export function FieldTree(props: FieldTreeProps) {
  const { root, editable } = props;
  const rootDrop = useFieldDropZone(props, root);

  return (
    <div className="font-mono text-sm">
      <div
        data-drop-zone={`${props.side}:row:${pathId(root.path)}`}
        className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs text-zinc-500 ${
          rootDrop ? DROP_STYLES[rootDrop.kind] : "border-transparent"
        }`}
      >
        {rootDrop && (
          <span className="order-last ml-auto">
            <DropLabel text={rootDrop.label} />
          </span>
        )}
        {root.type === "array" ? (
          <>
            <span>root list</span>
            <ArrayOf {...props} node={root} />
          </>
        ) : (
          <span>{props.rootLabel ?? "{ root }"}</span>
        )}
      </div>
      <Children {...props} node={root} depth={0} />
      {root.children.length === 0 && !editable && (
        <p className="px-2 py-3 text-xs text-zinc-500">No fields.</p>
      )}
    </div>
  );
}

/** A node's child rows, plus an "Add field" row for editable objects. */
function Children(props: FieldTreeProps & { node: FieldNode; depth: number }) {
  const { node, depth, editable } = props;
  const siblings = node.children.map((c) => c.key);
  return (
    <>
      {node.children.map((child) => (
        <FieldRow key={child.key} {...props} node={child} depth={depth} siblings={siblings} />
      ))}
      {editable && node.type === "object" && (
        <AddFieldDropZone {...props}>
          <AddFieldRow
            depth={depth}
            siblings={siblings}
            suggestion={props.suggestion}
            inList={node.key === ARRAY_ITEM}
            label={node.path.length <= 1 && props.addLabel ? props.addLabel : undefined}
            onAdd={(key, type, itemType, map) => props.onAdd(node.path, key, type, itemType, map)}
          />
        </AddFieldDropZone>
      )}
    </>
  );
}

/** The "+ Add field" row doubles as a target for moving a field into its object. */
function AddFieldDropZone(props: FieldTreeProps & { node: FieldNode; children: React.ReactNode }) {
  const { node } = props;
  const intent = useDropZone(
    `${props.side}:add:${pathId(node.path)}`,
    (drag) => {
      const i = dropIntentFor(drag, props, node);
      return i && i.kind !== "map" ? i : null;
    },
    (drag) => props.onMoveField(drag.path, node.path),
  );
  return (
    <div
      data-drop-zone={`${props.side}:add:${pathId(node.path)}`}
      className={`relative rounded-md border ${intent ? DROP_STYLES[intent.kind] : "border-transparent"}`}
    >
      {props.children}
      {intent && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2">
          <DropLabel text={intent.label} />
        </span>
      )}
    </div>
  );
}

function FieldRow(props: FieldTreeProps & { node: FieldNode; depth: number; siblings: string[] }) {
  const { node, depth, side, editable, selectedId, mappedColors } = props;
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [editingFixed, setEditingFixed] = useState(false);
  const [editingMore, setEditingMore] = useState(false);
  const drop = useFieldDropZone(props, node);
  const dragging = useIsDragSource(side, node.path);

  const id = pathId(node.path);
  const color = mappedColors.get(id);
  const highlight = props.highlights.get(id);
  const selected = selectedId === id;
  const isItem = node.key === ARRAY_ITEM;
  // Editable objects always show an "Add field" row, so they can be expanded.
  const expandable = node.children.length > 0 || (editable && node.type === "object");
  if (props.visibleIds && !props.visibleIds.has(id)) return null;

  return (
    <div>
      <div
        data-side={side}
        data-pid={id}
        data-drop-zone={`${side}:row:${id}`}
        onPointerDown={(e) =>
          beginDrag(e, { side, path: node.path, label: isItem ? "each item" : node.key })
        }
        onClick={() => props.onSelect(node.path)}
        onMouseEnter={() => props.onHoverField(node.path)}
        onMouseLeave={() => props.onHoverField(null)}
        className={[
          "group relative flex cursor-pointer select-none items-center gap-1.5 rounded-md border py-1 pr-2 transition-colors",
          dragging ? "opacity-40" : "",
          drop
            ? DROP_STYLES[drop.kind]
            : selected
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950/60"
              : props.attention?.has(id)
                ? `${props.pulse ? "attention-pulse " : ""}border-dashed border-amber-400 bg-amber-50/70 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/30 dark:hover:bg-amber-950/60`
                : "border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/70",
        ].join(" ")}
        style={{
          paddingLeft: 8 + depth * INDENT,
          ...(highlight && !drop
            ? { boxShadow: `inset 0 0 0 2px ${highlight.color}`, backgroundColor: `${highlight.color}1f` }
            : {}),
        }}
      >
        <button
          className={`w-4 shrink-0 text-xs text-zinc-400 ${expandable ? "" : "invisible"}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? "▾" : "▸"}
        </button>

        {renaming ? (
          <RenameInput
            initial={node.key}
            siblings={props.siblings}
            onDone={(next) => {
              setRenaming(false);
              if (next && next !== node.key) props.onRename(node.path, next);
            }}
          />
        ) : isItem ? (
          <span className="truncate font-sans text-xs italic text-zinc-500" title="Each item in the list">
            ↳ each item
          </span>
        ) : (
          <span
            className="truncate text-zinc-900 dark:text-zinc-100"
            onDoubleClick={(e) => {
              if (!editable) return;
              e.stopPropagation();
              setRenaming(true);
            }}
            title={editable ? "Double-click to rename" : undefined}
          >
            {node.key}
          </span>
        )}

        {/* An item's type is chosen on its array row, so it is shown read-only here. */}
        {editable && !isItem ? (
          <TypeSelect value={node.type} onChange={(t) => props.onRetype(node.path, t)} />
        ) : (
          <TypeBadge type={node.type} />
        )}
        {node.type === "array" && <ArrayOf {...props} node={node} />}

        {node.sample !== undefined &&
          // Values can be edited on both sides; the locked primary only blocks structural changes.
          (node.type !== "null" && !isItem ? (
            <ValueEditor
              value={node.sample}
              type={node.type}
              onChange={(v) => props.onSetValue(node.path, v)}
            />
          ) : (
            <span className="truncate text-xs text-zinc-400">{JSON.stringify(node.sample)}</span>
          ))}

        {props.onToggleFixed &&
          node.sample !== undefined &&
          (props.fixed?.[id] !== undefined ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingFixed((v) => !v);
              }}
              aria-expanded={editingFixed}
              className="shrink-0 truncate rounded bg-amber-100 px-1.5 font-sans text-[10px] font-medium text-amber-800 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300"
              title="Tagged as a constant. Click to edit or untag."
            >
              📌 {props.fixed[id].db ? describeDb(props.fixed[id].db!) : "constant"}
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleFixed!(node.path);
              }}
              className="shrink-0 font-sans text-[11px] text-zinc-400 opacity-0 hover:text-amber-600 focus:opacity-100 group-hover:opacity-100"
              title="Tag this value as a constant"
              aria-label={`Tag ${node.key} as a constant`}
            >
              📌
            </button>
          ))}

        {/* More values this field can carry (a source in multi-source mode). */}
        {props.onSetMoreValues &&
          node.sample !== undefined &&
          node.type !== "object" &&
          node.type !== "array" &&
          (props.moreValues?.[id]?.length ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingMore((v) => !v);
              }}
              aria-expanded={editingMore}
              className={`shrink-0 rounded px-1.5 font-sans text-[10px] font-medium ${
                props.moreValueCases?.[id]?.some((c) => c.startsWith("!"))
                  ? "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-300"
                  : "bg-violet-100 text-violet-800 hover:bg-violet-200 dark:bg-violet-950 dark:text-violet-300"
              }`}
              title="More values for this field. Click to edit."
            >
              +{props.moreValues[id].length} value{props.moreValues[id].length === 1 ? "" : "s"}
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingMore(true);
              }}
              className="shrink-0 font-sans text-[11px] text-zinc-400 opacity-0 hover:text-violet-600 focus:opacity-100 group-hover:opacity-100"
              title="Add more values for this field (e.g. other messages for the same error)"
              aria-label={`Add more values for ${node.key}`}
            >
              ＋values
            </button>
          ))}

        <span className="ml-auto flex items-center gap-1">
          {props.flagged?.has(id) && (
            <span className="shrink-0 rounded border border-dashed border-amber-400 px-1.5 font-sans text-[10px] text-amber-700 dark:border-amber-700 dark:text-amber-400">
              {props.flagged.get(id)}
            </span>
          )}
          {drop && <DropLabel text={drop.label} />}
          {highlight && !drop && (
            <span
              className="max-w-48 truncate rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
              style={{ backgroundColor: highlight.color }}
              title={highlight.note}
            >
              {highlight.note}
            </span>
          )}
          {editable && !isItem && !drop && (
            <span className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <IconButton title="Rename" onClick={() => setRenaming(true)}>
                ✎
              </IconButton>
              <IconButton title="Remove field" danger onClick={() => props.onRemove(node.path)}>
                ×
              </IconButton>
            </span>
          )}
          {color && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onUnmap(node.path);
              }}
              className="group/dot flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-2 ring-white transition-transform hover:scale-125 dark:ring-zinc-900"
              style={{ background: color }}
              title="Mapped — click to remove this field's mapping"
              aria-label={`Remove mapping for ${isItem ? "each item" : node.key}`}
            >
              <span className="text-[11px] font-bold leading-none text-white opacity-0 group-hover/dot:opacity-100">
                ×
              </span>
            </button>
          )}
        </span>
      </div>

      {editingMore && props.onSetMoreValues && node.sample !== undefined && (
        <MoreValuesEditor
          sample={node.sample}
          values={props.moreValues?.[id] ?? []}
          cases={props.moreValueCases?.[id]}
          sampleCase={props.sampleCase}
          onChange={(values) => props.onSetMoreValues!(node.path, values)}
          onDone={() => setEditingMore(false)}
          indent={8 + (depth + 1) * INDENT}
        />
      )}
      {editingFixed && props.fixed?.[id] !== undefined && (
        <div
          className="my-1 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-amber-300 bg-amber-50/50 py-1.5 pr-2 font-sans text-xs dark:border-amber-900 dark:bg-amber-950/20"
          style={{ paddingLeft: 8 + (depth + 1) * INDENT }}
        >
          <span className="text-zinc-600 dark:text-zinc-400">Constant</span>
          <ConstantFields
            draft={draftOf(props.fixed[id].value, props.fixed[id].db)}
            onChange={(d) => props.onSetFixed?.(node.path, fromDraft(d))}
          />
          <button
            onClick={() => {
              setEditingFixed(false);
              props.onToggleFixed?.(node.path);
            }}
            className="text-zinc-500 hover:text-red-600"
          >
            Untag
          </button>
          <button onClick={() => setEditingFixed(false)} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Done
          </button>
        </div>
      )}
      {open && node.type === "array" && (
        <ArrayExamples
          node={node}
          editable={editable}
          indent={8 + (depth + 1) * INDENT + 22}
          onSetArrayItems={props.onSetArrayItems}
        />
      )}
      {(open || props.visibleIds) && <Children {...props} node={node} depth={depth + 1} />}
    </div>
  );
}

/** "of <item type>" next to an array: a picker when editable, a label otherwise. */
function ArrayOf(props: FieldTreeProps & { node: FieldNode }) {
  const { node, editable } = props;
  const itemType = itemTypeOf(node);
  if (!editable) {
    return <span className="text-[11px] text-zinc-500">{itemType ? `of ${itemType}` : "empty"}</span>;
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-zinc-500" onClick={(e) => e.stopPropagation()}>
      of
      <select
        value={itemType ?? ""}
        onChange={(e) => props.onSetItemType(node.path, e.target.value as FieldType)}
        title="What each item in the list is"
        className={`rounded px-1 outline-none ${
          itemType ? TYPE_STYLES[itemType] : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
        }`}
      >
        {!itemType && (
          <option value="" disabled>
            choose…
          </option>
        )}
        {ITEM_TYPES.map((t) => (
          <option key={t} value={t}>
            {t === "object" ? "objects" : `${t}s`}
          </option>
        ))}
      </select>
    </span>
  );
}

function TypeBadge({ type }: { type: FieldType }) {
  return <span className={`rounded px-1.5 text-[11px] ${TYPE_STYLES[type]}`}>{type}</span>;
}

function TypeSelect({ value, onChange }: { value: FieldType; onChange: (t: FieldType) => void }) {
  return (
    <select
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as FieldType)}
      // Looks like the read-only badge; the outline on hover shows it can be changed.
      className={`cursor-pointer appearance-none rounded px-1.5 text-[11px] outline-none hover:ring-1 hover:ring-current focus:ring-1 focus:ring-blue-500 ${TYPE_STYLES[value]}`}
      title="Change type (resets value)"
    >
      {FIELD_TYPES.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

function IconButton({
  children,
  title,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex h-5 w-5 items-center justify-center rounded text-xs text-zinc-500 ${
        danger
          ? "hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950 dark:hover:text-red-300"
          : "hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function RenameInput({
  initial,
  siblings,
  onDone,
}: {
  initial: string;
  siblings: string[];
  onDone: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const clash = value !== initial && siblings.includes(value);
  const commit = () => onDone(value.trim() && !clash ? value.trim() : null);
  return (
    <input
      autoFocus
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onDone(null);
      }}
      className={`w-36 rounded border bg-white px-1 text-sm outline-none dark:bg-zinc-900 ${
        clash ? "border-red-500" : "border-blue-500"
      }`}
    />
  );
}

/** Always-visible "+ Add field" row that expands into an inline form. */
function AddFieldRow({
  depth,
  siblings,
  suggestion,
  inList,
  label,
  onAdd,
}: {
  depth: number;
  siblings: string[];
  suggestion: FieldSuggestion | null;
  inList: boolean;
  /** Replaces "Add field" (e.g. "Add header"). */
  label?: string;
  onAdd: (key: string, type: FieldType, itemType: FieldType | undefined, mapSelected: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const pad = { paddingLeft: 8 + depth * INDENT + 22 };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="block w-full rounded-md py-0.5 pr-2 text-left font-sans text-xs text-zinc-400 hover:bg-zinc-100 hover:text-blue-600 dark:hover:bg-zinc-800/70 dark:hover:text-blue-400"
        style={pad}
      >
        {suggestion ? (
          <span className="text-blue-500">
            + Add “{suggestion.key}” here, mapped from {suggestion.label}
          </span>
        ) : (
          `+ ${label ?? "Add field"}${inList ? " to each item" : ""}`
        )}
      </button>
    );
  }
  return (
    <AddFieldForm
      pad={pad}
      siblings={siblings}
      suggestion={suggestion}
      onAdd={onAdd}
      onClose={() => setOpen(false)}
    />
  );
}

function AddFieldForm({
  pad,
  siblings,
  suggestion,
  onAdd,
  onClose,
}: {
  pad: React.CSSProperties;
  siblings: string[];
  suggestion: FieldSuggestion | null;
  onAdd: (key: string, type: FieldType, itemType: FieldType | undefined, mapSelected: boolean) => void;
  onClose: () => void;
}) {
  const [key, setKey] = useState(suggestion?.key ?? "");
  const [type, setType] = useState<FieldType>(suggestion?.type ?? "string");
  const [itemType, setItemType] = useState<FieldType>(suggestion?.itemType ?? "object");
  const [map, setMap] = useState(Boolean(suggestion));
  const clash = siblings.includes(key.trim());
  const valid = key.trim() !== "" && !clash;

  const submit = () => {
    if (!valid) return;
    onAdd(key.trim(), type, type === "array" ? itemType : undefined, map && Boolean(suggestion));
    // Stay open for quick entry of the next field.
    setKey("");
    setMap(false);
  };

  return (
    <div
      className="my-1 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-blue-300 bg-blue-50/40 py-2 pr-2 font-sans text-xs dark:border-blue-900 dark:bg-blue-950/20"
      style={pad}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <input
        autoFocus
        placeholder="field name"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        className={`w-36 rounded border bg-white px-1.5 py-0.5 font-mono outline-none dark:bg-zinc-950 ${
          clash ? "border-red-500" : "border-zinc-300 focus:border-blue-500 dark:border-zinc-700"
        }`}
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as FieldType)}
        className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-950"
        aria-label="Type"
      >
        {FIELD_TYPES.map((t) => (
          <option key={t} value={t}>
            {t === "array" ? "array (list)" : t}
          </option>
        ))}
      </select>
      {type === "array" && (
        <label className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
          of
          <select
            value={itemType}
            onChange={(e) => setItemType(e.target.value as FieldType)}
            className="rounded border border-zinc-300 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-950"
            aria-label="Item type"
          >
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "object" ? "objects" : `${t}s`}
              </option>
            ))}
          </select>
        </label>
      )}
      {suggestion && (
        <label className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" checked={map} onChange={(e) => setMap(e.target.checked)} />
          map from <code className="text-blue-600 dark:text-blue-400">{suggestion.label}</code>
        </label>
      )}
      <button
        onClick={submit}
        disabled={!valid}
        className="rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-700 disabled:opacity-40"
      >
        Add
      </button>
      <button onClick={onClose} className="px-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        Done
      </button>
      {clash && <span className="w-full text-red-600 dark:text-red-400">A field with that name already exists here.</span>}
    </div>
  );
}

/** A field's example value: click to edit (booleans flip on click). */
function ValueEditor({ value, type, onChange }: { value: Json; type: FieldType; onChange: (v: Json) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const shown = JSON.stringify(value);
  const valueClass =
    "max-w-56 truncate rounded px-1 text-left font-mono text-xs text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100";

  if (type === "boolean") {
    return (
      <button
        className={valueClass}
        title="Click to flip"
        onClick={(e) => {
          e.stopPropagation();
          onChange(!value);
        }}
      >
        {shown}
      </button>
    );
  }

  if (!editing) {
    return (
      <button
        className={`${valueClass} ${value === "" ? "italic text-zinc-400" : ""}`}
        title="Click to edit the example value"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(typeof value === "string" ? value : String(value));
          setEditing(true);
        }}
      >
        {value === "" ? "add value" : shown}
      </button>
    );
  }

  const invalid = type === "number" && (draft.trim() === "" || Number.isNaN(Number(draft)));
  const commit = () => {
    setEditing(false);
    if (invalid) return;
    const next = type === "number" ? Number(draft) : draft;
    if (next !== value) onChange(next);
  };
  return (
    <input
      autoFocus
      value={draft}
      inputMode={type === "number" ? "decimal" : undefined}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      aria-label="Example value"
      className={`w-44 rounded border bg-white px-1 font-mono text-xs outline-none dark:bg-zinc-900 ${
        invalid ? "border-red-500" : "border-blue-500"
      }`}
    />
  );
}
