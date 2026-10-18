// Theme preference: "light", "dark" or "system" (follow the OS). The resolved
// theme is set as data-theme on <html>, which drives Tailwind's dark: styles.

export type ThemePreference = "light" | "dark" | "system";

export const THEME_KEY = "object-mapper:theme";

/**
 * Runs inline in <head> before the first paint so the saved theme is applied
 * without a flash. Kept dependency-free since it is injected as a string.
 */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_KEY)})||"system";var t=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
