// Renders assets/icon.svg to src/icons/*.png. Run manually; the PNGs are committed.
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer";

const svg = readFileSync("assets/icon.svg", "utf8");
const browser = await puppeteer.launch();
const page = await browser.newPage();
for (const size of [16, 48, 128]) {
  await page.setViewport({ width: size, height: size });
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${svg}</body>`);
  await page.screenshot({ path: `src/icons/${size}.png`, omitBackground: true });
}
await browser.close();
