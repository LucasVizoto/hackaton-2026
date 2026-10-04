import type { CatalogEntry } from "./catalog";

/** Mesmos códigos de catalog.models.CONTRACT_TYPES e EQUIPMENT_KINDS. */
export const CONTRACT_LABELS: Record<string, string> = { EFETIVO: "Contrato anual", TERCEIRIZADO: "Terceirizado" };
export const EQUIPMENT_KINDS: { code: string; label: string }[] = [
  { code: "EMPILHADEIRA_GAS", label: "Empilhadeira a gás" },
  { code: "EMPILHADEIRA_ELETRICA", label: "Empilhadeira elétrica / retrátil" },
  { code: "TRANSPALETEIRA_ELETRICA", label: "Transpaleteira elétrica" },
  { code: "PALETEIRA_ELETRICA", label: "Paleteira elétrica" },
  { code: "PALETEIRA_MANUAL", label: "Paleteira manual" },
  { code: "CARRINHO", label: "Carrinho de mão" },
  { code: "TRATOR", label: "Trator" },
  { code: "OUTRO", label: "Outro" },
];
export function kindLabel(code?: string) { return EQUIPMENT_KINDS.find(kind => kind.code === code)?.label ?? "Tipo não informado"; }

export type ActiveFilter = "active" | "inactive" | "all";

function normalize(value: string) { return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
function matchesActive(entry: CatalogEntry, active: ActiveFilter) {
  return active === "all" || (active === "active") === (entry.is_active !== false);
}

export function filterWorkers(workers: readonly CatalogEntry[], query: string, active: ActiveFilter, contract: string): CatalogEntry[] {
  const term = normalize(query);
  return workers
    .filter(w => matchesActive(w, active))
    .filter(w => !contract || (w.contract_type || "EFETIVO") === contract)
    .filter(w => !term || normalize(`${w.name} ${w.registration ?? ""}`).includes(term))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export interface EquipmentGroup { key: string; title: string; items: CatalogEntry[]; }

/** Agrupa pelo lugar onde o equipamento pode ser usado: os que circulam vêm primeiro, depois cada armazém. */
export function groupEquipment(items: readonly CatalogEntry[], warehouses: readonly CatalogEntry[], filters: { warehouse: string; kind: string; active: ActiveFilter }): EquipmentGroup[] {
  const visible = items
    .filter(item => matchesActive(item, filters.active))
    .filter(item => !filters.kind || (item.kind ?? "") === filters.kind)
    .filter(item => !filters.warehouse || item.mobile || !item.warehouse || item.warehouse === filters.warehouse)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const groups: EquipmentGroup[] = [];
  const shared = visible.filter(item => item.mobile || !item.warehouse);
  if (shared.length) groups.push({ key: "shared", title: "Circulam entre armazéns", items: shared });
  for (const warehouse of warehouses) {
    const own = visible.filter(item => !item.mobile && item.warehouse === warehouse.id);
    if (own.length) groups.push({ key: warehouse.id, title: warehouse.name, items: own });
  }
  return groups;
}
