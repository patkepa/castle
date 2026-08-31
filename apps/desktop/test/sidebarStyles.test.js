import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("compact sidebar menus fit inside the icon rail", () => {
  assert.match(
    styles,
    /\.app-sidebar\.collapsed\s+\.sidebar-menu\s*{[^}]*min-width:\s*0;[^}]*width:\s*100%;[^}]*}/s,
  );
});
