import { isHalfDay, lineAmount, lineQuantity } from "../core/money-line";
import { decimal } from "../core/presentation";

export interface BulletinPrintLine {
  warehouse: string;
  label: string;
  unloading: string;
  removal: string;
  transfer: string;
  price: string;
}

export interface BulletinPrintPerson {
  registration: string;
  name: string;
  fraction: string;
}

export interface BulletinPrintAllocation {
  registration: string;
  name: string;
  fraction: string;
  production: string;
  supplement: string;
  total: string;
}

export interface BulletinPrintCalculation {
  floor_per_day: string;
  equivalent_days?: string;
  production_per_equivalent_day: string | null;
  display: { production: string; total_payable: string; supplement: string };
  resumo?: {
    producaoTotal: string;
    diariasEquivalentes: string;
    valorPorDiariaApurado: string | null;
    totalAPagar: string;
    complemento: string;
  } | null;
}

export interface BulletinPrintInput {
  referenceDate: string;
  warehouses: string[];
  revision: number | null;
  provisional: boolean;
  closed: boolean;
  lines: BulletinPrintLine[];
  calculation: BulletinPrintCalculation;
  people: BulletinPrintPerson[];
  allocations: BulletinPrintAllocation[];
}

type Cell = { text: string; fontSize: number; alignment: "left" | "right" | "center"; bold?: boolean };

function cell(text: string, align: Cell["alignment"] = "right", bold = false): Cell {
  return { text, fontSize: 8, alignment: align, bold };
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

function shown(value: string | null, digits = 4): string {
  if (value === null) return "—";
  const formatted = decimal(value, digits);
  return formatted === "Não disponível" ? "—" : formatted;
}

function moneyOf(value: string | null | undefined): string {
  if (value == null || value === "") return "Não disponível";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Não disponível";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(number);
}

function groups(lines: BulletinPrintLine[]): { warehouse: string; lines: BulletinPrintLine[] }[] {
  const order: string[] = [];
  const map = new Map<string, BulletinPrintLine[]>();
  for (const line of lines) {
    const key = line.warehouse || "Produção";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)?.push(line);
  }
  return order.map((warehouse) => ({ warehouse, lines: map.get(warehouse) ?? [] }));
}

export function bulletinSheet(input: BulletinPrintInput) {
  const resumo = input.calculation.resumo;
  const state = input.provisional
    ? "Prévia estimada — não autoriza pagamento"
    : input.closed
      ? "Boletim fechado"
      : "Prévia";
  const places = input.warehouses.filter(Boolean).join(", ") || "Nenhum armazém";
  const revision = input.revision == null ? "" : ` · Revisão ${input.revision}`;
  const production = resumo?.producaoTotal ?? input.calculation.display.production;
  const payable = resumo?.totalAPagar ?? input.calculation.display.total_payable;
  const supplement = resumo?.complemento ?? input.calculation.display.supplement;
  const perDay = resumo?.valorPorDiariaApurado ?? input.calculation.production_per_equivalent_day;
  const equivalents = resumo?.diariasEquivalentes ?? input.calculation.equivalent_days ?? null;
  const lineHeader = ["Categoria", "Descarga", "Remoção", "Transferência", "Qtd. total", "Tarifa", "Total R$"].map((label, index) =>
    cell(label, index === 0 ? "left" : "right", true),
  );
  const content: object[] = [
    { text: "BOLETIM DIÁRIO DE SERVIÇOS DOS ENSACADORES", alignment: "center", bold: true, fontSize: 14, margin: [0, 0, 0, 6] },
    { text: `${formatDay(input.referenceDate)} · ${places} · ${state}${revision}`, fontSize: 9, margin: [0, 0, 0, 8] },
  ];
  for (const group of groups(input.lines)) {
    content.push({ text: group.warehouse, bold: true, fontSize: 11, margin: [0, 6, 0, 4] });
    content.push({
      table: {
        headerRows: 1,
        widths: ["*", 52, 52, 62, 52, 48, 58],
        dontBreakRows: true,
        body: [
          lineHeader,
          ...group.lines.map((line) => {
            const quantity = lineQuantity(line.unloading, line.removal, line.transfer);
            return [
              cell(line.label, "left"),
              cell(shown(line.unloading, 4)),
              cell(shown(line.removal, 4)),
              cell(shown(line.transfer, 4)),
              cell(shown(quantity, 4)),
              cell(shown(line.price, 4)),
              cell(shown(lineAmount(quantity, line.price), 4)),
            ];
          }),
        ],
      },
      layout: "lightHorizontalLines",
    });
  }
  content.push({ text: "Apuração", bold: true, fontSize: 11, margin: [0, 12, 0, 4] });
  content.push({
    table: {
      headerRows: 1,
      widths: ["*", "*", "*", "*", "*", "*"],
      body: [
        ["Produção", "Diárias equivalentes", "Valor por diária", "Piso por diária", "Total a pagar", "Complemento"].map((label) => cell(label, "right", true)),
        [
          cell(moneyOf(production)),
          cell(shown(equivalents, 1)),
          cell(moneyOf(perDay)),
          cell(shown(input.calculation.floor_per_day, 4)),
          cell(moneyOf(payable), "right", true),
          cell(moneyOf(supplement)),
        ],
      ],
    },
    layout: "lightHorizontalLines",
  });
  content.push({ text: "Equipe", bold: true, fontSize: 11, margin: [0, 12, 0, 4] });
  const teamHeader = [cell("Nome", "left", true), cell("Matrícula", "right", true), cell("Jornada", "left", true)];
  const teamRow = (person: BulletinPrintPerson) => [
    cell(person.name || "—", "left"),
    cell(person.registration || "—"),
    cell(isHalfDay(person.fraction) ? "Meia diária" : "Diária completa", "left"),
  ];
  if (!input.people.length) content.push({ text: "Nenhuma pessoa lançada.", fontSize: 9 });
  else {
    const left = input.people.slice(0, 10);
    const right = input.people.slice(10, 20);
    content.push({
      columns: [left, right].filter((side) => side.length).map((side) => ({
        width: "*",
        table: { headerRows: 1, widths: ["*", 48, 70], body: [teamHeader, ...side.map(teamRow)] },
        layout: "lightHorizontalLines",
      })),
      columnGap: 16,
    });
  }
  if (!input.provisional && input.allocations.length) {
    content.push({ text: "Parcelas por pessoa", bold: true, fontSize: 11, margin: [0, 12, 0, 4] });
    content.push({
      table: {
        headerRows: 1,
        widths: ["*", 60, 70, 70, 70],
        body: [
          ["Nome", "Fração", "Produção", "Complemento", "Total"].map((label, index) => cell(label, index === 0 ? "left" : "right", true)),
          ...input.allocations.map((item) => [
            cell(item.name || item.registration || "—", "left"),
            cell(shown(item.fraction, 1)),
            cell(moneyOf(item.production)),
            cell(moneyOf(item.supplement)),
            cell(moneyOf(item.total), "right", true),
          ]),
        ],
      },
      layout: "lightHorizontalLines",
    });
  }
  content.push({
    text: "O total a pagar é o maior valor entre a produção e o piso coletivo. Encargos trabalhistas não entram neste boletim.",
    fontSize: 8,
    margin: [0, 10, 0, 0],
  });
  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [28, 28, 28, 36],
    info: { title: `Boletim diário ${formatDay(input.referenceDate)}` },
    content,
  };
}

let pdfMakeReady: Promise<typeof import("pdfmake/build/pdfmake").default> | null = null;

function loadPdfMake() {
  pdfMakeReady ??= (async () => {
    const [pdfMakeModule, vfsModule] = await Promise.all([
      import("pdfmake/build/pdfmake"),
      import("pdfmake/build/vfs_fonts"),
    ]);
    const pdfMake = pdfMakeModule.default;
    pdfMake.addVirtualFileSystem(vfsModule.default);
    return pdfMake;
  })();
  return pdfMakeReady;
}

export async function openBulletinPdf(
  input: BulletinPrintInput,
  preview: Window | null,
  saveNative?: (blob: Blob, filename: string) => Promise<unknown>,
) {
  const pdfMake = await loadPdfMake();
  const filename = `boletim-${input.referenceDate}.pdf`;
  const document = pdfMake.createPdf(bulletinSheet(input));
  if (saveNative) await saveNative(await document.getBlob(), filename);
  else if (preview && !preview.closed) await document.open(preview);
  else await document.download(filename);
}
