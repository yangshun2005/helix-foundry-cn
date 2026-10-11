import { useState } from "react";
import { readStorage, writeStorage } from "../kit/util";

export type ThemePreference = "system" | "light" | "dark";
const KEY = "foundry.theme";
// Pre-overhaul pages are only partly themed, so dark (and following the OS
// into dark) stays opt-in until every area is rebuilt with the kit.
export const themeOptions: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark (beta)" },
  { value: "system", label: "System (beta)" },
];
const backgrounds = { light: "#f8f7f3", dark: "#161713" };

export function readTheme(): ThemePreference {
  const v = readStorage(KEY, "light");
  return v === "dark" || v === "system" ? v : "light";
}
// data-theme on <html> picks the --hf-* token set; without it the OS decides.
export function applyTheme(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  syncThemeColor();
}
// The browser chrome colour follows the shell's theme while the shell is
// mounted (html.hf-root); onboarding and sign-in stay light.
export function syncThemeColor() {
  const root = document.documentElement,
    pref = root.classList.contains("hf-root") ? readTheme() : "light";
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => {
      const scheme =
        pref === "system"
          ? meta.media.includes("dark")
            ? "dark"
            : "light"
          : pref;
      meta.content = backgrounds[scheme];
    });
}
export function useTheme() {
  const [theme, setTheme] = useState(readTheme);
  return [
    theme,
    (next: ThemePreference) => {
      writeStorage(KEY, next);
      applyTheme(next);
      setTheme(next);
    },
  ] as const;
}
