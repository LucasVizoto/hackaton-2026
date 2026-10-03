import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chartDateLabel,
  chartItems,
  operationalMetric,
} from "../src/app/core/chart-data";

test("charts preserve API counts, ordering and measured zero", () => {
  assert.deepEqual(chartItems([
    { date: "2026-10-03", count: 2 },
    { date: "2026-10-04", count: 0 },
  ], "date", chartDateLabel), [
    { label: "03/10/2026", value: 2 },
    { label: "04/10/2026", value: 0 },
  ]);
});

test("absent or invalid chart measurements do not become zero", () => {
  assert.deepEqual(chartItems(null, "reason"), []);
  assert.deepEqual(chartItems(undefined, "reason"), []);
  assert.deepEqual(chartItems([
    null, [], "unknown", { reason: "other", count: null },
    { reason: "other", count: "2" }, { reason: "other", count: false },
    { reason: "other", count: -1 }, { reason: "other", count: Infinity },
    { reason: "", count: 2 },
  ], "reason"), []);
});

test("warehouse charts retain destination counts without deduplicating global trucks", () => {
  assert.deepEqual(chartItems([
    { warehouse_name: "Armazém 1", count: 1 },
    { warehouse_name: "Armazém 2", count: 1 },
  ], "warehouse_name"), [
    { label: "Armazém 1", value: 1 },
    { label: "Armazém 2", value: 1 },
  ]);
});

test("reason chart labels are translated while original values remain intact", () => {
  const rows = [{ reason: "other", count: 3 }];
  assert.deepEqual(chartItems(rows, "reason", () => "Outro"), [
    { label: "Outro", value: 3 },
  ]);
  assert.deepEqual(rows, [{ reason: "other", count: 3 }]);
});

test("unavailable operational metrics stay unavailable and measured zero survives", () => {
  assert.equal(operationalMetric(null, "received_loads"), null);
  assert.equal(operationalMetric({}, "received_loads"), null);
  assert.equal(operationalMetric({ received_loads: 0 }, "received_loads"), 0);
  assert.equal(operationalMetric({ received_loads: null, summary: { received_loads: 5 } }, "received_loads"), null);
  assert.equal(operationalMetric({ summary: { average_wait_minutes: 4.5 } }, "average_wait_minutes"), 4.5);
});
