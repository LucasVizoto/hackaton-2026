import assert from "node:assert/strict";
import test from "node:test";
import { filterWorkers, groupEquipment, kindLabel } from "../src/app/core/registry";

const workers = [
  { id: "1", name: "Zé Lima", registration: "0300", contract_type: "EFETIVO", is_active: true },
  { id: "2", name: "João Araújo", registration: "0100", contract_type: "TERCEIRIZADO", is_active: true },
  { id: "3", name: "Ana Souza", registration: "0200", is_active: false },
];

test("people list searches name or registration ignoring accents and sorts by name", () => {
  assert.deepEqual(filterWorkers(workers, "", "active", "").map(w => w.id), ["2", "1"]);
  assert.deepEqual(filterWorkers(workers, "joao", "all", "").map(w => w.id), ["2"]);
  assert.deepEqual(filterWorkers(workers, "0200", "all", "").map(w => w.id), ["3"]);
  assert.deepEqual(filterWorkers(workers, "", "inactive", "").map(w => w.id), ["3"]);
});

test("missing contract type counts as annual contract", () => {
  assert.deepEqual(filterWorkers(workers, "", "all", "EFETIVO").map(w => w.id), ["3", "1"]);
  assert.deepEqual(filterWorkers(workers, "", "all", "TERCEIRIZADO").map(w => w.id), ["2"]);
});

test("equipment is grouped where it can be used: shared first, then each warehouse", () => {
  const warehouses = [{ id: "a", name: "Adubo" }, { id: "i", name: "Insumos" }];
  const items = [
    { id: "e1", name: "Empilhadeira 1", kind: "EMPILHADEIRA_GAS", warehouse: "i", mobile: false },
    { id: "e2", name: "Paleteira", kind: "PALETEIRA_MANUAL", warehouse: "a", mobile: true },
    { id: "e3", name: "Carrinho", kind: "CARRINHO", warehouse: null, mobile: false },
    { id: "e4", name: "Trator velho", kind: "TRATOR", warehouse: "a", mobile: false, is_active: false },
  ];
  const all = groupEquipment(items, warehouses, { warehouse: "", kind: "", active: "active" });
  assert.deepEqual(all.map(g => [g.title, g.items.map(i => i.id)]), [["Circulam entre armazéns", ["e3", "e2"]], ["Insumos", ["e1"]]]);
  const adubo = groupEquipment(items, warehouses, { warehouse: "a", kind: "", active: "all" });
  assert.deepEqual(adubo.map(g => [g.key, g.items.map(i => i.id)]), [["shared", ["e3", "e2"]], ["a", ["e4"]]]);
  assert.deepEqual(groupEquipment(items, warehouses, { warehouse: "", kind: "EMPILHADEIRA_GAS", active: "all" }).map(g => g.key), ["i"]);
  assert.equal(kindLabel(""), "Tipo não informado");
});
