import assert from "node:assert/strict";
import { test } from "node:test";
import { bulletinSheet, type BulletinPrintCalculation, type BulletinPrintInput } from "../src/app/features/bulletin-print";
import { isHalfDay, lineAmount, lineQuantity, sumDecimals } from "../src/app/core/money-line";

test("o exemplo do Adubo soma as três modalidades e multiplica pela tarifa sem arredondar no meio", () => {
  assert.equal(lineQuantity("2378", "400", "0"), "2778");
  assert.equal(lineAmount("2778", "0.3224"), "895.6272");
  assert.equal(lineAmount(lineQuantity("30", "0", "0"), "0.3224"), "9.672");
  assert.equal(lineAmount(lineQuantity("0", "40", "0"), "0.3224"), "12.896");
  assert.equal(sumDecimals(["895.6272", "9.672", "12.896"]), "918.1952");
  assert.equal(lineQuantity("2378", "400,5", ""), null);
  assert.equal(isHalfDay("0.50"), true);
  assert.equal(isHalfDay("1.0"), false);
});

function calculation(half: boolean): BulletinPrintCalculation {
  return half
    ? {
        floor_per_day: "90.1731",
        production_per_equivalent_day: "87.447161904",
        display: { production: "918.20", total_payable: "946.82", supplement: "28.62" },
        resumo: {
          producaoTotal: "918.20",
          diariasEquivalentes: "10.5",
          valorPorDiariaApurado: "87.45",
          totalAPagar: "946.82",
          complemento: "28.62",
        },
      }
    : {
        floor_per_day: "90.1731",
        production_per_equivalent_day: "83.472290909",
        display: { production: "918.20", total_payable: "991.90", supplement: "73.71" },
        resumo: {
          producaoTotal: "918.20",
          diariasEquivalentes: "11",
          valorPorDiariaApurado: "83.47",
          totalAPagar: "991.90",
          complemento: "73.71",
        },
      };
}

function sheet(half = false): BulletinPrintInput {
  return {
    referenceDate: "2025-11-17",
    warehouses: ["Adubo"],
    revision: half ? null : 3,
    provisional: false,
    closed: !half,
    lines: [
      { warehouse: "Adubo", label: "Fertilizantes", unloading: "2378", removal: "400", transfer: "0", price: "0.3224" },
      { warehouse: "Adubo", label: "Agroquímico", unloading: "30", removal: "0", transfer: "0", price: "0.3224" },
      { warehouse: "Adubo", label: "Serviços diversos", unloading: "0", removal: "40", transfer: "0", price: "0.3224" },
    ],
    calculation: calculation(half),
    people: [
      { registration: "158", name: "Chapa Oito", fraction: "1.0" },
      { registration: "79", name: "Chapa Meia", fraction: half ? "0.5" : "1.0" },
    ],
    allocations: half
      ? []
      : [{ registration: "158", name: "Chapa Oito", fraction: "1.0", production: "83.47", supplement: "6.70", total: "90.17" }],
  };
}

function text(input: BulletinPrintInput): string {
  return JSON.stringify(bulletinSheet(input)).replaceAll("\u00a0", " ");
}

test("o PDF do exemplo oficial leva as cifras do piso e a linha de fertilizante", () => {
  const printed = text(sheet());
  assert.match(printed, /BOLETIM DIÁRIO DE SERVIÇOS DOS ENSACADORES/);
  assert.match(printed, /17\/11\/2025/);
  assert.match(printed, /Boletim fechado/);
  assert.match(printed, /2\.778/);
  assert.match(printed, /895,6272/);
  assert.match(printed, /R\$ 918,20/);
  assert.match(printed, /R\$ 991,90/);
  assert.match(printed, /R\$ 73,71/);
  assert.match(printed, /90,1731/);
  assert.match(printed, /158/);
  assert.match(printed, /Diária completa/);
  assert.match(printed, /Parcelas por pessoa/);
});

test("meia diária e prévia estimada mudam o texto impresso", () => {
  const estimated: BulletinPrintInput = { ...sheet(true), provisional: true, allocations: [{ registration: "79", name: "Chapa Meia", fraction: "0.5", production: "1", supplement: "1", total: "1" }] };
  const printed = text(estimated);
  assert.match(printed, /10,5/);
  assert.match(printed, /R\$ 946,82/);
  assert.match(printed, /R\$ 28,62/);
  assert.match(printed, /Meia diária/);
  assert.match(printed, /não autoriza pagamento/);
  assert.doesNotMatch(printed, /Parcelas por pessoa/);
});
