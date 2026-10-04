// Replay the pre-migration browser engine in an isolated, private tool directory.
// This tool is excluded from the application bundle and production dependencies.
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const revision = "9abfcc6943346e51d2e80cb4f3b3c1f64b5d4d1f";
const directory = join(root, ".private", "ocr-baseline");
const gitFile = path => execFileSync("git", ["show", `${revision}:${path}`], { cwd: root, encoding: "utf8" });
const lock = JSON.parse(gitFile("frontend/package-lock.json"));
const version = name => lock.packages[`node_modules/${name}`].version;
const dependencies = Object.fromEntries(["tesseract.js", "pdfjs-dist", "esbuild"].map(name => [name, version(name)]));
await mkdir(directory, { recursive: true });
await writeFile(join(directory, "package.json"), JSON.stringify({ private: true, type: "module", dependencies }, null, 2));
const install = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"],
  { cwd: directory, stdio: "inherit", shell: process.platform === "win32" });
if (install.status !== 0) throw new Error("Baseline dependency installation failed.");
const require = createRequire(join(directory, "package.json"));
const esbuild = require("esbuild");
const source = gitFile("frontend/src/app/features/invoice-code.ts");
await esbuild.build({ stdin: { contents: source + `
export async function baseline(file) {
  return /\\.pdf$/i.test(file.name) ? readInvoicePdf(file) : invoiceFieldsFromText(await recognizeImage(file));
}`, loader: "ts", resolveDir: directory }, bundle: true, format: "esm", platform: "browser",
  outfile: join(directory, "baseline.js") });
await writeFile(join(directory, "provenance.json"), JSON.stringify({ source_revision: revision, dependencies }, null, 2));
if (process.argv.includes("--prepare")) {
  console.log("Baseline prepared privately; no documents processed.");
  process.exit(0);
}
const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Comparação de OCR — referência Tesseract</title>
<h1>Registrar a referência Tesseract</h1><p>Selecione o manifesto rotulado e a pasta dos documentos. O resultado será baixado como JSON privado.</p>
<label>Manifesto JSON <input id="manifest" type="file" accept=".json"></label><br>
<label>Pasta dos documentos <input id="documents" type="file" webkitdirectory multiple></label><br>
<button id="run">Processar referência</button><p id="progress" role="status"></p>
<script type="module">
import {baseline} from '/baseline.js';
const manifest = document.querySelector('#manifest'), documents = document.querySelector('#documents');
const button = document.querySelector('#run'), progress = document.querySelector('#progress');
button.addEventListener('click', async () => {
 button.disabled = true;
 try {
  if (!manifest.files[0]) throw new Error('Selecione o manifesto.');
  const input = JSON.parse(await manifest.files[0].text());
  const selected = [...documents.files], rows = [];
  for (const doc of input.documents) {
   const basename = doc.file.replaceAll('\\\\', '/').split('/').pop();
   const matches = selected.filter(file => file.name === basename);
   if (matches.length !== 1) throw new Error('Cada documento deve ter um nome de arquivo único na pasta selecionada.');
   const file = matches[0], started = performance.now();
   progress.textContent = 'Lendo ' + (rows.length + 1) + ' de ' + input.documents.length;
   const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
   const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
   let fields = {number: '', accessKey: ''}, status = 'failed';
   try { fields = await baseline(file); status = fields.number || fields.accessKey ? 'suggested' : 'unreadable'; } catch {}
   rows.push({id: doc.id, sha256, number: fields.number || null, access_key: fields.accessKey || null,
    status, duration_ms: Math.round(performance.now() - started)});
  }
  const blob = new Blob([JSON.stringify({source_revision: '${revision}', documents: rows}, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'ocr-baseline.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  progress.textContent = 'Referência concluída. Guarde o JSON na pasta privada da avaliação.';
 } catch(error) { progress.textContent = error.message; } finally { button.disabled = false; }
});
</script></html>`;
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    let content, type;
    if (path === "/") { content = html; type = "text/html; charset=utf-8"; }
    else if (path === "/baseline.js") { content = await readFile(join(directory, "baseline.js")); type = "text/javascript"; }
    else if (path === "/pdfjs/pdf.worker.min.mjs") { content = await readFile(require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs")); type = "text/javascript"; }
    else if (/^\/pdfjs\/standard_fonts\/[\w.-]+$/.test(path)) {
      content = await readFile(join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts", path.split("/").pop())); type = "application/octet-stream";
    } else { response.writeHead(404).end(); return; }
    response.writeHead(200, {"Content-Type": type, "Cache-Control": "no-store"}).end(content);
  } catch { response.writeHead(500).end("Baseline asset unavailable."); }
});
server.listen(4101, "127.0.0.1", () => console.log("Open http://127.0.0.1:4101 to capture the private baseline. Stop with Ctrl+C."));
