import assert from "node:assert/strict";
import test from "node:test";
import { applyPending, reconcilePending, waitLabel, waitLevel, waitMinutes } from "../src/app/core/arrival-wait";
import { Arrival } from "../src/app/core/gate-live";

const base = Date.parse("2026-10-03T10:00:00Z");
function arrival(id: string, minutesAgo: number, decision: Arrival["decision"] = "pending"): Arrival {
  return { id, vehicle_plate: `ABC${id}`, tractor_plate: "", driver_name: "Motorista", invoice_number: "123", created_at: new Date(base - minutesAgo * 60000).toISOString(), decision, decided_at: null, seen_at: null, created_by_name: "portaria" };
}

test("wait time escalates at 15 and 30 minutes", () => {
  assert.equal(waitMinutes(arrival("1", 14).created_at, base), 14);
  assert.equal(waitLevel(14), 0);
  assert.equal(waitLevel(15), 1);
  assert.equal(waitLevel(29), 1);
  assert.equal(waitLevel(30), 2);
  assert.equal(waitMinutes("invalid", base), 0);
  assert.equal(waitMinutes(new Date(base + 60000).toISOString(), base), 0);
});

test("wait label reads naturally", () => {
  assert.equal(waitLabel(0), "agora");
  assert.equal(waitLabel(12), "há 12 min");
  assert.equal(waitLabel(60), "há 1 h");
  assert.equal(waitLabel(75), "há 1 h 15 min");
});

test("pending queue keeps the longest wait first and drops decided arrivals", () => {
  let rows = applyPending([], { event: "created", arrival: arrival("new", 1) });
  rows = applyPending(rows, { event: "created", arrival: arrival("old", 20) });
  assert.deepEqual(rows.map(row => row.id), ["old", "new"]);
  rows = applyPending(rows, { event: "created", arrival: arrival("old", 20) });
  assert.equal(rows.length, 2);
  rows = applyPending(rows, { event: "authorized", arrival: arrival("old", 20, "authorized") });
  assert.deepEqual(rows.map(row => row.id), ["new"]);
  rows = applyPending(rows, { event: "rejected", arrival: arrival("new", 1, "rejected") });
  assert.deepEqual(rows, []);
});

test("paginated snapshot preserves more than 50 arrivals, deduplicates and replays concurrent events", () => {
  const snapshot = Array.from({ length: 105 }, (_, i) => arrival(String(i), i));
  const rows = reconcilePending([...snapshot, snapshot[0]], [
    { event: "created", arrival: arrival("new", 0) },
    { event: "created", arrival: arrival("new", 0) },
    { event: "authorized", arrival: arrival("70", 70, "authorized") },
    { event: "rejected", arrival: arrival("80", 80, "rejected") },
    { event: "created", arrival: arrival("70", 70) },
  ]);
  assert.equal(rows.length, 104);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.ok(rows.some(row => row.id === "new"));
  assert.ok(!rows.some(row => ["70", "80"].includes(row.id)));
  assert.equal(rows[0].id, "104");
});

test("decisions during loading stay final even with out-of-order duplicate creation", () => {
  const item = arrival("1", 20);
  assert.deepEqual(reconcilePending([item], [
    { event: "rejected", arrival: { ...item, decision: "rejected" } },
    { event: "created", arrival: item },
  ]), []);
  assert.deepEqual(reconcilePending([{ ...item, decision: "authorized" }], [{ event: "created", arrival: item }]), []);
});
