export interface ReceivingReportRow {
  supplier: string;
  product: string;
  quantity: string;
  invoice: string;
  value: string;
  date: string;
}

const rowsPerPage = 22;
const widths = [104, 92, 70, 93, 99, 102, 107, 112];

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

function headerCell(text: string) {
  return { text, bold: true, fontSize: 9, alignment: "center" as const, margin: [0, 10, 0, 0] };
}

function dataCell(text: string) {
  return { text, fontSize: 8, alignment: "center" as const };
}

function emptyRow() {
  return widths.map(() => dataCell(""));
}

export async function openReceivingReport(rows: ReceivingReportRow[], day: string, preview: Window | null) {
  const pdfMake = await loadPdfMake();
  const filled = rows.map((row) => [
    dataCell(row.supplier),
    dataCell(row.product),
    dataCell(row.quantity),
    dataCell(row.invoice),
    dataCell(row.value),
    dataCell(row.date),
    dataCell(""),
    dataCell(""),
  ]);
  const missing = (rowsPerPage - (filled.length % rowsPerPage)) % rowsPerPage;
  const body = [
    [
      {
        text: "RELAÇÃO DE RECEBIMENTO DE MERCADORIA",
        colSpan: 8,
        alignment: "center" as const,
        bold: true,
        fontSize: 14,
        margin: [0, 16, 0, 0],
      },
      {},
      {},
      {},
      {},
      {},
      {},
      {},
    ],
    [
      headerCell("Fornecedor"),
      headerCell("Produto"),
      headerCell("QTD"),
      headerCell("N° N.F"),
      headerCell("Valor N.F"),
      headerCell("Data"),
      headerCell("Recebedor\nMercadoria"),
      headerCell("Recebedor Nota.\nFiscal"),
    ],
    ...filled,
    ...Array.from({ length: missing }, emptyRow),
  ];
  const filename = `relacao-recebimento-${day.replaceAll("/", "-")}.pdf`;
  const document = pdfMake.createPdf({
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [31, 49, 32, 59],
    info: { title: `Relação de recebimento ${day}` },
    content: [
      {
        table: {
          headerRows: 2,
          widths,
          heights: (row: number) => (row === 0 ? 40 : row === 1 ? 32 : 14),
          dontBreakRows: true,
          body,
        },
        layout: {
          hLineWidth: () => 1,
          vLineWidth: () => 1,
          hLineColor: () => "#000000",
          vLineColor: () => "#000000",
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
      },
    ],
  });
  if (preview && !preview.closed) await document.open(preview);
  else await document.download(filename);
}
