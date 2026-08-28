import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  addMonths,
  addYears,
  formatLocalDateKey,
  getIsoWeek,
  parseLocalDateKey,
  startOfWeek,
} from "../src/lib/calendarDate.ts";

test("parses and formats strict local calendar dates", () => {
  assert.equal(formatLocalDateKey(new Date(2026, 6, 31)), "2026-07-31");
  assert.equal(parseLocalDateKey("2026-02-29"), null);
  assert.equal(formatLocalDateKey(parseLocalDateKey("2024-02-29")), "2024-02-29");
});

test("moves across calendar boundaries without mutating the source date", () => {
  const source = new Date(2024, 0, 31, 12);
  assert.equal(formatLocalDateKey(addDays(source, 1)), "2024-02-01");
  assert.equal(formatLocalDateKey(addMonths(source, 1)), "2024-02-29");
  assert.equal(formatLocalDateKey(addYears(new Date(2024, 1, 29), 1)), "2025-02-28");
  assert.equal(formatLocalDateKey(source), "2024-01-31");
});

test("uses Monday-based weeks and ISO week numbers", () => {
  assert.equal(formatLocalDateKey(startOfWeek(new Date(2026, 7, 1))), "2026-07-27");
  assert.equal(getIsoWeek(new Date(2026, 0, 1)), 1);
  assert.equal(getIsoWeek(new Date(2021, 0, 1)), 53);
});
