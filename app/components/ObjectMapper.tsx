"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { EXAMPLES, MULTI_EXAMPLE, STANDARD_ERROR } from "@/lib/examples";
import { DEFAULT_DOC_NAME, fileSlug } from "@/lib/names";
import { type Condition, type MappingCase, type SourceDef, conditionHolds, pickCase } from "@/lib/multi";
import { MultiBar } from "./MultiBar";
import { ConstantFields, ConstantForm, TranslationEditor, draftOf, fromDraft } from "./TranslationEditor";
import {
  type DbRef,
  type FixedValues,
  type Translation,
  describeFixed,
  engineInputs,
  describeTranslation,
  isConstPath,
  newConstPath,
  sourceLabel,
} from "@/lib/transforms";
import {
  HEADERS,
  type Headers,
  applyWithHeaders,
  headersTree,
  isHeaderPath,
  lookupTree,
  supportsHeaders,
  valuesAtPath,
} from "@/lib/headers";
import { buildWorkbook, parseWorkbook, readDocument } from "@/lib/workbook";
import { type MultiDoc, type MultiDocSide, buildMultiWorkbook, parseMultiWorkbook } from "@/lib/multi-workbook";
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
  /** Header name/value pairs (shown for JSON and XML). */
  headers: Headers;
  /** What to call this object (panel title, report headings); empty = the default label. */
  name?: string;
  /** Fields tagged as constants (pathId -> hardcoded value or database table/column). */
  fixed: FixedValues;
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
  headers: {},
  fixed: {},
});

/** Tags whose fields still exist, following a rename/move when given. */
function keepFixed(fixed: FixedValues | undefined, isValid: (p: Path) => boolean, move?: (p: Path) => Path): FixedValues {
  const out: FixedValues = {};
  for (const [key, value] of Object.entries(fixed ?? {})) {
    const p = move ? move(JSON.parse(key) as Path) : (JSON.parse(key) as Path);
    if (isValid(p)) out[pathId(p)] = value;
  }
  return out;
}

type SourceState = SourceDef<SideState>;

interface MultiState {
  enabled: boolean;
  /**
   * Every source. The active one's document and active case's mappings are
   * live on screen (the editable side + mappings) and folded back in on switch.
   */
  sources: SourceState[];
  activeSource: string;
  /** Which side the standard was on when the mappings were made. */
  standardSide: Side | null;
  /** The standard object while multi-source mode is off (it is the primary while on). */
  standard: SideState | null;
  /** The single-pair setup to restore when multi-source mode is turned off. */
  single: { primary: SideState; side: SideState; mappings: Mapping[] } | null;
}

const emptyMulti = (): MultiState => ({
  enabled: false,
  sources: [],
  activeSource: "",
  standardSide: null,
  standard: null,
  single: null,
});

const newCase = (name: string, mappings: Mapping[] = []): MappingCase => ({ id: newId(), name, when: [], mappings });
const newSource = (name: string, side: SideState): SourceState => {
  const c = newCase("All");
  return { id: newId(), name, side, cases: [c], activeCase: c.id };
};

/** Every leaf field path (no children) of a tree. */
function leafPathsOf(node: FieldNode, out: Path[] = []): Path[] {
  for (const child of node.children) {
    if (child.children.length === 0) out.push(child.path);
    else leafPathsOf(child, out);
  }
  return out;
}

/** A side's headers when its format has them. */
const activeHeaders = (side: SideState): Headers | undefined =>
  supportsHeaders(side.format) ? side.headers : undefined;

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
  // Multi-source mode: the primary is a standard object that several sources map into.
  const [multi, setMulti] = useState<MultiState>(emptyMulti);
  // The document's main name: the report title and the name of exported files.
  const [docName, setDocName] = useState("");
  // Once someone has mapped by clicking, the "now click the other side" hint is noise.
  const [knowsClickToMap, setKnowsClickToMap] = useState(false);

  const secondary = other(primary);
  // Where values come from and go to. In single-pair mode values flow from the primary;
  // in multi-source mode the primary is the standard that the sources flow into.
  const sourceSide: Side = multi.enabled ? secondary : primary;
  const targetSide: Side = other(sourceSide);

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
        if (saved.multi) setMulti({ ...emptyMulti(), ...saved.multi });
        if (typeof saved.docName === "string") setDocName(saved.docName);
      }
    } catch {
      // ignore unreadable saved state
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sides, primary, mappings, bothEditable, multi, docName }));
    } catch {
      // storage unavailable; the app still works without it
    }
  }, [sides, primary, mappings, bothEditable, multi, docName, loaded]);

  // ---------- derived trees ----------
  const trees = useMemo(
    () => ({
      left: sides.left.data !== null ? buildTree(sides.left.data) : null,
      right: sides.right.data !== null ? buildTree(sides.right.data) : null,
    }),
    [sides.left.data, sides.right.data],
  );

  // Headers and body together, for looking any mappable field up by path.
  const lookups = useMemo(
    () => ({
      left: lookupTree(sides.left.data, activeHeaders(sides.left)),
      right: lookupTree(sides.right.data, activeHeaders(sides.right)),
    }),
    [sides.left, sides.right],
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
    (
      side: Side,
      data: Json | null,
      rewrite?: (m: Mapping) => Mapping,
      keepText = false,
      /** How paths moved (rename/move), so constant tags follow their field. */
      movePath?: (p: Path) => Path,
    ) => {
      const valid = data === null ? new Set<string>() : allPaths(buildTree(data));
      setSides((s) => {
        const cur = s[side];
        if (data === null) return { ...s, [side]: { ...cur, data } };
        const layout = cur.format === "flat" ? syncLayoutFields(cur.layout, data) : cur.layout;
        const text = keepText ? cur.text : writeFormat(cur.format, data, layout);
        const fixed = keepFixed(cur.fixed, (p) => isHeaderPath(p) || valid.has(pathId(p)), movePath);
        return { ...s, [side]: { ...cur, data, layout, text, fixed } };
      });
      // Body edits never touch header fields, so their mappings stay.
      const keep = (p: Path) => isHeaderPath(p) || isConstPath(p) || valid.has(pathId(p));
      setMappings((ms) => ms.map((m) => (rewrite ? rewrite(m) : m)).filter((m) => keep(m[side])));
      setSelected((sel) => (sel && sel.side === side && !keep(sel.path) ? null : sel));
    },
    [],
  );

  /** Replace a side's headers and drop mappings to header fields that no longer exist. */
  const commitHeaders = useCallback(
    (side: Side, headers: Headers, rewrite?: (m: Mapping) => Mapping, movePath?: (p: Path) => Path) => {
    const valid = allPaths(headersTree(headers));
    setSides((s) => ({
      ...s,
      [side]: {
        ...s[side],
        headers,
        fixed: keepFixed(s[side].fixed, (p) => !isHeaderPath(p) || valid.has(pathId(p)), movePath),
      },
    }));
    const keep = (p: Path) => !isHeaderPath(p) || valid.has(pathId(p));
    setMappings((ms) => ms.map((m) => (rewrite ? rewrite(m) : m)).filter((m) => keep(m[side])));
    setSelected((sel) => (sel && sel.side === side && !keep(sel.path) ? null : sel));
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
      const { text, layout, headers } = EXAMPLES[role][format];
      return {
        ...emptySide(),
        format,
        layout,
        text,
        headers: headers ?? {},
        data: readFormat(format, text, layout).data,
        editingText: false,
      };
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
  const [pendingCombine, setPendingCombine] = useState<{ left: Path; right: Path; constant?: Json; db?: DbRef } | null>(
    null,
  );

  /** Add a mapping; "combine" keeps the target's other sources (their values are joined). */
  const addMapping = useCallback(
    (left: Path, right: Path, mode: "combine" | "replace", constant?: Json, db?: DbRef) =>
      setMappings((ms) => {
        const target = targetSide === "left" ? left : right;
        const sameTarget = (m: Mapping) => pathId(m[targetSide]) === pathId(target);
        const extra = constant !== undefined ? { constant, ...(db ? { db } : {}) } : {};
        if (mode === "replace") return [...ms.filter((m) => !sameTarget(m)), { id: newId(), left, right, ...extra }];
        const join = ms.find(sameTarget)?.join;
        return [...ms, { id: newId(), left, right, ...extra, ...(join !== undefined ? { join } : {}) }];
      }),
    [targetSide],
  );

  const createMapping = useCallback(
    (a: Selection, b: Selection) => {
      if (a.side === b.side) return;
      const left = a.side === "left" ? a.path : b.path;
      const right = a.side === "right" ? a.path : b.path;
      if (left.length === 0 || right.length === 0) return;
      const source = sourceSide === "left" ? left : right;
      const target = targetSide === "left" ? left : right;
      const existing = mappings.filter((m) => pathId(m[targetSide]) === pathId(target));
      if (existing.some((m) => pathId(m[sourceSide]) === pathId(source))) return; // already mapped
      if (sides[targetSide].fixed?.[pathId(target)] !== undefined) {
        setNotice({
          kind: "error",
          text: `${pathLabel(target)} is tagged as a constant. Untag it (click its 📌 constant pill) to map into it.`,
          details: [],
        });
        return;
      }
      if (existing.length === 0) addMapping(left, right, "replace");
      else setPendingCombine({ left, right });
    },
    [sourceSide, targetSide, mappings, addMapping, sides],
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
          ? `Removed ${sourceLabel(only, sourceSide)} → ${pathLabel(only[targetSide])}`
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
      add(sourceSide, m[sourceSide], color, `→ ${pathLabel(m[targetSide])}`);
      add(targetSide, m[targetSide], color, `← ${sourceLabel(m, sourceSide)}`);
    }
    return out;
  }, [hoveredIds, mappings, colorFor, sourceSide, targetSide]);

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

  // ---------- multi-source mode ----------
  /** All sources, with the one on screen (document + active case's mappings) folded back in. */
  const liveSources = useMemo(
    () =>
      !multi.enabled
        ? multi.sources
        : multi.sources.map((src) =>
            src.id !== multi.activeSource
              ? src
              : {
                  ...src,
                  side: sides[secondary],
                  cases: src.cases.map((c) => (c.id === src.activeCase ? { ...c, mappings } : c)),
                },
          ),
    [multi, sides, secondary, mappings],
  );
  const activeSource = multi.enabled ? (liveSources.find((x) => x.id === multi.activeSource) ?? null) : null;

  /** Put a source (and one of its cases) on screen. */
  const showSource = (sources: SourceState[], sourceId: string, caseId?: string) => {
    const src = sources.find((x) => x.id === sourceId);
    if (!src) return;
    const kase = src.cases.find((c) => c.id === (caseId ?? src.activeCase)) ?? src.cases[0];
    setSides((st) => ({ ...st, [secondary]: src.side }));
    setMappings(kase.mappings);
    setMulti((m) => ({
      ...m,
      sources: sources.map((x) => (x.id === sourceId ? { ...x, activeCase: kase.id } : x)),
      activeSource: sourceId,
    }));
    setSelected(null);
    setPendingCombine(null);
    setHover(null);
  };

  const setMultiMode = (on: boolean) => {
    if (on === multi.enabled) return;
    if (on) {
      // Mappings are stored by side; if the standard has moved sides since, flip them.
      const flip = multi.standardSide !== null && multi.standardSide !== primary;
      const flipMap = (m: Mapping): Mapping => (flip ? { ...m, left: m.right, right: m.left } : m);
      const sources = multi.sources.length
        ? multi.sources.map((x) => ({ ...x, cases: x.cases.map((c) => ({ ...c, mappings: c.mappings.map(flipMap) })) }))
        : // First time: the other side becomes the first source (mappings start empty, since values now flow the other way).
          [newSource("Source 1", sides[secondary])];
      const activeId = sources.some((x) => x.id === multi.activeSource) ? multi.activeSource : sources[0].id;
      // The single-pair primary is kept aside; the standard (if there is one yet) takes its place.
      const single = { primary: sides[primary], side: sides[secondary], mappings };
      if (multi.standard) setSides((st) => ({ ...st, [primary]: multi.standard! }));
      setMulti((m) => ({ ...m, enabled: true, standardSide: primary, single }));
      showSource(sources, activeId);
    } else {
      const sources = liveSources;
      const single = multi.single;
      const standard = sides[primary];
      setMulti((m) => ({ ...m, enabled: false, sources, standard }));
      if (single) {
        setSides((st) => ({ ...st, [primary]: single.primary ?? st[primary], [secondary]: single.side }));
        setMappings(single.mappings);
      }
      setSelected(null);
      setPendingCombine(null);
      setHover(null);
    }
  };

  const multiHandlers = {
    onSelectSource: (id: string) => id !== multi.activeSource && showSource(liveSources, id),
    onAddSource: () => {
      const src = newSource(`Source ${liveSources.length + 1}`, emptySide());
      showSource([...liveSources, src], src.id);
    },
    onRenameSource: (id: string, name: string) =>
      setMulti((m) => ({ ...m, sources: m.sources.map((x) => (x.id === id ? { ...x, name } : x)) })),
    onRemoveSource: (id: string) => {
      if (liveSources.length <= 1) return;
      const rest = liveSources.filter((x) => x.id !== id);
      if (id === multi.activeSource) showSource(rest, rest[0].id);
      else setMulti((m) => ({ ...m, sources: rest }));
    },
    onSelectCase: (id: string) => showSource(liveSources, multi.activeSource, id),
    onAddCase: () => {
      if (!activeSource) return;
      // Start from a copy of the current case's mappings; cases usually differ only a little.
      const c = newCase(`Case ${activeSource.cases.length + 1}`, mappings.map((m) => ({ ...m, id: newId() })));
      const sources = liveSources.map((x) => (x.id === activeSource.id ? { ...x, cases: [...x.cases, c] } : x));
      showSource(sources, activeSource.id, c.id);
    },
    onRenameCase: (id: string, name: string) => updateCase(id, { name }),
    onSetConditions: (id: string, when: Condition[]) => updateCase(id, { when }),
    onRemoveCase: (id: string) => {
      if (!activeSource || activeSource.cases.length <= 1) return;
      const sources = liveSources.map((x) =>
        x.id === activeSource.id ? { ...x, cases: x.cases.filter((c) => c.id !== id) } : x,
      );
      const next = sources.find((x) => x.id === activeSource.id)!;
      if (id === activeSource.activeCase) showSource(sources, activeSource.id, next.cases[0].id);
      else setMulti((m) => ({ ...m, sources }));
    },
    onMoveCase: (id: string, dir: -1 | 1) =>
      setMulti((m) => ({
        ...m,
        sources: liveSources.map((x) => {
          if (x.id !== m.activeSource) return x;
          const i = x.cases.findIndex((c) => c.id === id);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= x.cases.length) return x;
          const cases = [...x.cases];
          [cases[i], cases[j]] = [cases[j], cases[i]];
          return { ...x, cases };
        }),
      })),
  };
  /** Change a case's name or conditions (its mappings are edited on screen). */
  function updateCase(id: string, patch: Partial<Pick<MappingCase, "name" | "when">>) {
    setMulti((m) => ({
      ...m,
      sources: m.sources.map((x) =>
        x.id !== m.activeSource ? x : { ...x, cases: x.cases.map((c) => (c.id === id ? { ...c, ...patch } : c)) },
      ),
    }));
  }

  /** The error-normalisation example: a standard error and three downstream errors. */
  const loadMultiExample = () => {
    const standard: SideState = {
      ...emptySide(),
      text: JSON.stringify(STANDARD_ERROR, null, 2),
      data: STANDARD_ERROR,
      editingText: false,
    };
    const sources: SourceState[] = MULTI_EXAMPLE.map((ex) => {
      const side: SideState = {
        ...emptySide(),
        format: ex.format,
        text: ex.text,
        headers: ex.headers ?? {},
        data: readFormat(ex.format, ex.text).data,
        editingText: false,
      };
      const cases = ex.cases.map((c) => ({
        id: newId(),
        name: c.name,
        when: c.when,
        // The standard (primary) is where values go; the source is the other side.
        mappings: [
          ...c.maps.map(([from, to]): Mapping => {
            const translate = c.translate?.[to.join(".")];
            const pair = primary === "left" ? { left: to, right: from } : { left: from, right: to };
            return { id: newId(), ...pair, ...(translate ? { translate } : {}) };
          }),
          ...(c.constants ?? []).map(([value, to]): Mapping => {
            const from = newConstPath();
            const pair = primary === "left" ? { left: to, right: from } : { left: from, right: to };
            return { id: newId(), ...pair, constant: value };
          }),
        ],
      }));
      return { id: newId(), name: ex.name, side, cases, activeCase: cases[0].id };
    });
    setSides((st) => ({ ...st, [primary]: standard }));
    setMulti((m) => ({
      ...m,
      enabled: true,
      standardSide: primary,
      // Loading the example while multi-source mode is off: keep the single-pair setup to come back to.
      single: m.enabled ? m.single : { primary: sides[primary], side: sides[secondary], mappings },
    }));
    showSource(sources, sources[0].id);
    setNotice(null);
  };

  /** Rename an object (its panel title and report headings). */
  const setSideName = (side: Side, name: string) => setSides((s) => ({ ...s, [side]: { ...s[side], name } }));

  // ---------- constant tags on the non-primary object ----------
  /** Tag a field as a constant (with its current value), or untag it. Tagging a target drops mappings into it. */
  const toggleFixed = (side: Side, path: Path) => {
    const st = sides[side];
    const key = pathId(path);
    if (st.fixed?.[key] !== undefined) {
      setSides((s) => {
        const rest = { ...(s[side].fixed ?? {}) };
        delete rest[key];
        return { ...s, [side]: { ...s[side], fixed: rest } };
      });
      return;
    }
    const value = st.data === null ? "" : (valuesAtPath(st.data, activeHeaders(st), path)[0] ?? "");
    setFixed(side, path, { value });
    if (side === targetSide) {
      const ids = mappings.filter((m) => pathId(m[targetSide]) === key).map((m) => m.id);
      if (ids.length) removeMappings(ids);
    }
  };
  const setFixed = (side: Side, path: Path, fixed: { value: Json; db?: DbRef }) =>
    setSides((s) => ({ ...s, [side]: { ...s[side], fixed: { ...(s[side].fixed ?? {}), [pathId(path)]: fixed } } }));
  /** Editing a tagged field's value updates its hardcoded constant too. */
  const retagValue = (side: Side, path: Path, value: Json) => {
    const tag = sides[side].fixed?.[pathId(path)];
    if (tag && !tag.db) setFixed(side, path, { value });
  };

  // Suggest key/type when adding a field on the editable side while a primary field is selected.
  const suggestion = useMemo(() => {
    if (!selected || selected.side !== primary) return null;
    const tree = lookups[primary];
    const node = tree && findNode(tree, selected.path);
    if (!node) return null;
    const key = [...node.path].reverse().find((s) => s !== "[]") ?? "field";
    return { key, type: node.type, itemType: node.children[0]?.type, label: pathLabel(node.path) };
  }, [selected, primary, lookups]);

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
        const move = (p: Path) => (isPrefix(path, p) ? [...renamed, ...p.slice(path.length)] : p);
        commitData(side, renameField(data, path, newKey), (m) => ({ ...m, [side]: move(m[side]) }), false, move);
      },
      onRetype: (path: Path, type: FieldType) => {
        if (data !== null) commitData(side, setFieldType(data, path, type));
      },
      onSetValue: (path: Path, value: Json) => {
        if (data === null) return;
        commitData(side, setValueAt(data, path, value));
        retagValue(side, path, value);
      },
      onSetArrayItems: (path: Path, items: Json[]) => {
        if (data !== null) commitData(side, setArrayItems(data, path, items));
      },
      onSetItemType: (path: Path, itemType: FieldType) => {
        if (data !== null) commitData(side, setArrayItemType(data, path, itemType));
      },
      onMoveField: (from: Path, parent: Path, after?: string) => {
        if (data === null) return;
        if (isHeaderPath(from)) {
          setNotice({ kind: "error", text: "Headers can't be moved into the body. Add a body field instead.", details: [] });
          return;
        }
        const moved = moveField(data, from, parent, after);
        if ("error" in moved) {
          setNotice({ kind: "error", text: `Couldn't move that field: ${moved.error}`, details: [] });
          return;
        }
        setNotice(null);
        // Mappings to the field (or anything inside it) follow it to its new place.
        const move = (p: Path) => (isPrefix(from, p) ? [...moved.path, ...p.slice(from.length)] : p);
        commitData(side, moved.data, (m) => ({ ...m, [side]: move(m[side]) }), false, move);
      },
    };
  };

  /** Edits for the Headers box. Paths start with HEADERS; the headers object is edited without it. */
  const headerHandlers = (side: Side) => {
    const h = sides[side].headers ?? {};
    const rel = (p: Path) => p.slice(1);
    const moveOf = (from: Path, to: Path) => (p: Path) => (isPrefix(from, p) ? [...to, ...p.slice(from.length)] : p);
    const follow = (from: Path, to: Path) => (m: Mapping) => ({ ...m, [side]: moveOf(from, to)(m[side]) });
    const commit = (next: Json, rewrite?: (m: Mapping) => Mapping, movePath?: (p: Path) => Path) =>
      commitHeaders(side, next as Headers, rewrite, movePath);
    return {
      onAdd: (parent: Path, key: string, type: FieldType, itemType: FieldType | undefined, mapSelected: boolean) => {
        commit(addField(h, rel(parent), key, type, itemType));
        if (mapSelected && selected && selected.side !== side) {
          createMapping(selected, { side, path: [...parent, key] });
          setSelected(null);
        }
      },
      onRemove: (path: Path) => commit(removeField(h, rel(path))),
      onRename: (path: Path, newKey: string) =>
        commit(
          renameField(h, rel(path), newKey),
          follow(path, [...path.slice(0, -1), newKey]),
          moveOf(path, [...path.slice(0, -1), newKey]),
        ),
      onRetype: (path: Path, type: FieldType) => commit(setFieldType(h, rel(path), type)),
      onSetValue: (path: Path, value: Json) => {
        commit(setValueAt(h, rel(path), value));
        retagValue(side, path, value);
      },
      onSetArrayItems: (path: Path, items: Json[]) => commit(setArrayItems(h, rel(path), items)),
      onSetItemType: (path: Path, itemType: FieldType) => commit(setArrayItemType(h, rel(path), itemType)),
      onMoveField: (from: Path, parent: Path, after?: string) => {
        if (!isHeaderPath(from)) {
          setNotice({ kind: "error", text: "Body fields can't be moved into the headers. Add a header instead.", details: [] });
          return;
        }
        const moved = moveField(h, rel(from), rel(parent), after);
        if ("error" in moved) {
          setNotice({ kind: "error", text: `Couldn't move that header: ${moved.error}`, details: [] });
          return;
        }
        setNotice(null);
        commit(moved.data, follow(from, [HEADERS, ...moved.path]), moveOf(from, [HEADERS, ...moved.path]));
      },
    };
  };

  // ---------- output ----------
  const primaryTree = lookups[sourceSide];
  const secondaryTree = lookups[targetSide];
  const mapped = useMemo(() => {
    const src = sides[sourceSide];
    const tpl = sides[targetSide];
    if (src.data === null || tpl.data === null) return null;
    return applyWithHeaders(
      { body: src.data, headers: activeHeaders(src) },
      { body: tpl.data, headers: activeHeaders(tpl) },
      ...(() => {
        const { inputs, constants } = engineInputs(mappings, sourceSide, targetSide, src.fixed, tpl.fixed);
        return [inputs, joinsFor(mappings, targetSide), constants] as const;
      })(),
    );
  }, [sides, sourceSide, targetSide, mappings]);
  const result = mapped?.body ?? null;
  // The target's headers after mapping (when its format has headers and there are any).
  const resultHeaders =
    mapped && supportsHeaders(sides[targetSide].format) && Object.keys(mapped.headers).length ? mapped.headers : null;

  /** Add a fixed value to a target field (asks to combine/replace if the field is already mapped). */
  const addConstant = (target: Path, c: { value: Json; db?: DbRef }) => {
    const pair = { [sourceSide]: newConstPath(), [targetSide]: target } as { left: Path; right: Path };
    if (mappings.some((m) => pathId(m[targetSide]) === pathId(target))) setPendingCombine({ ...pair, constant: c.value, db: c.db });
    else addMapping(pair.left, pair.right, "replace", c.value, c.db);
  };
  const setConstant = (id: string, c: { value: Json; db?: DbRef }) =>
    setMappings((ms) =>
      ms.map((m) => {
        if (m.id !== id) return m;
        const { db: _old, ...rest } = m;
        void _old;
        return { ...rest, constant: c.value, ...(c.db ? { db: c.db } : {}) };
      }),
    );
  const setTranslate = (id: string, t: Translation | undefined) =>
    setMappings((ms) =>
      ms.map((m) => {
        if (m.id !== id) return m;
        const { translate: _drop, ...rest } = m;
        void _drop;
        return t ? { ...rest, translate: t } : rest;
      }),
    );
  /** Distinct sample values a mapping reads (for prefilling its translation table). */
  const sampleValuesFor = (m: Mapping): string[] => {
    const src = sides[sourceSide];
    if (src.data === null || isConstPath(m[sourceSide])) return [];
    const vals = valuesAtPath(src.data, activeHeaders(src), m[sourceSide]).map((v) =>
      v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v),
    );
    return [...new Set(vals.filter((v) => v !== ""))];
  };

  /** Set the separator for every mapping into the target `targetId`. */
  const setJoin = (targetId: string, join: string) =>
    setMappings((ms) => ms.map((m) => (pathId(m[targetSide]) === targetId ? { ...m, join } : m)));

  /** Move a mapping up/down among the mappings that share its target (the join order). */
  const moveInGroup = (id: string, dir: -1 | 1) =>
    setMappings((ms) => {
      const i = ms.findIndex((m) => m.id === id);
      if (i < 0) return ms;
      const target = pathId(ms[i][targetSide]);
      let j = i + dir;
      while (j >= 0 && j < ms.length && pathId(ms[j][targetSide]) !== target) j += dir;
      if (j < 0 || j >= ms.length) return ms;
      const next = [...ms];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const resultText = useMemo(() => {
    if (result === null) return null;
    const target = sides[targetSide];
    return writeFormat(target.format, result, target.layout);
  }, [result, sides, targetSide]);

  // Coverage: which source field feeds each standard field, per source (and case).
  const coverage = useMemo(() => {
    const std = lookups[primary];
    if (!multi.enabled || !std) return null;
    // (An empty Headers group is not a field to fill.)
    const fields = leafPathsOf(std).filter((p) => !(p.length === 1 && p[0] === HEADERS));
    return fields.map((path) => ({
      path,
      cells: liveSources.map((src) =>
        src.cases.map((c) => ({
          caseName: c.name,
          fields: c.mappings
            .filter((m) => isPrefix(m[primary], path))
            .map((m) => {
              const tag = src.side.fixed?.[pathId(m[secondary])];
              return sourceLabel(m, secondary) + (tag ? ` 📌 ${describeFixed(tag)}` : "") + (m.translate ? " ⇄" : "");
            }),
        })),
      ),
    }));
  }, [multi.enabled, lookups, primary, secondary, liveSources]);

  // Test all: run each source's sample through the first case that matches it.
  const testRuns = useMemo(() => {
    const std = sides[primary];
    if (!multi.enabled || std.data === null) return null;
    return liveSources.map((src) => {
      const body = src.side.data;
      if (body === null) return { id: src.id, name: src.name, error: "No sample loaded yet." };
      const headers = activeHeaders(src.side);
      const kase = pickCase(src.cases, body, headers);
      if (!kase) return { id: src.id, name: src.name, error: "No case matches this sample." };
      const out = applyWithHeaders(
        { body, headers },
        { body: std.data!, headers: activeHeaders(std) },
        ...(() => {
          const { inputs, constants } = engineInputs(kase.mappings, secondary, primary, src.side.fixed, std.fixed);
          return [inputs, joinsFor(kase.mappings, primary), constants] as const;
        })(),
      );
      const hasHeaders = supportsHeaders(std.format) && Object.keys(out.headers).length > 0;
      return {
        id: src.id,
        name: src.name,
        caseName: kase.name,
        text: writeFormat(std.format, out.body, std.layout),
        body: out.body,
        headers: hasHeaders ? out.headers : null,
      };
    });
  }, [multi.enabled, sides, primary, secondary, liveSources]);

  const downloadResult = () => {
    if (resultText === null) return;
    const info = formatInfo(sides[targetSide].format);
    const url = URL.createObjectURL(new Blob([resultText], { type: info.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileSlug(docName)}-result.${info.extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** The multi-source workspace as a plain document (sources map into the standard). */
  const multiDoc = (): MultiDoc => {
    const docSide = (st: SideState): MultiDocSide => ({
      name: st.name ?? "",
      data: st.data ?? {},
      format: st.format,
      layout: st.layout,
      headers: st.headers ?? {},
      fixed: st.fixed ?? {},
    });
    return {
      docName,
      standard: docSide(sides[primary]),
      sources: liveSources.map((src) => ({
        name: src.name,
        side: docSide(src.side),
        cases: src.cases.map((c) => ({
          name: c.name,
          when: c.when,
          mappings: c.mappings.map((m) => ({
            from: m[secondary],
            to: m[primary],
            ...(m.join !== undefined ? { join: m.join } : {}),
            ...(m.constant !== undefined ? { constant: m.constant } : {}),
            ...(m.db ? { db: m.db } : {}),
            ...(m.translate ? { translate: m.translate } : {}),
          })),
        })),
      })),
    };
  };

  const exportExcel = () => {
    if (multi.enabled) {
      downloadXlsx(
        `${fileSlug(docName)}.xlsx`,
        buildMultiWorkbook(multiDoc(), {
          coverage: coverage?.map((r) => ({
            field: pathLabel(r.path),
            cells: r.cells.map((cases) => {
              const mapped = cases.filter((c) => c.fields.length > 0);
              if (mapped.length === 0) return "—";
              const same = mapped.length === cases.length && mapped.every((c) => c.fields.join() === mapped[0].fields.join());
              return same ? mapped[0].fields.join(" + ") : cases.map((c) => `${c.caseName}: ${c.fields.join(" + ") || "—"}`).join("; ");
            }),
          })),
          results: testRuns?.map((r) =>
            "error" in r ? { name: r.name, error: r.error } : { name: r.name, caseName: r.caseName, body: r.body },
          ),
        }),
      );
      return;
    }
    downloadXlsx(
      `${fileSlug(docName)}.xlsx`,
      buildWorkbook({
        docName,
        names: { left: sides.left.name ?? "", right: sides.right.name ?? "" },
        primary,
        data: { left: sides.left.data, right: sides.right.data },
        mappings,
        result,
        formats: {
          left: { format: sides.left.format, layout: sides.left.layout },
          right: { format: sides.right.format, layout: sides.right.layout },
        },
        headers: { left: sides.left.headers ?? {}, right: sides.right.headers ?? {} },
        fixed: { left: sides.left.fixed ?? {}, right: sides.right.fixed ?? {} },
      }),
    );
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string; details: string[] } | null>(
    null,
  );

  /** Load a multi-source workbook: the standard becomes the primary; every source and case comes back. */
  const importMulti = (sheets: Awaited<ReturnType<typeof readXlsx>>, fileName: string) => {
    const { doc, warnings } = parseMultiWorkbook(sheets);
    if (doc.sources.length === 0) throw new Error("The workbook has no sources.");
    const hasWork = sides.left.data !== null || sides.right.data !== null || mappings.length > 0;
    if (hasWork && !window.confirm(`Replace the current work with "${fileName}"?`)) return;
    const toSide = (d: MultiDocSide): SideState => ({
      ...emptySide(),
      name: d.name ?? "",
      format: d.format,
      layout: d.layout,
      data: d.data,
      headers: d.headers,
      fixed: d.fixed,
      text: writeFormat(d.format, d.data, d.layout),
      editingText: false,
    });
    const sources: SourceState[] = doc.sources.map((src) => {
      const cases: MappingCase[] = src.cases.map((c) => ({
        id: newId(),
        name: c.name,
        when: c.when,
        mappings: c.mappings.map(
          (m): Mapping => ({
            id: newId(),
            ...(primary === "left" ? { left: m.to, right: m.from } : { left: m.from, right: m.to }),
            ...(m.join !== undefined ? { join: m.join } : {}),
            ...(m.constant !== undefined ? { constant: m.constant } : {}),
            ...(m.db ? { db: m.db } : {}),
            ...(m.translate ? { translate: m.translate } : {}),
          }),
        ),
      }));
      return { id: newId(), name: src.name, side: toSide(src.side), cases, activeCase: cases[0].id };
    });
    setSides((st) => ({ ...st, [primary]: toSide(doc.standard) }));
    setMulti((m) => ({
      ...m,
      enabled: true,
      standardSide: primary,
      single: m.enabled ? m.single : { primary: sides[primary], side: sides[secondary], mappings },
    }));
    showSource(sources, sources[0].id);
    if (doc.docName) setDocName(doc.docName);
    const caseCount = sources.reduce((n, x) => n + x.cases.length, 0);
    const mapCount = sources.reduce((n, x) => n + x.cases.reduce((k, c) => k + c.mappings.length, 0), 0);
    setNotice({
      kind: "ok",
      text: `Imported "${fileName}": the standard and ${sources.length} source${sources.length === 1 ? "" : "s"} (${caseCount} case${caseCount === 1 ? "" : "s"}, ${mapCount} mapping${mapCount === 1 ? "" : "s"}).`,
      details: warnings,
    });
  };

  const importExcel = async (file: File) => {
    try {
      const sheets = await readXlsx(await file.arrayBuffer());
      if (readDocument(sheets).mode === "multi") {
        importMulti(sheets, file.name);
        return;
      }
      const imported = parseWorkbook(sheets);
      const hasWork = sides.left.data !== null || sides.right.data !== null || mappings.length > 0;
      if (hasWork && !window.confirm(`Replace the current objects and mappings with "${file.name}"?`)) return;
      // A single-pair workbook: leave multi-source mode (its sources are kept for later).
      if (multi.enabled) {
        const kept = liveSources;
        setMulti((m) => ({ ...m, enabled: false, sources: kept, standard: sides[primary] }));
      }
      if (imported.docName) setDocName(imported.docName);
      const sideFrom = (side: Side): SideState => {
        const { format, layout } = imported.formats[side];
        const data = imported.data[side];
        return {
          ...emptySide(),
          format,
          layout,
          data,
          headers: imported.headers[side],
          fixed: imported.fixed[side],
          name: imported.names[side],
          text: writeFormat(format, data, layout),
          editingText: false,
        };
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
      const id = pathId(m[targetSide]);
      groups.set(id, [...(groups.get(id) ?? []), m]);
    }
    return [...groups.values()].map((g) =>
      g.length === 1
        ? { from: sourceLabel(g[0], sourceSide), to: pathLabel(g[0][targetSide]), ...specExtras(g[0]) }
        : {
            from: g.map((m) => sourceLabel(m, sourceSide)),
            to: pathLabel(g[0][targetSide]),
            join: g.find((m) => m.join !== undefined)?.join ?? " ",
          },
    );
  }, [mappings, sourceSide, targetSide]);

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
        x2: sourceSide === "left" ? x2 : x1,
        y2: sourceSide === "left" ? y2 : y1,
        dir: sourceSide === "left" ? ("right" as Side) : ("left" as Side),
      });
    }
    setLines(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappings, trees, layoutTick, colorFor, sourceSide]);

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
          <h2 className="text-sm font-semibold capitalize">
            {multi.enabled ? (
              isPrimary ? (
                <ObjectNameInput value={state.name ?? ""} placeholder="Standard" onChange={(name) => setSideName(side, name)} />
              ) : (
                <input
                  value={activeSource?.name ?? ""}
                  onChange={(e) => activeSource && multiHandlers.onRenameSource(activeSource.id, e.target.value)}
                  aria-label="Source name"
                  title="Rename this source"
                  size={Math.max(8, (activeSource?.name ?? "").length + 1)}
                  className="rounded border border-transparent bg-transparent px-1 font-semibold normal-case outline-none hover:border-zinc-300 focus:border-blue-500 dark:hover:border-zinc-700"
                />
              )
            ) : (
              <ObjectNameInput
                value={state.name ?? ""}
                placeholder={`${side[0].toUpperCase()}${side.slice(1)} object`}
                onChange={(name) => setSideName(side, name)}
              />
            )}
          </h2>
          {isPrimary ? (
            <span
              className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white"
              title={
                multi.enabled
                  ? "Every source maps into this standard object."
                  : bothEditable
                    ? "Values flow from this side. Its fields can be edited."
                    : "Values flow from this side. Its fields are locked, but you can click a value to change it."
              }
            >
              {bothEditable ? "✎" : "🔒"} Primary · {multi.enabled ? "standard" : "source"}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              ✎ Editable · {multi.enabled ? "source" : "target"}
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
              !multi.enabled && <HeaderButton onClick={() => setPrimary(side)}>Make primary</HeaderButton>
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
              {supportsHeaders(state.format) && (
                <div className="mb-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50/60 pb-1 dark:border-zinc-700 dark:bg-zinc-950/30">
                  <FieldTree
                    root={headersTree(state.headers ?? {})}
                    side={side}
                    // Headers are details you define, so they can be edited even on the locked primary.
                    editable
                    rootLabel={
                      <span className="font-sans text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Headers
                      </span>
                    }
                    addLabel="Add header"
                    selectedId={selected?.side === side ? pathId(selected.path) : null}
                    mappedColors={mappedColors[side]}
                    suggestion={isPrimary ? null : suggestion}
                    onSelect={(path) => handleSelect(side, path)}
                    onDropField={(path, from) => createMapping(from, { side, path })}
                    onUnmap={(path) => unmapField(side, path)}
                    highlights={highlights[side]}
                    onHoverField={(path) => hoverField(side, path)}
                    {...headerHandlers(side)}
                    fixed={isPrimary ? undefined : state.fixed}
                    onToggleFixed={isPrimary ? undefined : (path) => toggleFixed(side, path)}
                    onSetFixed={isPrimary ? undefined : (path, fx) => setFixed(side, path, fx)}
                  />
                </div>
              )}
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
                fixed={isPrimary ? undefined : state.fixed}
                onToggleFixed={isPrimary ? undefined : (path) => toggleFixed(side, path)}
                onSetFixed={isPrimary ? undefined : (path, fx) => setFixed(side, path, fx)}
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
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-2xl font-semibold tracking-tight">Object Mapper</h1>
            <label className="group flex items-baseline gap-1.5 text-zinc-500" title="The document name is used as the report title and for exported file names">
              <span className="text-xs uppercase tracking-wide">Document</span>
              <input
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder={DEFAULT_DOC_NAME}
                aria-label="Document name"
                size={Math.max(16, (docName || DEFAULT_DOC_NAME).length + 1)}
                className="rounded border border-transparent bg-transparent px-1 text-base font-medium text-zinc-800 outline-none placeholder:text-zinc-400 hover:border-zinc-300 focus:border-blue-500 dark:text-zinc-200 dark:hover:border-zinc-700"
              />
              <span aria-hidden className="text-xs opacity-0 group-hover:opacity-60">✎</span>
            </label>
          </div>
          <p className="text-sm text-zinc-500">
            Click a field on one side, then a field on the other (or drag between them) to map it.
            Drag fields within the editable side to move them into objects or lists.{" "}
            {multi.enabled
              ? "Multi-source mode: each source maps into the 🔒 primary standard object."
              : "Values flow from the 🔒 primary object into the editable one."}
          </p>
        </div>
        <div className="ml-auto">
          <AppMenu
            bothEditable={bothEditable}
            onBothEditable={setBothEditable}
            onSwap={() => setPrimary(secondary)}
            multiMode={multi.enabled}
            onMultiMode={setMultiMode}
            onLoadMultiExample={loadMultiExample}
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

      {multi.enabled && activeSource && (
        <MultiBar
          sources={liveSources}
          activeSource={multi.activeSource}
          {...multiHandlers}
          fields={(lookups[secondary] ? leafPathsOf(lookups[secondary]!) : []).map((p) => ({ path: p, label: pathLabel(p) }))}
          matchesSample={(c) => {
            const body = sides[secondary].data;
            if (body === null) return null;
            const headers = activeHeaders(sides[secondary]);
            return c.when.every((cond) => conditionHolds(cond, body, headers));
          }}
          label={pathLabel}
        />
      )}

      <div ref={workspaceRef} className="relative grid grid-cols-1 gap-4 lg:grid-cols-[1fr_72px_1fr] lg:gap-0">
        {renderPanel("left")}
        <div className="hidden items-start justify-center pt-3 text-xl text-zinc-400 lg:flex" aria-hidden>
          {sourceSide === "left" ? "→" : "←"}
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
        primary={sourceSide}
        colorFor={colorFor}
        primaryTree={primaryTree}
        secondaryTree={secondaryTree}
        mappingSpec={mappingSpec}
        result={result}
        resultHeaders={resultHeaders}
        extraTabs={
          multi.enabled
            ? [
                {
                  id: "coverage",
                  label: "Coverage",
                  content: <CoverageTable rows={coverage} sources={liveSources} standardName={sides[primary].name} />,
                },
                { id: "testall", label: "Test all", content: <TestAll runs={testRuns} /> },
              ]
            : []
        }
        resultText={resultText}
        resultFormat={sides[targetSide].format}
        onDownload={downloadResult}
        hoveredIds={hoveredIds}
        onHover={(id) => setHover(id ? { ids: [id], via: "list" } : null)}
        onRemove={(id) => removeMappings([id])}
        onAddConstant={addConstant}
        onSetConstant={setConstant}
        onSetTranslate={setTranslate}
        sampleValuesFor={sampleValuesFor}
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
            <code className="font-semibold">{pathLabel(pendingCombine[targetSide])}</code> already gets{" "}
            <code>
              {mappings
                .filter((m) => pathId(m[targetSide]) === pathId(pendingCombine[targetSide]))
                .map((m) => sourceLabel(m, sourceSide))
                .join(" + ")}
            </code>
            .
          </span>
          <button
            autoFocus
            onClick={() => {
              addMapping(pendingCombine.left, pendingCombine.right, "combine", pendingCombine.constant, pendingCombine.db);
              setPendingCombine(null);
            }}
            className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
            title="Keep both sources; their values are joined (with a space unless you change it)"
          >
            ＋ Combine with{" "}
            {pendingCombine.constant !== undefined
              ? pendingCombine.db
                ? `database ${pendingCombine.db.table}.${pendingCombine.db.column} (constant)`
                : `${JSON.stringify(pendingCombine.constant)} (constant)`
              : pathLabel(pendingCombine[sourceSide])}
          </button>
          <button
            onClick={() => {
              addMapping(pendingCombine.left, pendingCombine.right, "replace", pendingCombine.constant, pendingCombine.db);
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

/** Standard fields down the side, sources across the top; each cell names the source field(s) feeding it. */
function CoverageTable({
  rows,
  sources,
  standardName,
}: {
  standardName?: string;
  rows: { path: Path; cells: { caseName: string; fields: string[] }[][] }[] | null;
  sources: { id: string; name: string }[];
}) {
  if (!rows) return <p className="text-sm text-zinc-500">Load a standard object to see coverage.</p>;
  const gaps = rows.reduce((n, r) => n + r.cells.filter((c) => c.every((k) => k.fields.length === 0)).length, 0);
  return (
    <div className="overflow-auto">
      <p className="mb-2 text-xs text-zinc-500">
        Which source field feeds each standard field.{" "}
        {gaps ? (
          <span className="text-amber-700 dark:text-amber-400">{gaps} gap{gaps === 1 ? "" : "s"} (—).</span>
        ) : (
          "No gaps."
        )}
      </p>
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="text-zinc-500">
            <th className="sticky left-0 bg-white py-1 pr-3 font-normal dark:bg-zinc-900">
              {standardName?.trim() || "Standard"} field
            </th>
            {sources.map((s) => (
              <th key={s.id} className="py-1 pr-3 font-medium text-zinc-700 dark:text-zinc-300">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr key={pathId(r.path)} className="border-t border-zinc-100 align-top dark:border-zinc-800">
              <td className="sticky left-0 bg-white py-1 pr-3 dark:bg-zinc-900">{pathLabel(r.path)}</td>
              {r.cells.map((cases, i) => {
                const mapped = cases.filter((c) => c.fields.length > 0);
                if (mapped.length === 0) {
                  return (
                    <td key={i} className="bg-amber-50 py-1 pr-3 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                      —
                    </td>
                  );
                }
                const same = mapped.length === cases.length && mapped.every((c) => c.fields.join() === mapped[0].fields.join());
                return (
                  <td key={i} className="py-1 pr-3">
                    {same
                      ? mapped[0].fields.join(" + ")
                      : cases.map((c) => (
                          <div key={c.caseName}>
                            <span className="font-sans text-zinc-400">{c.caseName}:</span> {c.fields.join(" + ") || "—"}
                          </div>
                        ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every source's sample run through the case that matches it, side by side. */
function TestAll({
  runs,
}: {
  runs:
    | ({ id: string; name: string } & (
        | { error: string }
        | { caseName: string; text: string; headers: Headers | null }
      ))[]
    | null;
}) {
  if (!runs) return <p className="text-sm text-zinc-500">Load a standard object to test.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {runs.map((r) => (
        <div key={r.id} className="flex min-w-0 flex-col rounded-lg border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-baseline justify-between gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
            <span className="truncate text-sm font-medium">{r.name}</span>
            {"caseName" in r && <span className="truncate text-xs text-zinc-500">case: {r.caseName}</span>}
          </div>
          {"error" in r ? (
            <p className="px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{r.error}</p>
          ) : (
            <>
              {r.headers && (
                <div className="border-b border-zinc-100 px-3 py-1 font-mono text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  {Object.entries(r.headers).map(([k, v]) => (
                    <div key={k}>
                      {k}: {typeof v === "string" ? v : JSON.stringify(v)}
                    </div>
                  ))}
                </div>
              )}
              <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px]">{r.text}</pre>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** Constant / translation details for the Mapping JSON view. */
function specExtras(m: Mapping): { constant?: Json; translate?: Translation } {
  return {
    ...(m.constant !== undefined ? { constant: m.constant } : {}),
    ...(m.translate ? { translate: m.translate } : {}),
  };
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

/** An object's name, edited in place in its panel title. */
function ObjectNameInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (name: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label="Object name"
      title="Name this object (used in the report)"
      size={Math.max(8, (value || placeholder).length + 1)}
      className="rounded border border-transparent bg-transparent px-1 font-semibold normal-case text-zinc-900 outline-none placeholder:text-zinc-900 hover:border-zinc-300 focus:border-blue-500 focus:placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-100 dark:hover:border-zinc-700"
    />
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
  resultHeaders,
  extraTabs,
  resultText,
  resultFormat,
  onDownload,
  hoveredIds,
  onHover,
  onRemove,
  onSetJoin,
  onMoveInGroup,
  onAddConstant,
  onSetConstant,
  onSetTranslate,
  sampleValuesFor,
  onClear,
}: {
  mappings: Mapping[];
  primary: Side;
  colorFor: Map<string, string>;
  primaryTree: FieldNode | null;
  secondaryTree: FieldNode | null;
  mappingSpec: { from: string | string[]; to: string; join?: string }[];
  result: Json | null;
  /** The target's headers after mapping, when it has any. */
  resultHeaders: Headers | null;
  /** More tabs (multi-source mode: Coverage, Test all). */
  extraTabs: { id: string; label: string; content: React.ReactNode }[];
  /** The mapped result written in the target's file format. */
  resultText: string | null;
  resultFormat: Format;
  onDownload: () => void;
  hoveredIds: string[] | null;
  onHover: (id: string | null) => void;
  onRemove: (id: string) => void;
  onSetJoin: (targetId: string, join: string) => void;
  onMoveInGroup: (id: string, dir: -1 | 1) => void;
  onAddConstant: (target: Path, constant: { value: Json; db?: DbRef }) => void;
  onSetConstant: (id: string, constant: { value: Json; db?: DbRef }) => void;
  onSetTranslate: (id: string, t: Translation | undefined) => void;
  sampleValuesFor: (m: Mapping) => string[];
  onClear: () => void;
}) {
  const [tab, setTab] = useState<Tab | string>("mappings");
  const [addingConstant, setAddingConstant] = useState(false);
  const [translating, setTranslating] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [collapsed, toggleCollapsed] = useStoredFlag(OUTPUT_COLLAPSED_KEY);
  const secondary = other(primary);

  const texts: Record<Exclude<Tab, "mappings">, string | null> = {
    result: resultText,
    flat: result === null ? null : JSON.stringify(flatten(result), null, 2),
    spec: JSON.stringify(mappingSpec, null, 2),
  };
  const extra = extraTabs.find((t) => t.id === tab);
  const copyText = tab === "mappings" || extra ? null : texts[tab as Exclude<Tab, "mappings">];

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

  const tabs: [Tab | string, string][] = [
    ["mappings", `Mappings (${mappings.length})`],
    ...extraTabs.map((t): [string, string] => [t.id, t.label]),
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
            {tab === "mappings" && secondaryTree && (
              <HeaderButton onClick={() => setAddingConstant((a) => !a)}>＋ Constant value</HeaderButton>
            )}{" "}
            {tab === "mappings" && mappings.length > 0 && <HeaderButton onClick={onClear}>Remove all</HeaderButton>}
          </div>
        )}
      </header>

      <div className={collapsed ? "hidden" : "p-3"}>
        {tab === "mappings" && addingConstant && secondaryTree && (
          <ConstantForm
            fields={leafPathsOf(secondaryTree).filter((p) => !(p.length === 1 && p[0] === HEADERS))}
            onAdd={(target, value) => {
              onAddConstant(target, value);
              setAddingConstant(false);
            }}
            onCancel={() => setAddingConstant(false)}
          />
        )}
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
                  const isConst = isConstPath(from);
                  const fromType = isConst ? undefined : primaryTree && findNode(primaryTree, from)?.type;
                  const mismatch = group.length === 1 && fromType && toType && fromType !== toType;
                  return (
                    <Fragment key={m.id}>
                    <li
                      onMouseEnter={() => onHover(m.id)}
                      onMouseLeave={() => onHover(null)}
                      className={`group flex items-center gap-2 rounded-md px-2 py-1 font-mono text-sm ${
                        hoveredIds?.includes(m.id) ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorFor.get(m.id) }} />
                      {group.length > 1 && <span className="w-4 text-right font-sans text-xs text-zinc-400">{i + 1}.</span>}
                      {isConst ? (
                        <span className="flex items-center gap-1">
                          <span className="rounded bg-zinc-200 px-1 font-sans text-[10px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                            constant
                          </span>
                          <ConstantFields
                            draft={draftOf(m.constant, m.db)}
                            onChange={(d) => onSetConstant(m.id, fromDraft(d))}
                          />
                        </span>
                      ) : (
                        <>
                          <span className="text-zinc-500">{primary}.</span>
                          <span>{pathLabel(from)}</span>
                        </>
                      )}
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
                      {m.translate && (
                        <span
                          className="truncate rounded bg-violet-100 px-1.5 font-sans text-[11px] text-violet-800 dark:bg-violet-950 dark:text-violet-300"
                          title={describeTranslation(m.translate)}
                        >
                          ⇄ {m.translate.pairs.filter(([a]) => a.trim()).length} value
                          {m.translate.pairs.filter(([a]) => a.trim()).length === 1 ? "" : "s"}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-1">
                        {!isConst && (
                          <button
                            onClick={() => setTranslating((t) => (t === m.id ? null : m.id))}
                            className={`rounded-md px-2 py-0.5 font-sans text-xs ${
                              translating === m.id
                                ? "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300"
                                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            }`}
                            title="Translate values (e.g. INSUFFICIENT_FUNDS → PAY-001)"
                          >
                            ⇄ Translate
                          </button>
                        )}
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
                    {translating === m.id && (
                      <li>
                        <TranslationEditor
                          value={m.translate}
                          sampleValues={sampleValuesFor(m)}
                          onChange={(t) => onSetTranslate(m.id, t)}
                          onClose={() => setTranslating(null)}
                        />
                      </li>
                    )}
                    </Fragment>
                  );
                };
                if (group.length === 1) return row(group[0], 0);

                // Several sources combined into one target.
                const targetId = pathId(to);
                const join = group.find((m) => m.join !== undefined)?.join ?? " ";
                const sample = result === null ? undefined : valuesAtPath(result, resultHeaders ?? undefined, to)[0];
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

        {tab === "result" && resultHeaders && (
          <div className="mb-2 rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Headers</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 font-mono">
              {Object.entries(resultHeaders).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd className="break-all">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {extra?.content}
        {tab !== "mappings" && !extra && (
          <pre className="max-h-96 overflow-auto rounded-md bg-zinc-50 p-3 font-mono text-xs dark:bg-zinc-950">
            {texts[tab as Exclude<Tab, "mappings">] ?? "Load both objects to see the mapped result."}
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
