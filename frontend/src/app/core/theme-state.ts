export type ThemeMode = "light" | "dark";
export const THEME_STORAGE_KEY = "cocapec.visual-theme";

export function preferredTheme(saved: string | null, systemDark: boolean): ThemeMode {
  return saved === "light" || saved === "dark"
    ? saved
    : systemDark ? "dark" : "light";
}

export function readTheme(storage: Pick<Storage, "getItem"> | null): ThemeMode | null {
  try {
    const saved = storage?.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

export function persistTheme(storage: Pick<Storage, "setItem"> | null, mode: ThemeMode): void {
  try { storage?.setItem(THEME_STORAGE_KEY, mode); } catch { /* Theme still works when storage is unavailable. */ }
}
