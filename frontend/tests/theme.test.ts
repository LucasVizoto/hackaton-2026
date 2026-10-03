import { test } from "node:test";
import assert from "node:assert/strict";
import { persistTheme, preferredTheme, readTheme, THEME_STORAGE_KEY } from "../src/app/core/theme-state";

test("manual theme wins over system; missing or invalid preference follows system", () => {
  assert.equal(preferredTheme("light", true), "light");
  assert.equal(preferredTheme("dark", false), "dark");
  assert.equal(preferredTheme(null, true), "dark");
  assert.equal(preferredTheme("invalid", false), "light");
});
test("theme persists only the visual preference and rejects unknown saved values", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  persistTheme(storage, "dark");
  assert.equal(readTheme(storage), "dark");
  assert.deepEqual([...values.keys()], [THEME_STORAGE_KEY]);
  values.set(THEME_STORAGE_KEY, "corrupt");
  assert.equal(readTheme(storage), null);
});
test("blocked storage does not prevent reading system preference or switching theme", () => {
  const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.equal(readTheme(denied), null);
  assert.doesNotThrow(() => persistTheme(denied, "dark"));
  assert.doesNotThrow(() => persistTheme(null, "light"));
});
