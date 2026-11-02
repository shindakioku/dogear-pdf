// Renders the Chrome Web Store screenshots and promo tile into store/. Run manually after `npm run build`.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

const paragraph = "The keeper climbed the stairs before dawn, as he had every morning for eleven years. "
  + "He trimmed the wick, wiped the salt from the glass and wrote the weather in his log. "
  + "Nothing in the entry would tell a later reader how the sea had looked that day, or that he had stopped to watch it. ";
const chapter = n => `<section style="break-after:page"><h1 style="font-size:30px;margin:90px 0 40px">Chapter ${n}</h1>${
  `<p style="font-size:16px;line-height:1.7;text-align:justify">${paragraph.repeat(3)}</p>`.repeat(7)}</section>`;

const dir = mkdtempSync(join(tmpdir(), "dogear-assets-"));
const browser = await puppeteer.launch({
  enableExtensions: true,
  pipe: true,
  args: [`--load-extension=${join(process.cwd(), "dist")}`, `--disable-extensions-except=${join(process.cwd(), "dist")}`, "--lang=en-US"],
  defaultViewport: { width: 1280, height: 800 },
  userDataDir: join(dir, "profile"),
});
const worker = await browser.waitForTarget(t => t.type() === "service_worker" && t.url().endsWith("/background.js"));
const extensionId = new URL(worker.url()).host;

const authoring = await browser.newPage();
await authoring.setContent(`<!doctype html><title>The Lighthouse Log</title><body style="font-family:Georgia,serif;margin:0">${
  [1, 2, 3, 4, 5, 6].map(chapter).join("")}</body>`);
const pdf = Buffer.from(await authoring.pdf({ format: "A5", margin: { top: "50px", bottom: "50px", left: "50px", right: "50px" } }));
await authoring.close();

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/pdf" });
  response.end(pdf);
}).listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));

const settle = (ms = 700) => new Promise(resolve => setTimeout(resolve, ms));

const reader = await browser.newPage();
await reader.goto(`http://127.0.0.1:${server.address().port}/the-lighthouse-log.pdf`);
await reader.waitForFunction(() => window.PDFViewerApplication?.isInitialViewSet);
await reader.evaluate(() => { PDFViewerApplication.page = 7; });
await settle();
await reader.screenshot({ path: "store/screenshots/1-reader.png" });
await reader.keyboard.press("t");
await reader.mouse.move(640, 400);
await settle();
await reader.screenshot({ path: "store/screenshots/3-focus.png" });
await reader.keyboard.press("t");
await settle();
const readerImage = readFileSync("store/screenshots/1-reader.png").toString("base64");

const popup = await browser.newPage();
await popup.setViewport({ width: 384, height: 520, deviceScaleFactor: 1 });
await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
await popup.evaluate(async () => {
  const now = Date.now();
  const hours = 3600000;
  const books = [
    ["The Lighthouse Log", 41, 96, 0.1],
    ["Field Notes on Tidal Rivers", 212, 340, 3],
    ["A Short History of Maps", 188, 188, 26],
    ["Quarterly Report, Q3", 4, 18, 50],
    ["Sourdough for Beginners", 67, 142, 120],
    ["Introduction to Sailing", 15, 230, 240],
  ];
  await chrome.storage.local.clear();
  await chrome.storage.local.set(Object.fromEntries(books.map(([title, page, pages, age], i) => [
    `pos:demo${i}`,
    { hash: `page=${page}`, page, pages, title, url: `https://example.com/${i}.pdf`, updatedAt: now - age * hours },
  ])));
});
await popup.reload();
await settle();
await popup.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await settle(200);
const popupImage = Buffer.from(await popup.screenshot({ clip: { x: 0, y: 0, width: 384, height: 520 } })).toString("base64");
await popup.close();

const composer = await browser.newPage();
await composer.setViewport({ width: 1280, height: 800 });
await composer.setContent(`<!doctype html><body style="margin:0;position:relative">
  <img src="data:image/png;base64,${readerImage}" style="display:block;filter:brightness(.75)">
  <img src="data:image/png;base64,${popupImage}" style="position:absolute;top:44px;right:40px;border-radius:12px;box-shadow:0 12px 40px #000a">
</body>`);
await settle(200);
await composer.screenshot({ path: "store/screenshots/2-history.png" });

const icon = readFileSync("assets/icon.svg", "utf8");
await composer.setViewport({ width: 440, height: 280 });
await composer.setContent(`<!doctype html><body style="margin:0;width:440px;height:280px;background:#2b2b33;color:#f7f3e8;display:flex;align-items:center;gap:26px;padding:0 34px;box-sizing:border-box;font-family:Georgia,serif">
  <div style="width:112px;flex:none">${icon}</div>
  <div><div style="font-size:42px;font-weight:bold">Dogear</div><div style="font-size:19px;line-height:1.35;margin-top:8px;font-family:system-ui,sans-serif">Every PDF opens where you left off.</div></div>
</body>`);
await settle(200);
await composer.screenshot({ path: "store/promo-440x280.png" });

await browser.close();
server.close();
rmSync(dir, { recursive: true, force: true });
