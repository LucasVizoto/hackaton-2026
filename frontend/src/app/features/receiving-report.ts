export interface ReceivingReportRow {
  supplier: string;
  product: string;
  quantity: string;
  invoice: string;
  value: string;
  date: string;
}

const rowsPerPage = 18;
const widths = [100, 120, 48, 62, 80, 62, "*", "*"];

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

export async function openReceivingReport(rows: ReceivingReportRow[], day: string, preview: Window | null, origin: string, saveNative?: (blob:Blob,filename:string)=>Promise<unknown>) {
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
      headerCell("Valor dos itens\n(estimado)"),
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
    footer: (page:number,total:number) => ({text:`${day} · ${origin} · Página ${page} de ${total}`,fontSize:8,alignment:"center",margin:[0,15,0,0]}),
    content: [
      {text:`Dia completo: ${day} · Origem: ${origin}`,fontSize:9,margin:[0,0,0,4]},
      {text:'Inclui recebimentos concluídos; exclui rejeitados, cancelados e não recebidos. Filtros de situação e armazém da tela não alteram esta relação.',fontSize:8,margin:[0,0,0,4]},
      {text:'O valor é a soma estimada dos itens declarados de cada nota, repetida por produto; não equivale ao total fiscal e não deve ser somado entre linhas.',fontSize:8,margin:[0,0,0,8]},
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
  if(saveNative) await saveNative(await document.getBlob(),filename);
  else if (preview && !preview.closed) await document.open(preview);
  else await document.download(filename);
}
