import assert from "node:assert/strict";
import test from "node:test";
import { crewCoverage, groupByStage, nextStep, shiftDate, UnloadItem, warehousesOf } from "../src/app/core/unloading";

function item(changes: Partial<UnloadItem> = {}): UnloadItem {
  return {
    visit: "v1", appointment: "a1", revision: 3, sequence: 1, stages: 1, warehouse: "w1", warehouse_name: "Insumos",
    slot: "08:00", supplier: "Fornecedor", vehicle_plate: "ABC1D23", packaging: "paletizada", packaging_label: "Paletizada",
    stage: "ready", waiting_reason: "", checked_in_at: null, checked_out_at: null, worker_count: null,
    needed_chapas: 4, needed_gas_forklifts: 1, estimated: false, crew: [], equipment: [],
    actions: { "check-in": { allowed: true, reason: "" }, "check-out": { allowed: false, reason: "Exige check-in desta etapa." } },
    ...changes,
  };
}
const person = (name: string) => ({ id: name, name, registration: name });

test("next step leads the warehouse through crew, entry and exit; readers only view", () => {
  assert.equal(nextStep(item(), true).step, "crew");
  assert.equal(nextStep(item({ crew: [person("Ana")] }), true).step, "check-in");
  assert.equal(nextStep(item({ stage: "waiting", crew: [person("Ana")], actions: {} }), true).label, "Ajustar equipe");
  const running = item({ stage: "running", actions: { "check-out": { allowed: true, reason: "" } } });
  assert.equal(nextStep(running, true).step, "check-out");
  assert.equal(nextStep({ ...running, actions: { "check-out": { allowed: false, reason: "Confira os itens" } } }, true).step, "view");
  assert.equal(nextStep(item({ stage: "done" }), true).step, "view");
  assert.equal(nextStep(item({ crew: [person("Ana")] }), false).step, "view");
});

test("crew coverage compares with the suggestion and uses the confirmed count once done", () => {
  assert.deepEqual(crewCoverage(item()), { text: "Sem equipe · sugerido 4", tone: "none" });
  assert.deepEqual(crewCoverage(item({ crew: [person("Ana")] })), { text: "1 chapa de 4 sugeridos", tone: "short" });
  assert.equal(crewCoverage(item({ crew: ["A", "B", "C", "D"].map(person) })).tone, "ok");
  assert.deepEqual(crewCoverage(item({ stage: "done", worker_count: 3, crew: [person("Ana")] })), { text: "3 chapas na saída", tone: "ok" });
});

test("groups keep the operational order and warehouses list only the day's destinations", () => {
  const groups = groupByStage([item({ visit: "d", stage: "done" }), item({ visit: "r", stage: "running" }), item({ visit: "w", stage: "waiting", warehouse: "w2", warehouse_name: "Adubo" })]);
  assert.deepEqual(groups.map(g => [g.code, g.items.map(i => i.visit)]), [["running", ["r"]], ["ready", []], ["waiting", ["w"]], ["done", ["d"]]]);
  assert.deepEqual(warehousesOf([item(), item({ warehouse: "w2", warehouse_name: "Adubo" }), item()]).map(w => w.name), ["Adubo", "Insumos"]);
});

test("day navigation crosses month boundaries", () => {
  assert.equal(shiftDate("2026-10-31", 1), "2026-11-01");
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
});
