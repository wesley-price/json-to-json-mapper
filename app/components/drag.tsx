"use client";

// Pointer-based drag and drop for field rows. (Native HTML5 drag and drop is
// unreliable here: drops only land on elements that keep cancelling dragover,
// and it gives no control over the drag image or auto-scrolling.)
//
// Drop zones register with an id and are found under the pointer through the
// `data-drop-zone` attribute, so nested elements resolve to their zone.

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { Path, Side } from "@/lib/json-tree";

export interface Drag {
  side: Side;
  path: Path;
  label: string;
}

export type DropKind = "map" | "into" | "after" | "blocked";
export interface DropIntent {
  kind: DropKind;
  label: string;
}

interface Zone {
  intent: (drag: Drag) => DropIntent | null;
  drop: (drag: Drag, intent: DropIntent) => void;
}

interface DragState {
  drag: Drag | null;
  overId: string | null;
  intent: DropIntent | null;
}

const zones = new Map<string, Zone>();
const idle: DragState = { drag: null, overId: null, intent: null };
let state: DragState = idle;
let pointer = { x: 0, y: 0 };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Start tracking a possible drag from a row's pointerdown. */
export function beginDrag(e: React.PointerEvent, drag: Drag) {
  if (e.button !== 0) return;
  // Let the row's own controls (type pickers, buttons, inputs) work normally.
  if ((e.target as HTMLElement).closest("button, select, input, textarea, label")) return;

  const start = { x: e.clientX, y: e.clientY };
  let active = false;
  let frame = 0;

  const update = () => {
    const el = document
      .elementFromPoint(pointer.x, pointer.y)
      ?.closest<HTMLElement>("[data-drop-zone]");
    const id = el?.dataset.dropZone ?? null;
    const intent = (id && zones.get(id)?.intent(drag)) || null;
    const overId = intent ? id : null;
    if (overId !== state.overId || intent?.label !== state.intent?.label || intent?.kind !== state.intent?.kind) {
      state = { drag, overId, intent };
    }
    emit();
  };

  // Scroll the panel (or the page) while the pointer is near its edge.
  const autoScroll = () => {
    const panel = document
      .elementFromPoint(pointer.x, pointer.y)
      ?.closest<HTMLElement>("[data-drag-scroll]");
    const edge = 36;
    const speed = (d: number) => Math.ceil(((edge - d) / edge) * 14);
    if (panel) {
      const box = panel.getBoundingClientRect();
      if (pointer.y < box.top + edge) panel.scrollTop -= speed(pointer.y - box.top);
      else if (pointer.y > box.bottom - edge) panel.scrollTop += speed(box.bottom - pointer.y);
    }
    if (pointer.y < edge) window.scrollBy(0, -speed(pointer.y));
    else if (pointer.y > window.innerHeight - edge) window.scrollBy(0, speed(window.innerHeight - pointer.y));
    update();
    frame = requestAnimationFrame(autoScroll);
  };

  const onMove = (ev: PointerEvent) => {
    pointer = { x: ev.clientX, y: ev.clientY };
    if (!active) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
      active = true;
      document.body.classList.add("dragging-field");
      frame = requestAnimationFrame(autoScroll);
    }
    update();
  };

  const finish = (commit: boolean) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey);
    cancelAnimationFrame(frame);
    document.body.classList.remove("dragging-field");
    const { overId, intent } = state;
    state = idle;
    emit();
    if (!active) return;
    // The click that follows a drag would select the row under the pointer.
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    if (commit && overId && intent && intent.kind !== "blocked") zones.get(overId)?.drop(drag, intent);
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") finish(false);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey);
}

/** Register a drop zone; returns the intent while the pointer is over it. */
export function useDropZone(
  id: string,
  intent: (drag: Drag) => DropIntent | null,
  drop: (drag: Drag, intent: DropIntent) => void,
): DropIntent | null {
  const latest = useRef({ intent, drop });
  useLayoutEffect(() => {
    latest.current = { intent, drop };
  });
  useEffect(() => {
    zones.set(id, {
      intent: (d) => latest.current.intent(d),
      drop: (d, i) => latest.current.drop(d, i),
    });
    return () => {
      zones.delete(id);
    };
  }, [id]);
  return useSyncExternalStore(
    subscribe,
    () => (state.overId === id ? state.intent : null),
    () => null,
  );
}

/** True while `side`/`path` is the field being dragged. */
export function useIsDragSource(side: Side, path: Path): boolean {
  const key = JSON.stringify(path);
  return useSyncExternalStore(
    subscribe,
    () => state.drag !== null && state.drag.side === side && JSON.stringify(state.drag.path) === key,
    () => false,
  );
}

const GHOST_STYLES: Record<DropKind | "none", string> = {
  none: "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900",
  map: "bg-blue-600 text-white",
  into: "bg-emerald-600 text-white",
  after: "bg-emerald-600 text-white",
  blocked: "bg-red-600 text-white",
};

/** Floating chip that follows the pointer during a drag. Render once per page. */
export function DragGhost() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (state.drag ? `${pointer.x},${pointer.y}` : ""),
    () => "",
  );
  if (!snapshot || !state.drag) return null;
  const { drag, intent } = state;
  return (
    <div
      className={`pointer-events-none fixed z-50 flex items-center gap-2 rounded-md px-2 py-1 font-mono text-xs shadow-lg ${
        GHOST_STYLES[intent?.kind ?? "none"]
      }`}
      style={{ left: pointer.x + 14, top: pointer.y + 10 }}
    >
      <span className="font-semibold">{drag.label}</span>
      <span className="font-sans opacity-90">
        {intent ? `→ ${intent.label}` : "drop on an object, list or field"}
      </span>
    </div>
  );
}
