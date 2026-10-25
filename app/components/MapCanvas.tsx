"use client";

// A zoomable canvas of every object in multi-source mode: each source and the
// standard as a floating card, with a line for every mapping. Click a card to
// see only its lines, click a field to see where it goes (or, on the standard,
// everything that feeds it). Cards can be dragged; the layout is remembered.

import { useEffect, useMemo, useRef, useState } from "react";

export interface CanvasField {
  pid: string;
  label: string;
  depth: number;
  type: string;
  value?: string;
}

export interface CanvasCard {
  id: string;
  title: string;
  subtitle: string;
  kind: "source" | "standard";
  color: string;
  fields: CanvasField[];
}

export interface CanvasLink {
  sourceId: string;
  /** Source field pathId (or a constant's id). */
  from: string;
  /** Standard field pathId. */
  to: string;
  color: string;
}

export type CanvasPositions = Record<string, { x: number; y: number }>;

const W = 280;
const HEAD = 44;
const ROW = 22;
const GAP = 48;

const cardHeight = (c: CanvasCard) => HEAD + Math.max(1, c.fields.length) * ROW + 10;

type Selection = { card: string; field?: string } | null;

export function MapCanvas({
  cards,
  links,
  positions,
  onMove,
  onOpen,
  /** Standard field pathId -> source ids feeding it (dots on the standard card). */
  feeders,
  /** One source at a time: each source's own result, shown on the standard while that source is selected. */
  results,
  onMap,
  onShowObject,
}: {
  /** Show a card's whole object (read-only). */
  onShowObject?: (id: string) => void;
  results?: Record<string, { label: string; values: Map<string, string | undefined> }>;
  /** Drag from a source field to a standard field: map it (in the case the card shows). */
  onMap?: (sourceId: string, from: string, to: string) => void;
  cards: CanvasCard[];
  links: CanvasLink[];
  positions: CanvasPositions;
  onMove: (id: string, pos: { x: number; y: number }) => void;
  onOpen: (id: string) => void;
  feeders?: Map<string, string[]>;
}) {
  // ---------- layout (saved positions, else sources in a column with the standard to the right) ----------
  const layout = useMemo(() => {
    const out: CanvasPositions = {};
    let y = 0;
    const sources = cards.filter((c) => c.kind === "source");
    for (const c of sources) {
      out[c.id] = positions[c.id] ?? { x: 0, y };
      y += cardHeight(c) + GAP;
    }
    const std = cards.find((c) => c.kind === "standard");
    if (std) {
      const total = Math.max(y - GAP, cardHeight(std));
      out[std.id] = positions[std.id] ?? { x: W + 260, y: Math.max(0, (total - cardHeight(std)) / 2) };
    }
    return out;
  }, [cards, positions]);

  // ---------- view: pan + zoom ----------
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 40, y: 40, k: 0.85 });
  const [selected, setSelected] = useState<Selection>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  // Drawing a new mapping: from a source field to the pointer.
  const [linking, setLinking] = useState<{ sourceId: string; from: string; x: number; y: number; over: string | null } | null>(null);
  const linked = useRef(false);
  const pos = (id: string) => (dragPos?.id === id ? dragPos : layout[id]) ?? { x: 0, y: 0 };

  const fit = () => {
    const box = boxRef.current;
    if (!box || !cards.length) return;
    const xs = cards.map((c) => layout[c.id]);
    const minX = Math.min(...xs.map((p) => p.x));
    const minY = Math.min(...xs.map((p) => p.y));
    const maxX = Math.max(...cards.map((c) => layout[c.id].x + W));
    const maxY = Math.max(...cards.map((c) => layout[c.id].y + cardHeight(c)));
    const k = Math.min(1.4, Math.max(0.2, Math.min((box.clientWidth - 60) / (maxX - minX), (box.clientHeight - 60) / (maxY - minY))));
    setView({ k, x: (box.clientWidth - (maxX - minX) * k) / 2 - minX * k, y: (box.clientHeight - (maxY - minY) * k) / 2 - minY * k });
  };
  // Fit once when the canvas first has its size.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !boxRef.current?.clientWidth) return;
    fitted.current = true;
    // Not cancelled on re-render: the fit must still happen once the first frame is laid out.
    requestAnimationFrame(fit);
  });

  const zoomAt = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.15, v.k * factor));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });

  /** Zoom around the middle of the canvas (the +/− buttons). */
  const zoomCenter = (factor: number) => {
    const box = boxRef.current;
    zoomAt(factor, (box?.clientWidth ?? 0) / 2, (box?.clientHeight ?? 0) / 2);
  };

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  /** Drag the background to pan; drag a card header to move the card. */
  const startDrag = (e: React.PointerEvent, cardId?: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    const origin = cardId ? pos(cardId) : { x: view.x, y: view.y };
    const k = view.k;
    let moved = false;
    let last = origin;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (cardId) {
        last = { x: origin.x + dx / k, y: origin.y + dy / k };
        setDragPos({ id: cardId, ...last });
      } else setView((v) => ({ ...v, x: origin.x + dx, y: origin.y + dy }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (cardId && moved) onMove(cardId, last);
      setDragPos(null);
      if (!moved && !cardId) setSelected(null); // a click on the background clears the selection
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Pointer position in canvas coordinates. */
  const toCanvas = (clientX: number, clientY: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
  };
  /** Start drawing a mapping from a source field (it becomes a drag once the pointer moves). */
  const startLink = (e: React.PointerEvent, sourceId: string, from: string) => {
    if (!onMap || e.button !== 0) return;
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    let active = false;
    linked.current = false;
    const stdUnder = (ev: PointerEvent) =>
      (document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-std-pid]") as HTMLElement | null)?.dataset.stdPid ?? null;
    const move = (ev: PointerEvent) => {
      if (!active && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < 5) return;
      active = true;
      setLinking({ sourceId, from, ...toCanvas(ev.clientX, ev.clientY), over: stdUnder(ev) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLinking(null);
      if (!active) return;
      linked.current = true; // not a click: don't change the selection
      const to = stdUnder(ev);
      if (to) onMap(sourceId, from, to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---------- what is highlighted ----------
  const std = cards.find((c) => c.kind === "standard");
  // The selected source's own result (one-at-a-time mode), shown on the standard card.
  const shownResult = selected && selected.card !== std?.id ? results?.[selected.card] : undefined;
  const linkOn = (l: CanvasLink) => {
    if (!selected) return true;
    if (selected.card === std?.id) return selected.field ? l.to === selected.field : true;
    if (selected.card !== l.sourceId) return false;
    return selected.field ? l.from === selected.field : true;
  };
  const activeLinks = links.filter(linkOn);
  const litFields = new Set(activeLinks.flatMap((l) => [`${l.sourceId}|${l.from}`, `${std?.id}|${l.to}`]));
  const fieldLit = (card: string, pid: string) => !selected || litFields.has(`${card}|${pid}`);

  const rowY = (card: CanvasCard, pid: string) => {
    const i = card.fields.findIndex((f) => f.pid === pid);
    return i < 0 ? null : pos(card.id).y + HEAD + i * ROW + ROW / 2;
  };

  const paths = std
    ? links.map((l, i) => {
        const src = cards.find((c) => c.id === l.sourceId);
        if (!src) return null;
        const y1 = rowY(src, l.from);
        const y2 = rowY(std, l.to);
        if (y1 === null || y2 === null) return null;
        const a = pos(src.id);
        const b = pos(std.id);
        const leftToRight = a.x + W / 2 <= b.x + W / 2;
        const x1 = leftToRight ? a.x + W : a.x;
        const x2 = leftToRight ? b.x : b.x + W;
        const bend = Math.max(60, Math.abs(x2 - x1) / 2) * (leftToRight ? 1 : -1);
        const on = linkOn(l);
        return (
          <path
            key={i}
            d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke={l.color}
            strokeWidth={on && selected ? 2.4 : 1.6}
            strokeOpacity={on ? 0.9 : 0.08}
          />
        );
      })
    : [];

  return (
    <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <div
        ref={boxRef}
        onPointerDown={(e) => startDrag(e)}
        className="h-[70vh] min-h-96 cursor-grab touch-none select-none active:cursor-grabbing"
        style={{
          backgroundImage: "radial-gradient(circle, rgb(161 161 170 / 0.35) 1px, transparent 1px)",
          backgroundSize: `${22 * view.k}px ${22 * view.k}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
            {paths}
            {linking &&
              (() => {
                const src = cards.find((x) => x.id === linking.sourceId);
                const y1 = src ? rowY(src, linking.from) : null;
                if (!src || y1 === null) return null;
                const a = pos(src.id);
                const x1 = linking.x >= a.x + W / 2 ? a.x + W : a.x;
                const bend = Math.max(40, Math.abs(linking.x - x1) / 2) * (linking.x >= x1 ? 1 : -1);
                return (
                  <path
                    d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${linking.x - bend} ${linking.y}, ${linking.x} ${linking.y}`}
                    fill="none"
                    stroke={src.color}
                    strokeWidth={2.4}
                    strokeDasharray="6 4"
                  />
                );
              })()}
          </svg>
          {cards.map((c) => {
            const p = pos(c.id);
            const isSel = selected?.card === c.id;
            const dim = selected && !isSel && !c.fields.some((f) => fieldLit(c.id, f.pid));
            return (
              <div
                key={c.id}
                className={`absolute rounded-lg border bg-white shadow-sm transition-opacity dark:bg-zinc-900 ${
                  isSel ? "ring-2 ring-blue-500" : "border-zinc-200 dark:border-zinc-700"
                } ${dim ? "opacity-40" : ""}`}
                style={{ left: p.x, top: p.y, width: W }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div
                  onPointerDown={(e) => startDrag(e, c.id)}
                  onClick={() => setSelected(isSel && !selected?.field ? null : { card: c.id })}
                  onDoubleClick={() => c.kind === "source" && onOpen(c.id)}
                  className="flex h-[44px] cursor-move items-center gap-2 rounded-t-lg border-b border-zinc-100 px-3 dark:border-zinc-800"
                  style={{ borderTop: `3px solid ${c.color}` }}
                  title={`${c.title}: ${c.kind === "source" ? "click to highlight its mappings · drag to move · double-click to edit" : "click to highlight everything feeding it · drag to move"}`}
                >
                  <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.title}</span>
                  <span
                    className={`ml-auto min-w-0 truncate text-[10px] uppercase tracking-wide ${
                      c.kind === "standard" && shownResult ? "font-semibold text-blue-600 dark:text-blue-400" : "text-zinc-400"
                    }`}
                    title={c.kind === "standard" && shownResult ? shownResult.label : c.subtitle}
                  >
                    {c.kind === "standard" && shownResult ? shownResult.label : c.subtitle}
                  </span>
                  {onShowObject && (
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowObject(c.id);
                      }}
                      aria-label={`Show ${c.title} as an object`}
                      title="Show the whole object"
                      className="shrink-0 rounded border border-zinc-200 px-1 font-mono text-[11px] leading-4 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      {"{ }"}
                    </button>
                  )}
                </div>
                <ul className="py-[5px]">
                  {c.fields.map((f) => {
                    const lit = fieldLit(c.id, f.pid);
                    const fieldSel = isSel && selected?.field === f.pid;
                    return (
                      <li
                        key={f.pid}
                        data-std-pid={c.kind === "standard" ? f.pid : undefined}
                        onPointerDown={c.kind === "source" && f.type !== "const" ? (e) => startLink(e, c.id, f.pid) : undefined}
                        onClick={() => {
                          if (linked.current) {
                            linked.current = false;
                            return;
                          }
                          setSelected(fieldSel ? { card: c.id } : { card: c.id, field: f.pid });
                        }}
                        className={`flex h-[22px] cursor-pointer items-center gap-1.5 pr-2 font-mono text-[11px] ${
                          linking && c.kind === "standard" && linking.over === f.pid
                            ? "bg-emerald-100 ring-1 ring-emerald-500 dark:bg-emerald-950"
                            : fieldSel
                              ? "bg-blue-50 dark:bg-blue-950/60"
                              : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                        } ${lit || linking ? "" : "opacity-30"}`}
                        style={{ paddingLeft: 10 + f.depth * 12 }}
                        title={f.value !== undefined ? `${f.label}: ${f.value}` : f.label}
                      >
                        <span className="max-w-[65%] shrink-0 truncate text-zinc-800 dark:text-zinc-200">{f.label}</span>
                        <span className="shrink-0 text-[9px] text-zinc-400">{f.type}</span>
                        {(() => {
                          // On the standard, a selected source's own result replaces the template values.
                          const v = c.kind === "standard" && shownResult ? shownResult.values.get(f.pid) : f.value;
                          return v !== undefined ? (
                            <span className={`min-w-0 truncate ${c.kind === "standard" && shownResult ? "text-blue-700 dark:text-blue-300" : "text-zinc-500"}`}>{v}</span>
                          ) : null;
                        })()}
                        {c.kind === "standard" && feeders?.get(f.pid) && (
                          <span className="ml-auto flex shrink-0 gap-0.5">
                            {feeders.get(f.pid)!.map((sid) => (
                              <span
                                key={sid}
                                className="h-2 w-2 rounded-full"
                                style={{ background: cards.find((x) => x.id === sid)?.color }}
                                title={cards.find((x) => x.id === sid)?.title}
                              />
                            ))}
                          </span>
                        )}
                      </li>
                    );
                  })}
                  {c.fields.length === 0 && <li className="px-3 text-xs text-zinc-400">No sample loaded</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md border border-zinc-200 bg-white/90 p-1 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900/90">
        <button onClick={() => zoomCenter(1 / 1.2)} title="Zoom out" aria-label="Zoom out" className="h-6 min-w-6 rounded px-1.5 text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
          −
        </button>
        <button onClick={() => zoomCenter(1.2)} title="Zoom in" aria-label="Zoom in" className="h-6 min-w-6 rounded px-1.5 text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
          +
        </button>
        <button onClick={fit} title="Fit everything" aria-label="Fit everything" className="h-6 min-w-6 rounded px-1.5 text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800">
          ⤢
        </button>
        <span className="px-1 tabular-nums text-zinc-500">{Math.round(view.k * 100)}%</span>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-zinc-500">
        Scroll to zoom · drag to pan · drag a source field onto a standard field to map it · click a card or field to trace its mappings{results ? " (a source also shows its own result on the standard)" : ""} · double-click a source to edit it
        {selected && " · click empty space to clear"}
      </p>
    </div>
  );
}
