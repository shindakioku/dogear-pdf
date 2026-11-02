// Builds dist/ from src/ plus a pinned, checksum-verified official PDF.js release.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PDFJS_VERSION = "6.5.438";
const PDFJS_SHA256 = "fcbe9ba21d9911843e3502adc178a7f549a524a4055f887bedc942e5490c6ba1";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, ".cache");
const dist = join(root, "dist");
const zipPath = join(cacheDir, `pdfjs-${PDFJS_VERSION}-dist.zip`);

mkdirSync(cacheDir, { recursive: true });
if (!existsSync(zipPath)) {
  const url = `https://github.com/mozilla/pdf.js/releases/download/v${PDFJS_VERSION}/pdfjs-${PDFJS_VERSION}-dist.zip`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
}
const actual = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
if (actual !== PDFJS_SHA256) {
  rmSync(zipPath);
  throw new Error(`PDF.js checksum mismatch: ${actual}`);
}

rmSync(dist, { recursive: true, force: true });
cpSync(join(root, "src"), dist, { recursive: true });

const tmp = mkdtempSync(join(cacheDir, "unzip-"));
execFileSync("unzip", ["-q", zipPath, "-d", tmp]);
cpSync(tmp, join(dist, "pdfjs"), {
  recursive: true,
  filter: src => !/\.map$|compressed\.tracemonkey-pldi-09\.pdf$|debugger\.(mjs|css)$/.test(src),
});
rmSync(tmp, { recursive: true });

// Each patch must match exactly once, so a PDF.js upgrade fails loudly rather than silently.
function patch(file, search, replacement) {
  const text = readFileSync(file, "utf8");
  if (text.split(search).length !== 2) throw new Error(`Patch target not unique in ${file}: ${search}`);
  writeFileSync(file, text.replace(search, () => replacement));
}
const viewerHtml = join(dist, "pdfjs/web/viewer.html");
patch(viewerHtml, '<script src="../build/pdf.mjs" type="module"></script>',
  '<link rel="stylesheet" href="../../viewer/viewer.css" />\n<script src="../../viewer/main.js" type="module"></script>\n<script src="../build/pdf.mjs" type="module"></script>');
// connect-src * does not cover file:, which local PDFs need.
patch(viewerHtml, "connect-src * blob: data:;", "connect-src * blob: data: file:;");

console.log(`Built ${dist}`);
