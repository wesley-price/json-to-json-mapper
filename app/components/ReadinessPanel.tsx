"use client";

// "Ready to build?" — the checklist in the header: unmapped fields without a
// decision, open questions, database constants without a lookup key, sources
// no case handles, merge conflicts, missing spec details.

import { useEffect, useRef, useState } from "react";
import { type ReadinessItem, readinessCounts } from "@/lib/readiness";

const DOT: Record<ReadinessItem["status"], string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  info: "bg-sky-500",
};

export function ReadinessPanel({ items, onAction }: { items: ReadinessItem[]; onAction: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const { warnings } = readinessCounts(items);
  const actionLabel: Record<string, string> = {
    undecided: "Decide",
    questions: "Review",
    dbkeys: "Show",
    nocase: "Open cases",
    gaps: "Coverage",
    conflicts: "Show",
    spec: "Fill in",
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
          warnings
            ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
            : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
        }`}
        title="Is this mapping ready to hand off?"
      >
        {warnings ? `⚠ ${warnings} to check` : "✓ Ready to build"}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Readiness"
          className="absolute left-0 top-full z-40 mt-1 max-h-[70vh] w-[28rem] max-w-[90vw] overflow-auto rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <p className="mb-2 text-zinc-500">Ready to hand off? The same checklist opens the report.</p>
          <ul className="flex flex-col gap-2">
            {items.map((it) => (
              <li key={it.id} className="flex gap-2">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[it.status]}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">{it.title}</span>
                    {it.status !== "ok" && actionLabel[it.id] && (
                      <button
                        onClick={() => {
                          setOpen(false);
                          onAction(it.id);
                        }}
                        className="ml-auto shrink-0 text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {actionLabel[it.id]}
                      </button>
                    )}
                  </div>
                  {it.detail && <p className="text-zinc-500">{it.detail}</p>}
                  {it.items.length > 0 && (
                    <ul className="mt-0.5 list-disc pl-4 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                      {it.items.slice(0, 8).map((x) => (
                        <li key={x} className="truncate" title={x}>
                          {x}
                        </li>
                      ))}
                      {it.items.length > 8 && <li className="list-none font-sans text-zinc-400">…and {it.items.length - 8} more</li>}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
