// Zips dist/ for upload to the Chrome Web Store.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const { version } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));

const files = {};
for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = join(entry.parentPath, entry.name);
  files[relative(dist, path)] = readFileSync(path);
}

const output = join(root, `dogear-${version}.zip`);
writeFileSync(output, zipSync(files));
console.log(`Packaged ${output}`);
