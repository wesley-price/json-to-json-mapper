// A mapping diagram drawn as one SVG: source rows on the left, target rows on
// the right, and a curved line per mapping. Used for the report's overview and
// for each mapping's close-up. Drawn from the data (not screenshotted), so it
// prints crisply and always fits.

import { HEADERS } from "@/lib/headers";
import { ARRAY_ITEM, type FieldNode, type FieldType, type Path, findNode, pathId } from "@/lib/json-tree";

export interface DiagramRow {
  id: string; // pathId, or a unique id for "… more" rows
  label: string;
  type?: FieldType;
  sample?: string;
  depth: number;
  /** A "… n more" placeholder rather than a field. */
  more?: boolean;
}

export interface DiagramLink {
  from: string; // pathId on the source side
  to: string; // pathId on the target side
  color: string;
}

const ROW = 20;
const HEAD = 30;
const COL = 340;
const GAP = 110;
const WIDTH = COL * 2 + GAP;
const CHAR = 6.6; // approx. width of one 11px monospace character
const INDENT = 14;

const TYPE_COLORS: Record<FieldType, string> = {
  string: "#047857",
  number: "#0369a1",
  boolean: "#b45309",
  object: "#6d28d9",
  array: "#a21caf",
  null: "#52525b",
};

const fit = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`);

function rowFor(node: FieldNode, depth: number): DiagramRow {
  const childCount = node.type === "object" ? node.children.length : 0;
  return {
    id: pathId(node.path),
    label: node.key === ARRAY_ITEM ? "each item" : node.key === HEADERS ? "Headers" : node.key,
    type: node.type,
    sample:
      node.sample !== undefined
        ? JSON.stringify(node.sample)
        : node.type === "array"
          ? `list of ${node.children[0]?.type ?? "?"}`
          : childCount
            ? `${childCount} field${childCount === 1 ? "" : "s"}`
            : undefined,
    depth,
  };
}

/** Every field of a tree, top to bottom. */
export function allRows(root: FieldNode): DiagramRow[] {
  const out: DiagramRow[] = [];
  const walk = (node: FieldNode, depth: number) => {
    for (const child of node.children) {
      out.push(rowFor(child, depth));
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** A close-up around one field: its ancestors, a few neighbours, and the field itself. */
export function excerptRows(root: FieldNode, path: Path, neighbours = 2): DiagramRow[] {
  const out: DiagramRow[] = [];
  for (let k = 1; k < path.length; k++) {
    const ancestor = findNode(root, path.slice(0, k));
    if (ancestor) out.push(rowFor(ancestor, k - 1));
  }
  const parent = findNode(root, path.slice(0, -1));
  const siblings = parent?.children ?? [];
  const at = siblings.findIndex((c) => pathId(c.path) === pathId(path));
  const depth = path.length - 1;
  const from = Math.max(0, at - neighbours);
  const to = Math.min(siblings.length, at + neighbours + 1);
  if (from > 0) out.push({ id: `more-before-${pathId(path)}`, label: `… ${from} more`, depth, more: true });
  for (const sib of siblings.slice(from, to)) out.push(rowFor(sib, depth));
  if (to < siblings.length) {
    out.push({ id: `more-after-${pathId(path)}`, label: `… ${siblings.length - to} more`, depth, more: true });
  }
  return out;
}

function Column({
  rows,
  x,
  title,
  linkColor,
  dotSide,
}: {
  rows: DiagramRow[];
  x: number;
  title: string;
  linkColor: Map<string, string>;
  dotSide: "left" | "right";
}) {
  return (
    <g>
      <rect x={x} y={0} width={COL} height={HEAD + rows.length * ROW + 8} rx={8} fill="#ffffff" stroke="#d4d4d8" />
      <text x={x + 10} y={19} fontSize={11} fontWeight={700} fill="#27272a" fontFamily="system-ui, sans-serif">
        {title}
      </text>
      <line x1={x} x2={x + COL} y1={HEAD - 2} y2={HEAD - 2} stroke="#e4e4e7" />
      {rows.map((row, i) => {
        const y = HEAD + i * ROW;
        const color = linkColor.get(row.id);
        // Leave room for the connector dot on whichever edge it sits.
        const pad = dotSide === "left" ? 22 : 10;
        const tx = x + pad + row.depth * INDENT;
        const room = Math.floor((COL - pad - 24 - row.depth * INDENT) / CHAR);
        const label = fit(row.label, Math.max(4, room - 8));
        const type = row.type && !row.more ? row.type : "";
        const sampleRoom = room - label.length - type.length - 3;
        const sample = row.sample && sampleRoom > 3 ? fit(row.sample, sampleRoom) : "";
        return (
          <g key={row.id}>
            {color && <rect x={x + 3} y={y + 1} width={COL - 6} height={ROW - 2} rx={4} fill={color} fillOpacity={0.12} />}
            <text
              x={tx}
              y={y + 14}
              fontSize={11}
              fontFamily="ui-monospace, Consolas, Menlo, monospace"
              xmlSpace="preserve"
            >
              <tspan fill={row.more ? "#a1a1aa" : "#18181b"} fontWeight={color ? 700 : 400} fontStyle={row.more ? "italic" : undefined}>
                {label}
              </tspan>
              {type && (
                <tspan dx={CHAR} fill={TYPE_COLORS[row.type!]} fontSize={10}>
                  {type}
                </tspan>
              )}
              {sample && (
                <tspan dx={CHAR} fill="#71717a">
                  {sample}
                </tspan>
              )}
            </text>
            {color && <circle cx={dotSide === "right" ? x + COL - 9 : x + 9} cy={y + ROW / 2} r={4} fill={color} />}
          </g>
        );
      })}
    </g>
  );
}

export function MappingDiagram({
  source,
  target,
  links,
  sourceTitle,
  targetTitle,
  maxHeight,
  diagramId,
}: {
  source: DiagramRow[];
  target: DiagramRow[];
  links: DiagramLink[];
  sourceTitle: string;
  targetTitle: string;
  /** CSS max-height, e.g. so the overview fits on one printed page. */
  maxHeight?: string;
  /** Lets the PDF export find this diagram ("overview" or a mapping id). */
  diagramId?: string;
}) {
  const height = HEAD + Math.max(source.length, target.length, 1) * ROW + 10;
  const srcY = new Map(source.map((r, i) => [r.id, HEAD + i * ROW + ROW / 2]));
  const dstY = new Map(target.map((r, i) => [r.id, HEAD + i * ROW + ROW / 2]));
  const srcColor = new Map<string, string>();
  const dstColor = new Map<string, string>();
  for (const l of links) {
    if (!srcColor.has(l.from)) srcColor.set(l.from, l.color);
    dstColor.set(l.to, l.color);
  }
  const x1 = COL - 9;
  const x2 = COL + GAP + 9;
  const mid = (x1 + x2) / 2;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      preserveAspectRatio="xMidYMin meet"
      style={{ width: "100%", height: "auto", maxHeight, display: "block" }}
      data-diagram={diagramId}
      role="img"
      aria-label={`${sourceTitle} mapped to ${targetTitle}`}
    >
      <Column rows={source} x={0} title={sourceTitle} linkColor={srcColor} dotSide="right" />
      <Column rows={target} x={COL + GAP} title={targetTitle} linkColor={dstColor} dotSide="left" />
      {links.map((l, i) => {
        const ya = srcY.get(l.from);
        const yb = dstY.get(l.to);
        if (ya === undefined || yb === undefined) return null;
        return (
          <g key={i}>
            <path
              d={`M ${x1} ${ya} C ${mid} ${ya}, ${mid} ${yb}, ${x2 - 6} ${yb}`}
              fill="none"
              stroke={l.color}
              strokeWidth={1.8}
            />
            <path d={`M ${x2 - 12} ${yb - 4} L ${x2 - 5} ${yb} L ${x2 - 12} ${yb + 4}`} fill="none" stroke={l.color} strokeWidth={1.8} />
          </g>
        );
      })}
    </svg>
  );
}

/** A close-up around several fields at once: each field plus its parents, in tree order. */
export function excerptRowsMany(root: FieldNode, paths: Path[]): DiagramRow[] {
  const keep = new Set<string>();
  for (const p of paths) for (let k = 1; k <= p.length; k++) keep.add(pathId(p.slice(0, k)));
  return allRows(root).filter((row) => keep.has(row.id));
}

/** A source row standing for a constant value (constants have no field in the source tree). */
/** Above this many rows, a diagram shows only the mapped fields (and their parents). */
export const DIAGRAM_ROW_LIMIT = 45;

/** Every row, or for a big object only the fields in `keep` (with their parents); `hidden` counts the rest. */
export function rowsFor(root: FieldNode, keep: Path[]): { rows: DiagramRow[]; hidden: number } {
  const all = allRows(root);
  if (all.length <= DIAGRAM_ROW_LIMIT) return { rows: all, hidden: 0 };
  const rows = excerptRowsMany(root, keep);
  return { rows, hidden: all.length - rows.length };
}

export function constantRow(path: Path, value: unknown, db?: { table: string; column: string }): DiagramRow {
  return {
    id: pathId(path),
    label: db ? `db ${db.table}.${db.column}` : JSON.stringify(value ?? ""),
    type: undefined,
    sample: db ? "database constant" : "constant",
    depth: 0,
  };
}
