declare module "pdfmake/build/pdfmake" {
  interface PdfMake {
    addVirtualFileSystem(vfs: Record<string, string>): void;
    createPdf(definition: object): {
      getBlob(): Promise<Blob>;
      open(win?: Window | null): Promise<void>;
      download(filename?: string): Promise<void>;
    };
  }
  const pdfMake: PdfMake;
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const vfs: Record<string, string>;
  export default vfs;
}
