"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DragGhost } from "./drag";
import { FlatLayoutEditor } from "./FlatLayoutEditor";
import { AppMenu } from "./AppMenu";
import { type FieldHighlight, FieldTree } from "./FieldTree";
import {
  type FieldNode,
  type FieldType,
  type Json,
  type Mapping,
  type Path,
  type Side,
  addField,
  allPaths,
  applyMappings,
  buildTree,
  findNode,
  flatten,
  isPrefix,
  joinsFor,
  moveField,
  pathId,
  pathLabel,
  removeField,
  renameField,
  setArrayItemType,
  setArrayItems,
  setFieldType,
  setValueAt,
  valuesAt,
} from "@/lib/json-tree";
import {
  type FlatLayout,
  type Format,
  FORMATS,
  PLACEHOLDERS,
  defaultFlatLayout,
  formatInfo,
  readFormat,
  writeFormat,
} from "@/lib/formats";
import { SECTIONS, type SectionName, guessDelimiter, syncLayoutFields } from "@/lib/formats/flat";
import { EXAMPLES } from "@/lib/examples";
import { buildWorkbook, parseWorkbook } from "@/lib/workbook";
import { downloadXlsx, readXlsx } from "@/lib/xlsx";

const STORAGE_KEY = "object-mapper:v1";
const HINT_KEY = "object-mapper:knows-click-to-map";
const OUTPUT_COLLAPSED_KEY = "object-mapper:output-collapsed";
const COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"];

interface SideState {
  /** The file as text, in this side's format. */
  text: string;
  data: Json | null;
  error: string | null;
  editingText: boolean;
  format: Format;
  /** How a flat file is laid out (only used when format is "flat"). */
  layout: FlatLayout;
}

interface Selection {
  side: Side;
  path: Path;
}

const emptySide = (): SideState => ({
  text: "",
  data: null,
  error: null,
  editingText: true,
  format: "json",
  layout: defaultFlatLayout(),
});

/** Field names per flat-file section, from the data. */
function sectionFields(data: Json | null): Record<SectionName, string[]> {
  const out = { header: [], body: [], footer: [] } as Record<SectionName, string[]>;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return out;
  for (const name of SECTIONS) {
    const v = (data as Record<string, Json>)[name];
    const first = Array.isArray(v) ? v[0] : v;
    if (typeof first === "object" && first !== null && !Array.isArray(first)) out[name] = Object.keys(first);
  }
  return out;
}
const other = (side: Side): Side => (side === "left" ? "right" : "left");
const newId = () => Math.random().toString(36).slice(2, 10);

export default function ObjectMapper() {
  const [sides, setSides] = useState<Record<Side, SideState>>({
    left: emptySide(),
    right: emptySide(),
  });
  const [primary, setPrimary] = useState<Side>("left");
  // Off: the primary's structure is locked (its values can still be edited). On: both sides fully editable.
  const [bothEditable, setBothEditable] = useState(false);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Once someone has mapped by clicking, the "now click the other side" hint is noise.
  const [knowsClickToMap, setKnowsClickToMap] = useState(false);

  const secondary = other(primary);

  // ---------- persistence ----------
  useEffect(() => {
    try {
      setKnowsClickToMap(localStorage.getItem(HINT_KEY) === "1");
    } catch {
      // storage unavailable; keep showing the hint
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setSides({
          left: { ...emptySide(), ...saved.sides.left, error: null },
          right: { ...emptySide(), ...saved.sides.right, error: null },
        });
        setPrimary(saved.primary ?? "left");
        setMappings(saved.mappings ?? []);
        setBothEditable(saved.bothEditable === true);
      }
    } catch {
      // ignore unreadable saved state
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sides, primary, mappings, bothEditable }));
    } catch {
      // storage unavailable; the app still works without it
    }
  }, [sides, primary, mappings, bothEditable, loaded]);

  // ---------- derived trees ----------
  const trees = useMemo(
    () => ({
      left: sides.left.data !== null ? buildTree(sides.left.data) : null,
      right: sides.right.data !== null ? buildTree(sides.right.data) : null,
    }),
    [sides.left.data, sides.right.data],
  );

  // Colors stick to a mapping, so removing one doesn't recolor the others.
  const [colorFor, setColorFor] = useState(() => new Map<string, string>());
  const missingColor = mappings.some((m) => !colorFor.has(m.id));
  if (missingColor) {
    const next = new Map<string, string>();
    for (const m of mappings) {
      const kept = colorFor.get(m.id);
      if (kept) next.set(m.id, kept);
    }
    for (const m of mappings) {
      if (next.has(m.id)) continue;
      const used = new Set(next.values());
      const free = COLORS.find((c) => !used.has(c)) ?? COLORS[next.size % COLORS.length];
      next.set(m.id, free);
    }
    setColorFor(next); // adjusting state during render: React re-renders before painting
  }

  const mappedColors = useMemo(() => {
    const result: Record<Side, Map<string, string>> = { left: new Map(), right: new Map() };
    for (const m of mappings) {
      const c = colorFor.get(m.id)!;
      result.left.set(pathId(m.left), c);
      result.right.set(pathId(m.right), c);
    }
    return result;
  }, [mappings, colorFor]);

  // ---------- data edits ----------
  /** Replace a side's data and drop mappings that point at fields that no longer exist. */
  const commitData = useCallback(
    (side: Side, data: Json | null, rewrite?: (m: Mapping) => Mapping, keepText = false) => {
      setSides((s) => {
        const cur = s[side];
        if (data === null) return { ...s, [side]: { ...cur, data } };
        const layout = cur.format === "flat" ? syncLayoutFields(cur.layout, data) : cur.layout;
        const text = keepText ? cur.text : writeFormat(cur.format, data, layout);
        return { ...s, [side]: { ...cur, data, layout, text } };
      });
      const valid = data === null ? new Set<string>() : allPaths(buildTree(data));
      setMappings((ms) =>
        ms.map((m) => (rewrite ? rewrite(m) : m)).filter((m) => valid.has(pathId(m[side]))),
      );
      setSelected((sel) => (sel && sel.side === side && !valid.has(pathId(sel.path)) ? null : sel));
    },
    [],
  );

  /** Read a side's text with its format (and flat layout). */
  const readSide = (side: Side, layout: FlatLayout) => {
    const st = sides[side];
    const text = st.text.trim();
    if (!text) {
      setSides((s) => ({ ...s, [side]: { ...s[side], error: `Paste some ${formatInfo(st.format).label} first.` } }));
      return;
    }
    try {
      const { data, warnings } = readFormat(st.format, text, layout);
      setSides((s) => ({ ...s, [side]: { ...s[side], layout, error: null, editingText: false } }));
      // Keep the pasted text as-is rather than re-printing it.
      commitData(side, data, undefined, true);
      if (warnings.length) {
        setNotice({ kind: "ok", text: `Read the ${side} file, but some lines were skipped.`, details: warnings });
      }
    } catch (e) {
      setSides((s) => ({ ...s, [side]: { ...s[side], error: (e as Error).message } }));
    }
  };

  const loadText = (side: Side) => {
    const st = sides[side];
    let layout = st.layout;
    // First read of a flat file: guess how its fields are separated.
    if (st.format === "flat" && SECTIONS.every((n) => layout[n].fields.length === 0)) {
      layout = { ...layout, delimiter: guessDelimiter(st.text.trim()) };
    }
    readSide(side, layout);
  };

  /** Switch a side's format. Loaded data is kept and shown in the new format. */
  const changeFormat = (side: Side, format: Format) =>
    setSides((s) => {
      const cur = s[side];
      const text = cur.data === null ? cur.text : writeFormat(format, cur.data, cur.layout);
      return { ...s, [side]: { ...cur, format, text, error: null } };
    });

  /** New flat layout: the source file is re-read with it; the target file is re-written with it. */
  const applyLayout = (side: Side, layout: FlatLayout) => {
    const st = sides[side];
    if (side === primary && st.text.trim()) {
      readSide(side, layout);
      return;
    }
    setSides((s) => {
      const cur = s[side];
      const text = cur.data === null ? cur.text : writeFormat(cur.format, cur.data, layout);
      return { ...s, [side]: { ...cur, layout, text } };
    });
  };

  /** Give a target object the header / body / footer fields a flat file is written from. */
  const addFlatSections = (side: Side) => {
    const data = sides[side].data;
    const base = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
    commitData(side, { header: {}, body: [{}], footer: {}, ...base });
  };

  /** Load an order (source, left) and an empty invoice (target, right) in the chosen formats. */
  const loadExample = (sourceFormat: Format, targetFormat: Format) => {
    const example = (role: "source" | "target", format: Format): SideState => {
      const { text, layout } = EXAMPLES[role][format];
      return { ...emptySide(), format, layout, text, data: readFormat(format, text, layout).data, editingText: false };
    };
    setSides({ left: example("source", sourceFormat), right: example("target", targetFormat) });
    setPrimary("left");
    setMappings([]);
    setSelected(null);
    setNotice(null);
  };

  const resetAll = () => {
    // Keep each side's chosen format and layout.
    setSides((s) => ({
      left: { ...emptySide(), format: s.left.format, layout: s.left.layout },
      right: { ...emptySide(), format: s.right.format, layout: s.right.layout },
    }));
    setMappings([]);
    setSelected(null);
  };

  // ---------- mapping ----------
  // A new source for a target that already has one: combine the two, or replace the old one?
  const [pendingCombine, setPendingCombine] = useState<{ left: Path; right: Path } | null>(null);

  /** Add a mapping; "combine" keeps the target's other sources (their values are joined). */
  const addMapping = useCallback(
    (left: Path, right: Path, mode: "combine" | "replace") =>
      setMappings((ms) => {
        const target = secondary === "left" ? left : right;
        const sameTarget = (m: Mapping) => pathId(m[secondary]) === pathId(target);
        if (mode === "replace") return [...ms.filter((m) => !sameTarget(m)), { id: newId(), left, right }];
        const join = ms.find(sameTarget)?.join;
        return [...ms, { id: newId(), left, right, ...(join !== undefined ? { join } : {}) }];
      }),
    [secondary],
  );

  const createMapping = useCallback(
    (a: Selection, b: Selection) => {
      if (a.side === b.side) return;
      const left = a.side === "left" ? a.path : b.path;
      const right = a.side === "right" ? a.path : b.path;
      if (left.length === 0 || right.length === 0) return;
      const source = primary === "left" ? left : right;
      const target = secondary === "left" ? left : right;
      const existing = mappings.filter((m) => pathId(m[secondary]) === pathId(target));
      if (existing.some((m) => pathId(m[primary]) === pathId(source))) return; // already mapped
      if (existing.length === 0) addMapping(left, right, "replace");
      else setPendingCombine({ left, right });
    },
    [primary, secondary, mappings, addMapping],
  );

  const handleSelect = (side: Side, path: Path) => {
    if (selected && selected.side !== side) {
      createMapping(selected, { side, path });
      setSelected(null);
      if (!knowsClickToMap) {
        setKnowsClickToMap(true);
        try {
          localStorage.setItem(HINT_KEY, "1");
        } catch {
          // not persisted; the hint stays hidden for this visit only
        }
      }
    } else if (selected && pathId(selected.path) === pathId(path)) {
      setSelected(null);
    } else {
      setSelected({ side, path });
    }
  };

  // ---------- removing mappings (with undo) ----------
  // What is being hovered: one line, one list row, or a field (all of its mappings).
  const [hover, setHover] = useState<{ ids: string[]; via: "line" | "list" | "field" } | null>(null);
  const hoveredIds = hover?.ids ?? null;
  const [undo, setUndo] = useState<{ removed: { m: Mapping; index: number }[]; text: string } | null>(null);

  const removeMappings = (ids: string[]) => {
    const removed = mappings.flatMap((m, index) => (ids.includes(m.id) ? [{ m, index }] : []));
    if (removed.length === 0) return;
    setMappings((ms) => ms.filter((m) => !ids.includes(m.id)));
    setHover(null);
    const only = removed[0].m;
    setUndo({
      removed,
      text:
        removed.length === 1
          ? `Removed ${pathLabel(only[primary])} → ${pathLabel(only[secondary])}`
          : `Removed ${removed.length} mappings`,
    });
  };

  /** Remove every mapping that uses this field. */
  const unmapField = (side: Side, path: Path) =>
    removeMappings(mappings.filter((m) => pathId(m[side]) === pathId(path)).map((m) => m.id));

  /** Hovering a field spotlights its mappings, including those of anything inside it. */
  const hoverField = (side: Side, path: Path | null) => {
    if (!path) {
      setHover((h) => (h?.via === "field" ? null : h));
      return;
    }
    const ids = mappings.filter((m) => isPrefix(path, m[side])).map((m) => m.id);
    setHover(ids.length ? { ids, via: "field" } : null);
  };

  // Fields at either end of the spotlighted mappings, with a note naming the other end.
  const highlights = useMemo(() => {
    const out: Record<Side, Map<string, FieldHighlight>> = { left: new Map(), right: new Map() };
    if (!hoveredIds) return out;
    const add = (side: Side, path: Path, color: string, note: string) => {
      const id = pathId(path);
      const existing = out[side].get(id);
      out[side].set(id, existing ? { color: existing.color, note: `${existing.note}, ${note.slice(2)}` } : { color, note });
    };
    for (const m of mappings) {
      if (!hoveredIds.includes(m.id)) continue;
      const color = colorFor.get(m.id) ?? COLORS[0];
      add(primary, m[primary], color, `→ ${pathLabel(m[secondary])}`);
      add(secondary, m[secondary], color, `← ${pathLabel(m[primary])}`);
    }
    return out;
  }, [hoveredIds, mappings, colorFor, primary, secondary]);

  const undoRemove = () => {
    if (!undo) return;
    setMappings((ms) => {
      const next = [...ms];
      for (const { m, index } of undo.removed) {
        // Skip a mapping that has been re-created since.
        if (next.some((n) => pathId(n.left) === pathId(m.left) && pathId(n.right) === pathId(m.right))) continue;
        next.splice(Math.min(index, next.length), 0, m);
      }
      return next;
    });
    setUndo(null);
  };

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);

  // Suggest key/type when adding a field on the editable side while a primary field is selected.
  const suggestion = useMemo(() => {
    if (!selected || selected.side !== primary) return null;
    const tree = trees[primary];
    const node = tree && findNode(tree, selected.path);
    if (!node) return null;
    const key = [...node.path].reverse().find((s) => s !== "[]") ?? "field";
    return { key, type: node.type, itemType: node.children[0]?.type, label: pathLabel(node.path) };
  }, [selected, primary, trees]);

  const editHandlers = (side: Side) => {
    const data = sides[side].data;
    return {
      onAdd: (parent: Path, key: string, type: FieldType, itemType: FieldType | undefined, mapSelected: boolean) => {
        if (data === null) return;
        commitData(side, addField(data, parent, key, type, itemType));
        if (mapSelected && selected && selected.side !== side) {
          createMapping(selected, { side, path: [...parent, key] });
          setSelected(null);
        }
      },
      onRemove: (path: Path) => {
        if (data !== null) commitData(side, removeField(data, path));
      },
      onRename: (path: Path, newKey: string) => {
        if (data === null) return;
        const renamed = [...path.slice(0, -1), newKey];
        commitData(side, renameField(data, path, newKey), (m) =>
          isPrefix(path, m[side])
            ? { ...m, [side]: [...renamed, ...m[side].slice(path.length)] }
            : m,
        );
      },
      onRetype: (path: Path, type: FieldType) => {
        if (data !== null) commitData(side, setFieldType(data, path, type));
      },
      onSetValue: (path: Path, value: Json) => {
        if (data !== null) commitData(side, setValueAt(data, path, value));
      },
      onSetArrayItems: (path: Path, items: Json[]) => {
        if (data !== null) commitData(side, setArrayItems(data, path, items));
      },
      onSetItemType: (path: Path, itemType: FieldType) => {
        if (data !== null) commitData(side, setArrayItemType(data, path, itemType));
      },
      onMoveField: (from: Path, parent: Path, after?: string) => {
        if (data === null) return;
        const moved = moveField(data, from, parent, after);
        if ("error" in moved) {
          setNotice({ kind: "error", text: `Couldn't move that field: ${moved.error}`, details: [] });
          return;
        }
        setNotice(null);
        // Mappings to the field (or anything inside it) follow it to its new place.
        commitData(side, moved.data, (m) =>
          isPrefix(from, m[side])
            ? { ...m, [side]: [...moved.path, ...m[side].slice(from.length)] }
            : m,
        );
      },
    };
  };

  // ---------- output ----------
  const primaryTree = trees[primary];
  const secondaryTree = trees[secondary];
  const result = useMemo(() => {
    const src = sides[primary].data;
    const tpl = sides[secondary].data;
    if (src === null || tpl === null) return null;
    return applyMappings(
      src,
      tpl,
      mappings.map((m) => ({ from: m[primary], to: m[secondary] })),
      joinsFor(mappings, secondary),
    );
  }, [sides, primary, secondary, mappings]);

  /** Set the separator for every mapping into the target `targetId`. */
  const setJoin = (targetId: string, join: string) =>
    setMappings((ms) => ms.map((m) => (pathId(m[secondary]) === targetId ? { ...m, join } : m)));

  /** Move a mapping up/down among the mappings that share its target (the join order). */
  const moveInGroup = (id: string, dir: -1 | 1) =>
    setMappings((ms) => {
      const i = ms.findIndex((m) => m.id === id);
      if (i < 0) return ms;
      const target = pathId(ms[i][secondary]);
      let j = i + dir;
      while (j >= 0 && j < ms.length && pathId(ms[j][secondary]) !== target) j += dir;
      if (j < 0 || j >= ms.length) return ms;
      const next = [...ms];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const resultText = useMemo(() => {
    if (result === null) return null;
    const target = sides[secondary];
    return writeFormat(target.format, result, target.layout);
  }, [result, sides, secondary]);

  const downloadResult = () => {
    if (resultText === null) return;
    const info = formatInfo(sides[secondary].format);
    const url = URL.createObjectURL(new Blob([resultText], { type: info.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `mapped-result.${info.extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportExcel = () =>
    downloadXlsx(
      "object-mapping.xlsx",
      buildWorkbook({
        primary,
        data: { left: sides.left.data, right: sides.right.data },
        mappings,
        result,
        formats: {
          left: { format: sides.left.format, layout: sides.left.layout },
          right: { format: sides.right.format, layout: sides.right.layout },
        },
      }),
    );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string; details: string[] } | null>(
    null,
  );

  const importExcel = async (file: File) => {
    try {
      const imported = parseWorkbook(await readXlsx(await file.arrayBuffer()));
      const hasWork = sides.left.data !== null || sides.right.data !== null || mappings.length > 0;
      if (hasWork && !window.confirm(`Replace the current objects and mappings with "${file.name}"?`)) return;
      const sideFrom = (side: Side): SideState => {
        const { format, layout } = imported.formats[side];
        const data = imported.data[side];
        return { ...emptySide(), format, layout, data, text: writeFormat(format, data, layout), editingText: false };
      };
      setSides({ left: sideFrom("left"), right: sideFrom("right") });
      setPrimary(imported.primary);
      setMappings(imported.mappings.map((m) => ({ ...m, id: newId() })));
      setSelected(null);
      const n = imported.mappings.length;
      setNotice({
        kind: "ok",
        text: `Imported "${file.name}": ${n} mapping${n === 1 ? "" : "s"}, ${imported.primary} side is primary.`,
        details: imported.warnings,
      });
    } catch (e) {
      setNotice({ kind: "error", text: `Couldn't import "${file.name}": ${(e as Error).message}`, details: [] });
    }
  };

  const mappingSpec = useMemo(() => {
    const groups = new Map<string, Mapping[]>();
    for (const m of mappings) {
      const id = pathId(m[secondary]);
      groups.set(id, [...(groups.get(id) ?? []), m]);
    }
    return [...groups.values()].map((g) =>
      g.length === 1
        ? { from: pathLabel(g[0][primary]), to: pathLabel(g[0][secondary]) }
        : {
            from: g.map((m) => pathLabel(m[primary])),
            to: pathLabel(g[0][secondary]),
            join: g.find((m) => m.join !== undefined)?.join ?? " ",
          },
    );
  }, [mappings, primary, secondary]);

  // ---------- connector lines ----------
  const workspaceRef = useRef<HTMLDivElement>(null);
  const panelRefs = { left: useRef<HTMLDivElement>(null), right: useRef<HTMLDivElement>(null) };
  const [lines, setLines] = useState<
    { id: string; d: string; mx: number; my: number; color: string; x2: number; y2: number; dir: Side }[]
  >([]);
  const [layoutTick, setLayoutTick] = useState(0);
  const bump = useCallback(() => setLayoutTick((t) => t + 1), []);

  useEffect(() => {
    window.addEventListener("resize", bump);
    const ro = new ResizeObserver(bump);
    const panels = [panelRefs.left.current, panelRefs.right.current].filter(Boolean) as HTMLElement[];
    panels.forEach((p) => {
      ro.observe(p);
      p.addEventListener("scroll", bump, { passive: true });
      // Expanding/collapsing rows changes layout without resizing the scroll box.
      if (p.firstElementChild) ro.observe(p.firstElementChild);
    });
    return () => {
      window.removeEventListener("resize", bump);
      ro.disconnect();
      panels.forEach((p) => p.removeEventListener("scroll", bump));
    };
    // panelRefs are stable; re-run when panels mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump, sides.left.editingText, sides.right.editingText, trees.left === null, trees.right === null]);

  useLayoutEffect(() => {
    const ws = workspaceRef.current;
    const lp = panelRefs.left.current;
    const rp = panelRefs.right.current;
    if (!ws || !lp || !rp || window.innerWidth < 1024) {
      setLines([]);
      return;
    }
    const wsBox = ws.getBoundingClientRect();
    const lBox = lp.getBoundingClientRect();
    const rBox = rp.getBoundingClientRect();

    const rowY = (side: Side, path: Path, box: DOMRect) => {
      // Fall back to the nearest visible ancestor when a row is collapsed.
      for (let n = path.length; n > 0; n--) {
        const el = (side === "left" ? lp : rp).querySelector<HTMLElement>(
          `[data-pid="${CSS.escape(pathId(path.slice(0, n)))}"]`,
        );
        if (el) {
          const r = el.getBoundingClientRect();
          const y = r.top + r.height / 2;
          return Math.min(Math.max(y, box.top + 4), box.bottom - 4) - wsBox.top;
        }
      }
      return null;
    };

    const x1 = lBox.right - wsBox.left;
    const x2 = rBox.left - wsBox.left;
    const next = [];
    for (const m of mappings) {
      const y1 = rowY("left", m.left, lBox);
      const y2 = rowY("right", m.right, rBox);
      if (y1 === null || y2 === null) continue;
      const mid = (x1 + x2) / 2;
      next.push({
        id: m.id,
        d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
        // The curve is symmetric, so its midpoint is the midpoint of its ends.
        mx: mid,
        my: (y1 + y2) / 2,
        color: colorFor.get(m.id)!,
        x2: primary === "left" ? x2 : x1,
        y2: primary === "left" ? y2 : y1,
        dir: primary === "left" ? ("right" as Side) : ("left" as Side),
      });
    }
    setLines(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappings, trees, layoutTick, colorFor, primary]);

  // ---------- render ----------
  const renderPanel = (side: Side) => {
    const state = sides[side];
    const tree = trees[side];
    const isPrimary = side === primary;
    const showTree = tree && !state.editingText;
    const label = formatInfo(state.format).label;

    return (
      <section className="flex min-w-0 flex-col rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <h2 className="text-sm font-semibold capitalize">{side} object</h2>
          {isPrimary ? (
            <span
              className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white"
              title={
                bothEditable
                  ? "Values flow from this side. Its fields can be edited."
                  : "Values flow from this side. Its fields are locked, but you can click a value to change it."
              }
            >
              {bothEditable ? "✎ Primary · source" : "🔒 Primary · source"}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              ✎ Editable · target
            </span>
          )}
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            Format
            <select
              value={state.format}
              onChange={(e) => changeFormat(side, e.target.value as Format)}
              aria-label={`${side} file format`}
              className="rounded-md border border-zinc-300 bg-white py-0.5 pl-1.5 pr-1 text-xs font-medium text-zinc-800 outline-none hover:border-zinc-400 focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex gap-1">
            {!isPrimary && (
              <HeaderButton onClick={() => setPrimary(side)}>Make primary</HeaderButton>
            )}
            {showTree && (
              <HeaderButton
                onClick={() => setSides((s) => ({ ...s, [side]: { ...s[side], editingText: true } }))}
              >
                {isPrimary ? `Replace ${label}` : `Edit ${label}`}
              </HeaderButton>
            )}
          </div>
        </header>

        {state.format === "flat" && (
          <FlatLayoutEditor
            key={JSON.stringify(state.layout)}
            layout={state.layout}
            role={isPrimary ? "source" : "target"}
            currentFields={sectionFields(state.data)}
            hasSections={SECTIONS.some((n) => sectionFields(state.data)[n].length > 0)}
            onApply={(layout) => applyLayout(side, layout)}
            onAddSections={() => addFlatSections(side)}
          />
        )}

        {showTree ? (
          <div ref={panelRefs[side]} data-drag-scroll className="max-h-[65vh] min-h-64 overflow-auto p-2">
            <div>
              <FieldTree
                root={tree as FieldNode}
                side={side}
                editable={!isPrimary || bothEditable}
                selectedId={selected?.side === side ? pathId(selected.path) : null}
                mappedColors={mappedColors[side]}
                suggestion={isPrimary ? null : suggestion}
                onSelect={(path) => handleSelect(side, path)}
                onDropField={(path, from) => createMapping(from, { side, path })}
                onUnmap={(path) => unmapField(side, path)}
                highlights={highlights[side]}
                onHoverField={(path) => hoverField(side, path)}
                {...editHandlers(side)}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-2 p-3">
            <textarea
              value={state.text}
              onChange={(e) =>
                setSides((s) => ({ ...s, [side]: { ...s[side], text: e.target.value, error: null } }))
              }
              placeholder={`Paste the ${isPrimary ? "primary (source)" : "target"} ${label} here, e.g.\n\n${PLACEHOLDERS[state.format]}`}
              spellCheck={false}
              className="min-h-64 flex-1 resize-y rounded-md border border-zinc-300 bg-zinc-50 p-2 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
            />
            {state.error && <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => loadText(side)}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Load
              </button>
              {tree && (
                <button
                  onClick={() => setSides((s) => ({ ...s, [side]: { ...s[side], editingText: false, error: null } }))}
                  className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              )}
            </div>
            {!isPrimary && (
              <p className="text-xs text-zinc-500">
                Tip: paste <code>{"{}"}</code> to start the target from scratch and build it field by field.
              </p>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Object Mapper</h1>
          <p className="text-sm text-zinc-500">
            Click a field on one side, then a field on the other (or drag between them) to map it.
            Drag fields within the editable side to move them into objects or lists.
            Values flow from the 🔒 primary object into the editable one.
          </p>
        </div>
        <div className="ml-auto">
          <AppMenu
            bothEditable={bothEditable}
            onBothEditable={setBothEditable}
            onSwap={() => setPrimary(secondary)}
            onExport={exportExcel}
            exportDisabled={sides.left.data === null && sides.right.data === null}
            onImport={() => fileInputRef.current?.click()}
            onLoadExample={loadExample}
            onClear={resetAll}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // allow re-importing the same file
              if (file) importExcel(file);
            }}
          />
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            notice.kind === "error"
              ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              : notice.details.length
                ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          }`}
        >
          <div className="flex items-start gap-2">
            <p className="flex-1">
              {notice.text}
              {notice.details.length > 0 &&
                ` ${notice.details.length} row${notice.details.length === 1 ? " was" : "s were"} skipped:`}
            </p>
            <button className="opacity-60 hover:opacity-100" onClick={() => setNotice(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
          {notice.details.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {notice.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selected && !knowsClickToMap && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          Selected <code className="font-semibold">{pathLabel(selected.path)}</code> on the {selected.side}.
          Now click a field on the {other(selected.side)} side to map it
          {selected.side === primary && ", or use + on the target to create a new mapped field"}.{" "}
          <button className="underline" onClick={() => setSelected(null)}>
            Cancel
          </button>
        </div>
      )}

      <div ref={workspaceRef} className="relative grid grid-cols-1 gap-4 lg:grid-cols-[1fr_72px_1fr] lg:gap-0">
        {renderPanel("left")}
        <div className="hidden items-start justify-center pt-3 text-xl text-zinc-400 lg:flex" aria-hidden>
          {primary === "left" ? "→" : "←"}
        </div>
        {renderPanel("right")}
        <svg className="pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible lg:block">
          {lines.map((l) => {
            const active = hoveredIds?.includes(l.id) ?? false;
            const dimmed = hoveredIds !== null && !active;
            return (
              <g
                key={l.id}
                onMouseEnter={() => setHover({ ids: [l.id], via: "line" })}
                onMouseLeave={() => setHover(null)}
              >
                {/* Wide invisible stroke so the thin line is easy to hover. */}
                <path d={l.d} fill="none" stroke="transparent" strokeWidth={14} style={{ pointerEvents: "stroke" }} />
                <path
                  d={l.d}
                  fill="none"
                  stroke={l.color}
                  strokeWidth={active ? 3.5 : 2}
                  strokeOpacity={dimmed ? 0.12 : 0.85}
                />
                <path
                  d={
                    l.dir === "right"
                      ? `M ${l.x2 - 7} ${l.y2 - 4} L ${l.x2} ${l.y2} L ${l.x2 - 7} ${l.y2 + 4}`
                      : `M ${l.x2 + 7} ${l.y2 - 4} L ${l.x2} ${l.y2} L ${l.x2 + 7} ${l.y2 + 4}`
                  }
                  fill="none"
                  stroke={l.color}
                  strokeOpacity={dimmed ? 0.12 : 1}
                  strokeWidth={2}
                />
                {active && hover?.via === "line" && (
                  <g
                    role="button"
                    aria-label="Remove mapping"
                    data-remove-mapping={l.id}
                    style={{ pointerEvents: "auto", cursor: "pointer" }}
                    onClick={() => removeMappings([l.id])}
                  >
                    <title>Remove mapping</title>
                    <circle cx={l.mx} cy={l.my} r={10} fill={l.color} stroke="white" strokeWidth={2} />
                    <path
                      d={`M ${l.mx - 3.5} ${l.my - 3.5} L ${l.mx + 3.5} ${l.my + 3.5} M ${l.mx + 3.5} ${l.my - 3.5} L ${l.mx - 3.5} ${l.my + 3.5}`}
                      stroke="white"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <DragGhost />

      <OutputPanel
        mappings={mappings}
        primary={primary}
        colorFor={colorFor}
        primaryTree={primaryTree}
        secondaryTree={secondaryTree}
        mappingSpec={mappingSpec}
        result={result}
        resultText={resultText}
        resultFormat={sides[secondary].format}
        onDownload={downloadResult}
        hoveredIds={hoveredIds}
        onHover={(id) => setHover(id ? { ids: [id], via: "list" } : null)}
        onRemove={(id) => removeMappings([id])}
        onSetJoin={setJoin}
        onMoveInGroup={moveInGroup}
        onClear={() => removeMappings(mappings.map((m) => m.id))}
      />

      {pendingCombine && (
        <div
          role="alertdialog"
          aria-label="Combine or replace mapping"
          className="fixed bottom-16 left-1/2 z-40 flex max-w-[90vw] -translate-x-1/2 flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-sm text-zinc-800 shadow-lg dark:border-blue-900 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <span>
            <code className="font-semibold">{pathLabel(pendingCombine[secondary])}</code> already gets{" "}
            <code>
              {mappings
                .filter((m) => pathId(m[secondary]) === pathId(pendingCombine[secondary]))
                .map((m) => pathLabel(m[primary]))
                .join(" + ")}
            </code>
            .
          </span>
          <button
            autoFocus
            onClick={() => {
              addMapping(pendingCombine.left, pendingCombine.right, "combine");
              setPendingCombine(null);
            }}
            className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
            title="Keep both sources; their values are joined (with a space unless you change it)"
          >
            ＋ Combine with {pathLabel(pendingCombine[primary])}
          </button>
          <button
            onClick={() => {
              addMapping(pendingCombine.left, pendingCombine.right, "replace");
              setPendingCombine(null);
            }}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Replace
          </button>
          <button
            onClick={() => setPendingCombine(null)}
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            Cancel
          </button>
        </div>
      )}

      {undo && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
        >
          <span className="font-mono text-xs">{undo.text}</span>
          <button onClick={undoRemove} className="font-semibold text-blue-300 hover:underline dark:text-blue-700">
            Undo
          </button>
          <button onClick={() => setUndo(null)} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

// A boolean remembered in this browser. Rendered as false on the server so
// hydration matches; falls back to in-memory state when storage is blocked.
const flagListeners = new Set<() => void>();
const memoryFlags = new Map<string, boolean>();
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return memoryFlags.get(key) ?? false;
  }
}
function useStoredFlag(key: string): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (listener) => {
      flagListeners.add(listener);
      window.addEventListener("storage", listener);
      return () => {
        flagListeners.delete(listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => readFlag(key),
    () => false,
  );
  const set = (next: boolean) => {
    memoryFlags.set(key, next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // not persisted; the in-memory value still applies for this visit
    }
    flagListeners.forEach((l) => l());
  };
  return [value, set];
}

/** Mappings grouped by target, in order of first appearance (the join order within a group). */
function groupByTarget(mappings: Mapping[], targetSide: Side): Mapping[][] {
  const groups = new Map<string, Mapping[]>();
  for (const m of mappings) {
    const id = pathId(m[targetSide]);
    groups.set(id, [...(groups.get(id) ?? []), m]);
  }
  return [...groups.values()];
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-5 w-5 items-center justify-center rounded font-sans text-xs text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 disabled:opacity-30 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
    >
      {children}
    </button>
  );
}

function HeaderButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

type Tab = "mappings" | "result" | "flat" | "spec";

function OutputPanel({
  mappings,
  primary,
  colorFor,
  primaryTree,
  secondaryTree,
  mappingSpec,
  result,
  resultText,
  resultFormat,
  onDownload,
  hoveredIds,
  onHover,
  onRemove,
  onSetJoin,
  onMoveInGroup,
  onClear,
}: {
  mappings: Mapping[];
  primary: Side;
  colorFor: Map<string, string>;
  primaryTree: FieldNode | null;
  secondaryTree: FieldNode | null;
  mappingSpec: { from: string | string[]; to: string; join?: string }[];
  result: Json | null;
  /** The mapped result written in the target's file format. */
  resultText: string | null;
  resultFormat: Format;
  onDownload: () => void;
  hoveredIds: string[] | null;
  onHover: (id: string | null) => void;
  onRemove: (id: string) => void;
  onSetJoin: (targetId: string, join: string) => void;
  onMoveInGroup: (id: string, dir: -1 | 1) => void;
  onClear: () => void;
}) {
  const [tab, setTab] = useState<Tab>("mappings");
  const [copied, setCopied] = useState(false);
  const [collapsed, toggleCollapsed] = useStoredFlag(OUTPUT_COLLAPSED_KEY);
  const secondary = other(primary);

  const texts: Record<Exclude<Tab, "mappings">, string | null> = {
    result: resultText,
    flat: result === null ? null : JSON.stringify(flatten(result), null, 2),
    spec: JSON.stringify(mappingSpec, null, 2),
  };
  const copyText = tab === "mappings" ? null : texts[tab];

  const copy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard blocked; nothing else to do
    }
  };

  const tabs: [Tab, string][] = [
    ["mappings", `Mappings (${mappings.length})`],
    ["result", resultFormat === "json" ? "Mapped result" : `Mapped result (${formatInfo(resultFormat).label})`],
    ["flat", "Flattened JSON"],
    ["spec", "Mapping JSON"],
  ];

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header
        className={`flex items-center gap-1 px-2 pt-2 ${
          collapsed ? "pb-2" : "border-b border-zinc-200 dark:border-zinc-800"
        }`}
      >
        <button
          onClick={() => toggleCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show output panel" : "Hide output panel"}
          title={collapsed ? "Show" : "Hide"}
          className={`flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${
            collapsed ? "" : "-mb-px"
          }`}
        >
          <span className={`text-xs transition-transform ${collapsed ? "-rotate-90" : ""}`}>▾</span>
        </button>
        {tabs.map(([t, label]) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (collapsed) toggleCollapsed(false); // a tab click while collapsed opens that tab
            }}
            className={`border-b-2 px-3 py-1.5 text-sm ${collapsed ? "" : "-mb-px"} ${
              tab === t && !collapsed
                ? "border-blue-600 font-medium text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
        {!collapsed && (
          <div className="ml-auto pb-1">
            {tab === "result" && resultText !== null && (
              <HeaderButton onClick={onDownload}>⬇ Download .{formatInfo(resultFormat).extension}</HeaderButton>
            )}{" "}
            {copyText && <HeaderButton onClick={copy}>{copied ? "Copied!" : "Copy"}</HeaderButton>}
            {tab === "mappings" && mappings.length > 0 && <HeaderButton onClick={onClear}>Remove all</HeaderButton>}
          </div>
        )}
      </header>

      <div className={collapsed ? "hidden" : "p-3"}>
        {tab === "mappings" &&
          (mappings.length === 0 ? (
            <p className="text-sm text-zinc-500">No mappings yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {groupByTarget(mappings, secondary).map((group) => {
                const to = group[0][secondary];
                const toType = secondaryTree && findNode(secondaryTree, to)?.type;
                const row = (m: Mapping, i: number) => {
                  const from = m[primary];
                  const fromType = primaryTree && findNode(primaryTree, from)?.type;
                  const mismatch = group.length === 1 && fromType && toType && fromType !== toType;
                  return (
                    <li
                      key={m.id}
                      onMouseEnter={() => onHover(m.id)}
                      onMouseLeave={() => onHover(null)}
                      className={`group flex items-center gap-2 rounded-md px-2 py-1 font-mono text-sm ${
                        hoveredIds?.includes(m.id) ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorFor.get(m.id) }} />
                      {group.length > 1 && <span className="w-4 text-right font-sans text-xs text-zinc-400">{i + 1}.</span>}
                      <span className="text-zinc-500">{primary}.</span>
                      <span>{pathLabel(from)}</span>
                      {group.length === 1 && (
                        <>
                          <span className="text-zinc-400">→</span>
                          <span className="text-zinc-500">{secondary}.</span>
                          <span>{pathLabel(to)}</span>
                        </>
                      )}
                      {mismatch && (
                        <span
                          className="rounded bg-amber-100 px-1.5 font-sans text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          title="The source and target types differ; the source value is copied as-is."
                        >
                          {fromType} → {toType}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-1">
                        {group.length > 1 && (
                          <>
                            <IconAction label="Move up" disabled={i === 0} onClick={() => onMoveInGroup(m.id, -1)}>
                              ↑
                            </IconAction>
                            <IconAction label="Move down" disabled={i === group.length - 1} onClick={() => onMoveInGroup(m.id, 1)}>
                              ↓
                            </IconAction>
                          </>
                        )}
                        <button
                          onClick={() => onRemove(m.id)}
                          className="flex items-center gap-1 rounded-md border border-transparent px-2 py-0.5 font-sans text-xs text-zinc-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:hover:border-red-900 dark:hover:bg-red-950 dark:hover:text-red-300"
                          title="Remove mapping"
                        >
                          <span aria-hidden>×</span> Remove
                        </button>
                      </span>
                    </li>
                  );
                };
                if (group.length === 1) return row(group[0], 0);

                // Several sources combined into one target.
                const targetId = pathId(to);
                const join = group.find((m) => m.join !== undefined)?.join ?? " ";
                const sample = result === null ? undefined : valuesAt(result, to)[0];
                return (
                  <li key={targetId} className="rounded-lg border border-zinc-200 p-1.5 dark:border-zinc-700">
                    <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-sm">
                      <span className="text-xs font-medium text-zinc-500">Combined into</span>
                      <span className="font-mono">
                        <span className="text-zinc-500">{secondary}.</span>
                        {pathLabel(to)}
                      </span>
                      {sample !== undefined && (
                        <span className="truncate font-mono text-xs text-zinc-500" title="Value written (first item)">
                          = {JSON.stringify(sample)}
                        </span>
                      )}
                      <span className="ml-auto flex flex-wrap items-center gap-1 text-xs text-zinc-500">
                        joined with
                        <input
                          value={join}
                          onChange={(e) => onSetJoin(targetId, e.target.value)}
                          aria-label={`Separator for ${pathLabel(to)}`}
                          placeholder="nothing"
                          className="w-16 rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-mono text-xs text-zinc-800 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                        />
                        {[
                          [" ", "space"],
                          [", ", "comma"],
                          [" - ", "dash"],
                          ["", "none"],
                        ].map(([value, label]) => (
                          <button
                            key={label}
                            onClick={() => onSetJoin(targetId, value)}
                            className={`rounded px-1.5 py-0.5 ${
                              join === value
                                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </span>
                    </div>
                    <ul className="flex flex-col">{group.map(row)}</ul>
                  </li>
                );
              })}
            </ul>
          ))}

        {tab !== "mappings" && (
          <pre className="max-h-96 overflow-auto rounded-md bg-zinc-50 p-3 font-mono text-xs dark:bg-zinc-950">
            {texts[tab] ?? "Load both objects to see the mapped result."}
          </pre>
        )}
        {tab === "result" && result !== null && (
          <p className="mt-2 text-xs text-zinc-500">
            The {secondary} object with every mapped field filled from the {primary} object. Unmapped
            fields keep their current values.
          </p>
        )}
        {tab === "flat" && result !== null && (
          <p className="mt-2 text-xs text-zinc-500">
            The mapped result as one flat object: nested keys become paths like{" "}
            <code>a.b[0].c</code>. This is what goes into the Excel export.
          </p>
        )}
      </div>
    </section>
  );
}
