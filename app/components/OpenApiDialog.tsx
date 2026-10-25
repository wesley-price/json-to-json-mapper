"use client";

// Import from OpenAPI: paste or open an API spec (JSON or YAML), then pick
// which schema becomes the source or the target. An operation's responses
// can each become a scenario (200, 404, 422…) in one click.

import { useMemo, useRef, useState } from "react";
import { type ApiSchemaEntry, type ApiSpec, readOpenApi } from "@/lib/openapi";

interface Props {
  onClose: () => void;
  onUse: (entry: ApiSchemaEntry, role: "source" | "target") => void;
  onScenarios: (entries: ApiSchemaEntry[]) => void;
  /** "Source" / "Standard" etc., as the panels call them. */
  sourceLabel: string;
  targetLabel: string;
}

export function OpenApiDialog({ onClose, onUse, onScenarios, sourceLabel, targetLabel }: Props) {
  const [text, setText] = useState("");
  const [spec, setSpec] = useState<ApiSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const read = (t: string) => {
    try {
      setSpec(readOpenApi(t));
      setError(null);
    } catch (e) {
      setSpec(null);
      setError((e as Error).message);
    }
  };

  const groups = useMemo(() => {
    const out = new Map<string, ApiSchemaEntry[]>();
    for (const e of spec?.entries ?? []) out.set(e.group, [...(out.get(e.group) ?? []), e]);
    return [...out];
  }, [spec]);

  const btn =
    "rounded border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Import from OpenAPI"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-lg border border-zinc-200 bg-white p-4 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Import from OpenAPI</h2>
          <button onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            ✕
          </button>
        </div>
        {!spec ? (
          <>
            <p className="text-xs text-zinc-500">
              Paste an OpenAPI 3 or Swagger 2 spec (JSON or YAML), or open the file. You then pick which schema is the source and which is the target.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="OpenAPI spec"
              placeholder={"openapi: 3.0.3\ninfo: { title: Orders, version: 1.0.0 }\npaths: …"}
              className="h-64 w-full rounded border border-zinc-300 bg-white p-2 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
            />
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => read(text)}
                disabled={!text.trim()}
                className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Read spec
              </button>
              <button onClick={() => fileRef.current?.click()} className={btn}>
                Open file…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.yaml,.yml,application/json,application/yaml"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const t = await file.text();
                  setText(t);
                  read(t);
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{spec.title}</span>
                {spec.version && ` v${spec.version}`} · {spec.entries.length} schemas
              </span>
              <button onClick={() => setSpec(null)} className={btn}>
                ← Another spec
              </button>
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto pr-1">
              {groups.map(([group, entries]) => {
                const responses = entries.filter((e) => e.kind === "response");
                return (
                  <section key={group} className="rounded border border-zinc-200 dark:border-zinc-800">
                    <header className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-800 dark:bg-zinc-950">
                      <span className="font-mono text-xs font-medium">{group}</span>
                      {responses.length > 1 && (
                        <button
                          onClick={() => onScenarios(responses)}
                          className={btn}
                          title={`One scenario per response, each with the response as the ${targetLabel.toLowerCase()} and a copy of the current ${sourceLabel.toLowerCase()}`}
                        >
                          One scenario per response ({responses.length})
                        </button>
                      )}
                    </header>
                    <ul>
                      {entries.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
                          <span className="min-w-0 truncate" title={e.label}>
                            {e.label}
                          </span>
                          <span className="flex shrink-0 gap-1">
                            <button onClick={() => onUse(e, "source")} className={btn} aria-label={`Use ${group} ${e.label} as ${sourceLabel}`}>
                              → {sourceLabel}
                            </button>
                            <button onClick={() => onUse(e, "target")} className={btn} aria-label={`Use ${group} ${e.label} as ${targetLabel}`}>
                              → {targetLabel}
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
