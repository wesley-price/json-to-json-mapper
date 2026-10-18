"use client";

import { useEffect, useSyncExternalStore } from "react";
import { THEME_KEY, type ThemePreference } from "../theme";

const listeners = new Set<() => void>();
let memoryPref: ThemePreference = "system"; // used when storage is blocked

function readPref(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return memoryPref;
  }
}

function apply(pref: ThemePreference) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

function setPref(pref: ThemePreference) {
  memoryPref = pref;
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // not persisted; applies for this visit
  }
  apply(pref);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function ThemeSwitch() {
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as ThemePreference);

  // While following the OS, react to it switching between light and dark.
  useEffect(() => {
    apply(pref);
    if (pref !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [pref]);

  return (
    <label className="flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      <span aria-hidden>{pref === "light" ? "☀" : pref === "dark" ? "☾" : "◐"}</span>
      <select
        value={pref}
        onChange={(e) => setPref(e.target.value as ThemePreference)}
        aria-label="Theme"
        className="bg-transparent py-0.5 outline-none"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
