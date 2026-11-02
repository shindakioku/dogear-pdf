// End-to-end: drives the real built extension in Chrome for Testing.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "pdf-memory-"));
const profile = join(work, "profile");
const zip = join(root, ".cache", readdirSync(join(root, ".cache")).find(name => name.endsWith("-dist.zip")));
execFileSync("unzip", ["-q", "-j", zip, "web/compressed.tracemonkey-pldi-09.pdf", "-d", work]);
const samplePath = join(work, "compressed.tracemonkey-pldi-09.pdf");
const sample = readFileSync(samplePath);
const localPath = join(work, "local.pdf");
copyFileSync(samplePath, localPath);

// Four pages labelled "Cover", "1", "2", "3": the printed 2 is the file's page 3.
function pdfWithPageLabels() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /P (Cover) >> 1 << /S /D /St 1 >>] >> >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R] /Count 4 /MediaBox [0 0 300 300] >>",
    "<< /Type /Page /Parent 2 0 R >>",
    "<< /Type /Page /Parent 2 0 R >>",
    "<< /Type /Page /Parent 2 0 R >>",
    "<< /Type /Page /Parent 2 0 R >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const offset = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

let server, origin, browser, extensionId;

async function launch() {
  browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: true,
    args: [`--load-extension=${join(root, "dist")}`, `--disable-extensions-except=${join(root, "dist")}`],
    userDataDir: profile,
  });
  const worker = await browser.waitForTarget(t => t.type() === "service_worker" && t.url().endsWith("/background.js"));
  extensionId = new URL(worker.url()).host;
  // Recent Chrome disables unpacked extensions on reload unless developer mode is on.
  const settings = await browser.newPage();
  await settings.goto("chrome://extensions");
  await settings.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  await settings.close();
}

before(async () => {
  server = createServer((req, res) => {
    const pdf = headers => { res.writeHead(200, { "content-length": sample.length, ...headers }); res.end(sample); };
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/a.pdf" || url.pathname === "/renamed/other.pdf") return pdf({ "content-type": "application/pdf" });
    if (url.pathname === "/labels.pdf") {
      const labelled = pdfWithPageLabels();
      res.writeHead(200, { "content-type": "application/pdf", "content-length": labelled.length });
      return res.end(labelled);
    }
    if (url.pathname === "/no-extension") return pdf({ "content-type": "application/pdf; qs=1" });
    if (url.pathname === "/octet.pdf") return pdf({ "content-type": "application/octet-stream" });
    if (url.pathname === "/attach.pdf") return pdf({ "content-type": "application/pdf", "content-disposition": 'attachment; filename="x.pdf"' });
    if (url.pathname === "/private.pdf") {
      if (!/session=ok/.test(req.headers.cookie ?? "")) { res.writeHead(403); return res.end("no"); }
      return pdf({ "content-type": "application/pdf" });
    }
    if (url.pathname === "/fails.pdf") {
      if (req.headers["sec-fetch-dest"] === "document") return pdf({ "content-type": "application/pdf" });
      res.writeHead(500); return res.end("nope");
    }
    res.writeHead(200, { "content-type": "text/html" }); res.end("<p>hi");
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
  await launch();
});

after(async () => {
  await browser?.close();
  server?.close();
  rmSync(work, { recursive: true, force: true });
});

async function openPdf(url, { expectedPage } = {}) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.PDFViewerApplication?.pdfViewer?.pagesCount > 0 && PDFViewerApplication.isInitialViewSet);
  if (expectedPage) {
    await page.waitForFunction(p => PDFViewerApplication.page === p, { timeout: 5000 }, expectedPage).catch(() => {});
  }
  return page;
}

async function currentPage(page) {
  return page.evaluate(() => PDFViewerApplication.page);
}

async function goTo(page, number) {
  await page.evaluate(n => { PDFViewerApplication.page = n; }, number);
  await page.waitForFunction(n => PDFViewerApplication.page === n, {}, number);
  await new Promise(r => setTimeout(r, 700)); // Outlast the save debounce.
}

const viewerPrefix = () => `chrome-extension://${extensionId}/pdfjs/web/viewer.html`;

test("restores the page when the PDF is opened again", async () => {
  const first = await openPdf(`${origin}/a.pdf`);
  assert.ok(first.url().startsWith(viewerPrefix()));
  assert.equal(await currentPage(first), 1);
  await goTo(first, 7);
  await first.close();

  const second = await openPdf(`${origin}/a.pdf`, { expectedPage: 7 });
  await new Promise(r => setTimeout(r, 800)); // A late reset would show up here.
  assert.equal(await currentPage(second), 7);
  await second.close();
});

test("restores the exact offset within a page, and the zoom", async () => {
  const first = await openPdf(`${origin}/a.pdf`);
  await first.evaluate(() => {
    PDFViewerApplication.pdfViewer.currentScaleValue = "1.5";
    PDFViewerApplication.pdfLinkService.setHash("page=5&zoom=150,0,400");
  });
  await first.waitForFunction(() => PDFViewerApplication.page === 5);
  await new Promise(r => setTimeout(r, 700));
  const before = await first.evaluate(() => document.getElementById("viewerContainer").scrollTop);
  await first.close();

  const second = await openPdf(`${origin}/a.pdf`, { expectedPage: 5 });
  await new Promise(r => setTimeout(r, 800));
  const state = await second.evaluate(() => ({
    top: document.getElementById("viewerContainer").scrollTop,
    scale: PDFViewerApplication.pdfViewer.currentScale,
  }));
  assert.ok(Math.abs(state.top - before) < 3, `${state.top} vs ${before}`);
  assert.equal(state.scale, 1.5);
  await second.close();
});

test("recognises the same file at a different URL", async () => {
  const first = await openPdf(`${origin}/a.pdf`);
  await goTo(first, 9);
  await first.close();
  const second = await openPdf(`${origin}/renamed/other.pdf`, { expectedPage: 9 });
  assert.equal(await currentPage(second), 9);
  await second.close();
});

test("an explicit #page in the link wins over the saved position", async () => {
  const first = await openPdf(`${origin}/a.pdf`);
  await goTo(first, 4);
  await first.close();
  const second = await openPdf(`${origin}/a.pdf#page=11`, { expectedPage: 11 });
  assert.equal(await currentPage(second), 11);
  await second.close();
});

test("keeps positions for far more files than PDF.js's own 20-entry history", async () => {
  const page = await browser.newPage();
  await page.goto(`${origin}/a.pdf`);
  await page.waitForFunction(() => PDFViewerApplication?.isInitialViewSet);
  const stored = await page.evaluate(async () => {
    const many = {};
    for (let i = 0; i < 5000; i++) many[`pos:filler${i}`] = { hash: "page=2", page: 2 };
    await chrome.storage.local.set(many);
    return Object.keys(await chrome.storage.local.get(null)).length;
  });
  assert.ok(stored >= 5000);
  await goTo(page, 6);
  await page.close();
  const again = await openPdf(`${origin}/a.pdf`, { expectedPage: 6 });
  assert.equal(await currentPage(again), 6);
  await again.close();
});

test("survives a browser restart", async () => {
  const first = await openPdf(`${origin}/a.pdf`);
  await goTo(first, 12);
  await browser.close();
  await launch();
  const second = await openPdf(`${origin}/a.pdf`, { expectedPage: 12 });
  assert.equal(await currentPage(second), 12);
  await second.close();
});

test("saves on tab close even inside the debounce window", async () => {
  const first = await openPdf(`${origin}/a.pdf`);
  await first.evaluate(() => new Promise(resolve => {
    PDFViewerApplication.eventBus.on("updateviewarea", e => { if (e.location.pageNumber === 3) resolve(); });
    PDFViewerApplication.page = 3;
  }));
  await first.close({ runBeforeUnload: true });
  await new Promise(r => setTimeout(r, 300));
  const second = await openPdf(`${origin}/a.pdf`, { expectedPage: 3 });
  assert.equal(await currentPage(second), 3);
  await second.close();
});

async function typePage(page, value) {
  await page.click("#pageNumber", { count: 3 });
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  await new Promise(r => setTimeout(r, 300));
}

const numberingState = page => page.evaluate(() => ({
  physical: PDFViewerApplication.page,
  box: document.getElementById("pageNumber").value,
  hint: document.getElementById("pageLabelHint").hidden ? null : document.getElementById("pageLabelHint").textContent,
  toggleVisible: !document.getElementById("pageNumberingToggle").hidden,
}));

test("page numbering: file pages by default, book pages on toggle, digits only in the box", async () => {
  const page = await openPdf(`${origin}/labels.pdf#page=1`);
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(await numberingState(page), { physical: 1, box: "1", hint: "Cover", toggleVisible: true });

  await typePage(page, "2");
  let state = await numberingState(page);
  assert.equal(state.physical, 2);
  assert.equal(state.box, "2");
  assert.match(state.hint, /1/, "file page 2 is printed as 1");

  await page.click("#pageNumberingToggle");
  state = await numberingState(page);
  assert.equal(state.physical, 2, "switching mode does not move the reader");
  assert.equal(state.box, "1");

  await typePage(page, "2");
  state = await numberingState(page);
  assert.equal(state.physical, 3, "book page 2 is file page 3");
  assert.equal(state.box, "2");

  await typePage(page, "1");
  await page.evaluate(() => { PDFViewerApplication.page = 1; });
  await new Promise(r => setTimeout(r, 300));
  assert.deepEqual(await numberingState(page), { physical: 1, box: "", hint: "Cover", toggleVisible: true });
  await page.close();

  const reopened = await openPdf(`${origin}/labels.pdf#page=3`);
  await new Promise(r => setTimeout(r, 300));
  state = await numberingState(reopened);
  assert.equal(state.box, "2", "the chosen mode is remembered");
  await reopened.click("#pageNumberingToggle");
  state = await numberingState(reopened);
  assert.equal(state.box, "3");
  await reopened.close();
});

test("page numbering: no toggle or hint for PDFs without page labels", async () => {
  const page = await openPdf(`${origin}/a.pdf#page=2`);
  await new Promise(r => setTimeout(r, 300));
  const state = await numberingState(page);
  assert.equal(state.toggleVisible, false);
  assert.equal(state.hint, null);
  assert.equal(state.box, "2");
  await page.close();
});

test("detects PDFs by content type and octet-stream by .pdf", async () => {
  for (const path of ["/no-extension", "/octet.pdf"]) {
    const page = await openPdf(`${origin}${path}`);
    assert.ok(page.url().startsWith(viewerPrefix()), path);
    await page.close();
  }
});

test("leaves ordinary pages alone and attachments as downloads", async () => {
  const page = await browser.newPage();
  await page.goto(`${origin}/page.html`);
  assert.equal(page.url(), `${origin}/page.html`);
  await page.goto(`${origin}/page.html`);
  await page.evaluate(o => { location.href = `${o}/attach.pdf`; }, origin);
  await new Promise(r => setTimeout(r, 800));
  assert.ok(!page.url().startsWith("chrome-extension"), page.url());
  await page.close();
});

test("query strings containing &file= are not misread as viewer parameters", async () => {
  const page = await openPdf(`${origin}/a.pdf?x=1&file=${encodeURIComponent(origin + "/evil.pdf")}`);
  const url = await page.evaluate(() => PDFViewerApplication.url);
  assert.ok(url.includes("/a.pdf?x=1&file="), url);
  await page.close();
});

test("sends cookies for PDFs behind a login", async () => {
  await browser.setCookie({ name: "session", value: "ok", domain: "127.0.0.1", path: "/" });
  const page = await openPdf(`${origin}/private.pdf`);
  assert.equal(await page.evaluate(() => PDFViewerApplication.pagesCount), 14);
  await page.close();
  await browser.setCookie({ name: "session", value: "", domain: "127.0.0.1", path: "/", expires: 1 });
});

test("failed loads offer Chrome's viewer, which then actually opens", async () => {
  const page = await browser.newPage();
  await page.goto(`${origin}/fails.pdf`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#openInChromeViewerBanner", { timeout: 8000 });
  const navigated = page.waitForNavigation({ waitUntil: "domcontentloaded" });
  await page.click("#openInChromeViewerBanner");
  await navigated;
  assert.equal(page.url(), `${origin}/fails.pdf`);
  await page.close();
});

test("the viewer page has no errors on a normal open and the menu item exists", async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  // Warnings and errors from extension pages land on the chrome://extensions errors page.
  page.on("console", m => { if (["error", "warn"].includes(m.type())) errors.push(m.text()); });
  await page.goto(`${origin}/a.pdf`);
  await page.waitForFunction(() => PDFViewerApplication?.isInitialViewSet);
  await page.waitForSelector("#openInChromeViewer", { hidden: false, timeout: 3000 }).catch(() => {});
  assert.equal(await page.evaluate(() => PDFViewerApplicationOptions.get("verbosity")), 0, "font quirks stay quiet");
  assert.ok(await page.$("#openInChromeViewer"));
  assert.deepEqual(errors, []);
  await page.close();
});

test("harmless ResizeObserver loop notices don't reach the extension's error list", async () => {
  const page = await openPdf(`${origin}/a.pdf`);
  const client = await page.createCDPSession();
  const reported = [];
  client.on("Log.entryAdded", e => reported.push(e.entry.text));
  client.on("Runtime.exceptionThrown", e => reported.push(e.exceptionDetails.text));
  client.on("Runtime.consoleAPICalled", e => reported.push(e.type));
  await client.send("Log.enable");
  await client.send("Runtime.enable");
  const notice = await page.evaluate(() => new Promise(resolve => {
    let handled = null;
    addEventListener("error", e => {
      if (e.message.startsWith("ResizeObserver loop")) handled = e.defaultPrevented;
    });
    const box = document.body.appendChild(document.createElement("div"));
    new ResizeObserver(() => { box.style.width = `${box.offsetWidth + 1}px`; }).observe(box);
    setTimeout(() => { box.remove(); resolve(handled); }, 300);
  }));
  assert.equal(notice, true, "the notice must fire and be marked handled");
  await page.close();
});

async function openAtWidth(url, width) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.PDFViewerApplication?.pdfViewer?.pagesCount > 0 && PDFViewerApplication.isInitialViewSet);
  await new Promise(r => setTimeout(r, 300));
  return page;
}

const zoomState = page => page.evaluate(() => ({
  value: PDFViewerApplication.pdfViewer.currentScaleValue,
  scale: PDFViewerApplication.pdfViewer.currentScale,
  shown: document.getElementById("zoomPercent").textContent,
  besideMenu: !document.getElementById("zoomPercent").hidden,
}));

async function forgetPositionsAndZoom(page) {
  await page.evaluate(async () => {
    const keys = Object.keys(await chrome.storage.local.get(null));
    await chrome.storage.local.remove(keys.filter(k => k.startsWith("pos:") || k === "settings:defaultZoom"));
  });
}

test("zoom: new PDFs fill the window width, capped on wide screens, and % is shown", async () => {
  const setup = await openPdf(`${origin}/a.pdf`);
  await forgetPositionsAndZoom(setup);
  await setup.close();

  const narrow = await openAtWidth(`${origin}/a.pdf`, 800);
  const narrowState = await zoomState(narrow);
  assert.equal(narrowState.value, "page-width");
  assert.equal(narrowState.shown, `${Math.round(narrowState.scale * 100)}%`);
  assert.equal(narrowState.besideMenu, true, "the menu only says a word here");
  await narrow.close();

  // The same file on a bigger screen: the saved full-width default must not exceed the cap.
  const wide = await openAtWidth(`${origin}/a.pdf`, 1900);
  assert.deepEqual(await zoomState(wide), { value: "1.5", scale: 1.5, shown: "150%", besideMenu: false });
  await wide.close();
});

test("zoom: the level you pick becomes the default for new PDFs; Ctrl+0 forgets it", async () => {
  const first = await openAtWidth(`${origin}/a.pdf`, 1900);
  await forgetPositionsAndZoom(first);
  await first.click("#zoomInButton");
  await new Promise(r => setTimeout(r, 600));
  const picked = await zoomState(first);
  assert.ok(picked.scale > 1, String(picked.scale));
  assert.equal(picked.shown, `${Math.round(picked.scale * 100)}%`);
  await first.close();

  const other = await openAtWidth(`${origin}/labels.pdf`, 1900);
  assert.equal((await zoomState(other)).shown, picked.shown);

  await other.evaluate(() => PDFViewerApplication.zoomReset());
  await new Promise(r => setTimeout(r, 600));
  assert.equal(await other.evaluate(async () => (await chrome.storage.local.get("settings:defaultZoom"))["settings:defaultZoom"] ?? null), null);
  await forgetPositionsAndZoom(other);
  await other.close();
});

test("zoom: a PDF's own zoom wins, but positions saved with the old automatic zoom get the new default", async () => {
  const first = await openAtWidth(`${origin}/a.pdf`, 1900);
  await forgetPositionsAndZoom(first);
  const key = await first.evaluate(() => `pos:${PDFViewerApplication.pdfDocument.fingerprints[0]}`);
  await first.close();
  // Written from another tab, after the first one's last save.
  const writer = await openAtWidth(`${origin}/labels.pdf`, 1900);
  await writer.evaluate(k => chrome.storage.local.set({ [k]: { hash: "page=4&zoom=auto,0,500", page: 4 } }), key);
  await writer.close();

  const legacy = await openAtWidth(`${origin}/a.pdf`, 1900);
  assert.equal(await currentPage(legacy), 4);
  assert.equal((await zoomState(legacy)).scale, 1.5);
  await legacy.evaluate(() => { PDFViewerApplication.pdfViewer.currentScaleValue = "2"; });
  await new Promise(r => setTimeout(r, 700));
  await legacy.close();

  const own = await openAtWidth(`${origin}/a.pdf`, 1900);
  assert.equal((await zoomState(own)).scale, 2);
  await forgetPositionsAndZoom(own);
  await own.close();
});

test("toolbar: page controls are centred, zoom sits on the right, and nothing overflows", async () => {
  const page = await openAtWidth(`${origin}/labels.pdf#page=2`, 1920);
  const layout = () => page.evaluate(() => {
    const box = id => document.getElementById(id).getBoundingClientRect();
    const toolbar = document.getElementById("toolbarViewer");
    const visible = [...toolbar.querySelectorAll("button, input, select, #numPages")]
      .filter(e => e.offsetParent !== null).map(e => e.getBoundingClientRect());
    const middle = box("toolbarViewerMiddle");
    return {
      middleCentre: (middle.left + middle.right) / 2,
      zoomRightOfMiddle: box("zoomOutButton").left >= middle.right,
      overflows: toolbar.scrollWidth > toolbar.clientWidth + 1,
      beyondWindow: visible.some(r => r.right > innerWidth + 1 || r.left < -1),
      overlap: box("toolbarViewerLeft").right > middle.left + 1 || middle.right > box("toolbarViewerRight").left + 1,
      pageBox: box("pageNumber").width > 0,
    };
  });
  const wide = await layout();
  assert.ok(Math.abs(wide.middleCentre - 960) < 2, `centre at ${wide.middleCentre}`);
  assert.equal(wide.zoomRightOfMiddle, true);

  for (const width of [1920, 1400, 1100, 1000, 850, 700, 650, 500]) {
    await page.setViewport({ width, height: 700 });
    await new Promise(r => setTimeout(r, 150));
    const state = await layout();
    assert.deepEqual(
      { overflows: state.overflows, beyondWindow: state.beyondWindow, overlap: state.overlap, pageBox: state.pageBox },
      { overflows: false, beyondWindow: false, overlap: false, pageBox: true },
      `at ${width}px`,
    );
  }

  // Controls still work from their new home.
  await page.setViewport({ width: 1400, height: 800 });
  await new Promise(r => setTimeout(r, 150));
  const before = await currentPage(page);
  await page.click("#next");
  await page.waitForFunction(p => PDFViewerApplication.page === p + 1, { polling: 50 }, before);
  const scale = await page.evaluate(() => PDFViewerApplication.pdfViewer.currentScale);
  await page.click("#zoomInButton");
  await page.waitForFunction(s => PDFViewerApplication.pdfViewer.currentScale > s, { polling: 50 }, scale);
  await page.evaluate(() => PDFViewerApplication.zoomReset());
  await page.close();
});

test("toolbar: controls are vertically centred in the bar", async () => {
  const page = await openAtWidth(`${origin}/labels.pdf#page=2`, 1920);
  const offCentre = await page.evaluate(() => {
    const bar = document.getElementById("toolbarContainer").getBoundingClientRect();
    const centre = (bar.top + bar.bottom) / 2;
    return ["viewFindButton", "previous", "pageNumber", "pageNumberingToggle", "zoomOutButton", "scaleSelect", "hideToolbarButton", "secondaryToolbarToggleButton"]
      .map(id => [id, (r => (r.top + r.bottom) / 2 - centre)(document.getElementById(id).getBoundingClientRect())])
      .filter(([, delta]) => Math.abs(delta) > 1);
  });
  assert.deepEqual(offCentre, []);
  await page.close();
});

test("toolbar: can be hidden and brought back, and the choice is remembered", async () => {
  const page = await openAtWidth(`${origin}/a.pdf#page=2`, 1400);
  const state = () => page.evaluate(() => ({
    hidden: document.documentElement.classList.contains("toolbarHidden"),
    barBottom: Math.round(document.querySelector(".toolbar").getBoundingClientRect().bottom),
    viewerTop: Math.round(document.getElementById("viewerContainer").getBoundingClientRect().top),
  }));
  const settled = () => new Promise(r => setTimeout(r, 250));
  const shown = await state();
  assert.equal(shown.hidden, false);
  assert.ok(shown.viewerTop > 0);

  await page.mouse.move(700, 500);
  await page.click("#hideToolbarButton");
  await page.mouse.move(700, 500);
  await settled();
  assert.deepEqual(await state(), { hidden: true, barBottom: 0, viewerTop: 0 });

  // The top edge brings it back over the page, and it leaves with the pointer.
  await page.mouse.move(700, 2);
  await settled();
  let peek = await state();
  assert.equal(peek.hidden, true);
  assert.ok(peek.barBottom > 0, "visible while pointing at it");
  assert.equal(peek.viewerTop, 0, "the page doesn't jump");
  await page.mouse.move(700, 500);
  await settled();
  assert.equal((await state()).barBottom, 0);

  // Search needs the bar, for as long as it's open.
  await page.keyboard.down("Control");
  await page.keyboard.press("f");
  await page.keyboard.up("Control");
  await settled();
  assert.ok((await state()).barBottom > 0, "visible during search");
  await page.keyboard.type("t");
  await settled();
  assert.equal((await state()).hidden, true, "typing T in search doesn't toggle");
  await page.keyboard.press("Escape");
  await page.mouse.move(700, 500);
  await page.evaluate(() => document.activeElement?.blur());
  await settled();
  assert.equal((await state()).barBottom, 0, "gone again after search");

  // Remembered across PDFs.
  const other = await openAtWidth(`${origin}/labels.pdf`, 1400);
  await settled();
  assert.equal((await other.evaluate(() => document.documentElement.classList.contains("toolbarHidden"))), true);
  await other.close();

  // The T key and the tab both restore it.
  await page.bringToFront();
  await page.keyboard.press("t");
  await settled();
  assert.equal((await state()).hidden, false);
  await page.keyboard.press("t");
  await settled();
  assert.equal((await state()).hidden, true);
  await page.click("#showToolbarTab");
  await settled();
  const restored = await state();
  assert.equal(restored.hidden, false);
  assert.ok(restored.viewerTop > 0 && restored.barBottom > 0);
  await page.close();
});

test("a web page can't use the viewer in a frame", async () => {
  const page = await browser.newPage();
  await page.goto(`${origin}/page.html`);
  const requested = new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 1500);
    server.once("request", req => { if (req.url.includes("framed")) { clearTimeout(timer); resolve(true); } });
  });
  await page.evaluate(src => {
    const frame = document.createElement("iframe");
    frame.src = src;
    document.body.append(frame);
  }, `${viewerPrefix()}?src=${encodeURIComponent(`${origin}/a.pdf?framed`)}`);
  assert.equal(await requested, false, "the framed viewer fetched the URL");
  await page.close();
});

test("PDF.js keeps no separate history of its own", async () => {
  const page = await openPdf(`${origin}/a.pdf`);
  await goTo(page, 3);
  await page.evaluate(() => { PDFViewerApplication.pdfViewer.currentScaleValue = "1.25"; });
  await new Promise(r => setTimeout(r, 700));
  assert.equal(await page.evaluate(() => localStorage.getItem("pdfjs.history")), null);
  await page.evaluate(() => { PDFViewerApplication.pdfViewer.currentScaleValue = "page-width"; });
  await page.close();
});

test("a fragment that isn't a position doesn't lose the reader's place", async () => {
  const first = await openPdf(`${origin}/a.pdf`);
  await goTo(first, 7);
  await first.close();
  const second = await openPdf(`${origin}/a.pdf#toolbar=0`, { expectedPage: 7 });
  assert.equal(await currentPage(second), 7);
  await second.close();
});

test("a PDF opened from a file isn't recorded under the tab's original address", async () => {
  const page = await openPdf(`${origin}/a.pdf`);
  const entry = await page.evaluate(async () => {
    const bytes = await PDFViewerApplication.pdfDocument.getData();
    const data = new Uint8Array(bytes.length);
    data.set(bytes);
    data[data.length - 1] = 10; // Keeps the same fingerprint, which is fine: the URL is what's under test.
    await PDFViewerApplication.open({ url: URL.createObjectURL(new Blob([data], { type: "application/pdf" })) });
    await new Promise(resolve => {
      const wait = () => (PDFViewerApplication.isInitialViewSet ? resolve() : setTimeout(wait, 50));
      wait();
    });
    PDFViewerApplication.page = 2;
    await new Promise(resolve => setTimeout(resolve, 800));
    const key = `pos:${PDFViewerApplication.pdfDocument.fingerprints[0]}`;
    return (await chrome.storage.local.get(key))[key];
  });
  assert.equal(entry.url, null);
  await page.close();
});

async function openPopup() {
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  return popup;
}

const popupRows = popup => popup.$$eval("#history .row", rows => rows.map(row => ({
  title: row.querySelector(".title").textContent,
  meta: row.querySelector(".meta").textContent,
  disabled: row.querySelector(".open").disabled,
})));

test("popup: stats and history, newest first, with search and removal", async () => {
  const popup = await openPopup();
  await forgetPositionsAndZoom(popup);
  await popup.evaluate(async base => {
    const now = Date.now();
    await chrome.storage.local.set({
      "pos:old": { hash: "page=3", page: 3, pages: 10, url: `${base}/My%20Old%20Book.pdf`, updatedAt: now - 3 * 86400000 },
      "pos:done": { hash: "page=20", page: 20, pages: 20, url: `${base}/d.pdf`, title: "Finished <b>Book</b>", updatedAt: now - 3600000 },
      "pos:new": { hash: "page=5", page: 5, pages: 50, url: `${base}/n.pdf`, title: "Newest", updatedAt: now },
      "pos:nourl": { hash: "page=2", page: 2, pages: 4, url: null, title: "Picked file", updatedAt: now - 60000 },
    });
  }, origin);
  await popup.reload();
  await popup.waitForSelector("#history .row");

  const rows = await popupRows(popup);
  assert.deepEqual(rows.map(r => r.title), ["Newest", "Picked file", "Finished <b>Book</b>", "My Old Book.pdf"]);
  assert.equal(rows.at(1).disabled, true, "no address to reopen");
  assert.match(rows[0].meta, /5.*50/);
  const stats = () => popup.evaluate(() => ["statDocuments", "statFinished", "statPages"].map(id => document.getElementById(id).textContent));
  assert.deepEqual(await stats(), ["4", "1", "30"]);

  // The removed entry is gone from storage too, so its position is really forgotten.
  await popup.hover("#history .row:nth-child(1)");
  await popup.click("#history .row:nth-child(1) .remove");
  await popup.waitForFunction(() => document.querySelectorAll("#history .row").length === 3);
  assert.equal(await popup.evaluate(async () => (await chrome.storage.local.get("pos:new"))["pos:new"] ?? null), null);
  assert.deepEqual(await stats(), ["3", "1", "25"]);

  // Clearing takes a second click, and leaves settings alone.
  await popup.evaluate(() => chrome.storage.local.set({ "settings:toolbarHidden": false }));
  await popup.click("#clearHistory");
  assert.equal((await popupRows(popup)).length, 3);
  await popup.click("#clearHistory");
  await popup.waitForFunction(() => document.querySelectorAll("#history .row").length === 0);
  const left = await popup.evaluate(async () => Object.keys(await chrome.storage.local.get(null)));
  assert.ok(!left.some(key => key.startsWith("pos:")), left.join());
  assert.ok(left.includes("settings:toolbarHidden"));
  await popup.close();
});

test("popup: search appears with many entries and reaches past the visible rows", async () => {
  const popup = await openPopup();
  await forgetPositionsAndZoom(popup);
  await popup.evaluate(async () => {
    const many = {};
    for (let i = 0; i < 60; i++) many[`pos:m${i}`] = { hash: "page=1", page: 1, pages: 2, url: `http://x/${i}.pdf`, title: `Doc ${i}`, updatedAt: 1000 + i };
    await chrome.storage.local.set(many);
  });
  await popup.reload();
  await popup.waitForSelector("#history .row");
  assert.equal((await popupRows(popup)).length, 50);
  await popup.type("#search", "doc 3");
  await popup.waitForFunction(() => document.querySelector("#history .title").textContent !== "Doc 59");
  const titles = (await popupRows(popup)).map(r => r.title);
  assert.ok(titles.includes("Doc 3"), titles.join());
  await forgetPositionsAndZoom(popup);
  await popup.close();
});

test("popup: clicking switches to the open tab, or reopens the PDF at its saved page", async () => {
  await closeViewerTabs();
  const reader = await openPdf(`${origin}/a.pdf`);
  await goTo(reader, 6);
  const rowFor = popup => popup.evaluateHandle(() =>
    [...document.querySelectorAll("#history .open")].find(b => b.title.endsWith("/a.pdf")));
  const clickFromPopup = async () => {
    const popup = await openPopup();
    await popup.waitForSelector("#history .row");
    assert.match(await popup.evaluate(() => document.querySelector("#history .title").textContent), /\S/);
    const closed = new Promise(r => popup.once("close", r));
    await (await rowFor(popup)).click();
    await Promise.race([closed, new Promise(r => setTimeout(r, 1000))]);
  };

  const tabCount = () => browser.targets().filter(t => t.type() === "page").length;
  const before = tabCount();
  await clickFromPopup();
  await new Promise(r => setTimeout(r, 500)); // Long enough for a wrongly opened tab to show up.
  assert.equal(tabCount(), before, "no second tab");
  assert.equal(await reader.evaluate(async () => (await chrome.tabs.getCurrent()).active), true, "switched to it");

  // A tab that has since moved on to another page doesn't count as open.
  await reader.goto(`${origin}/page.html`);
  await clickFromPopup();
  assert.deepEqual(await waitForViewerSources([`${origin}/a.pdf`]), [`${origin}/a.pdf`], "reopened");
  assert.equal(reader.url(), `${origin}/page.html`);
  const reopened = await viewerTargets()[0].page();
  await reopened.bringToFront();
  await reopened.waitForFunction(() => PDFViewerApplication.page === 6, { polling: 100, timeout: 8000 });
  await reopened.close();
  await reader.close();
});

// Targets, not pages: reopened tabs may still be attaching.
const viewerTargets = () => browser.targets().filter(t => t.type() === "page" && t.url().startsWith(viewerPrefix()));
const openViewerSources = async () => viewerTargets().map(t => new URL(t.url()).searchParams.get("src")).sort();
const closeViewerTabs = async () => {
  for (const target of viewerTargets()) await (await target.page()).close();
  await new Promise(r => setTimeout(r, 300));
};

// What the reload button on chrome://extensions does, and Chrome reports it to the extension as an update.
async function reloadExtensionFrom(page) {
  const target = page.target();
  const settings = await browser.newPage();
  await settings.goto("chrome://extensions");
  await settings.evaluate(id => new Promise(resolve => chrome.developerPrivate.reload(id, { failQuietly: true }, resolve)), extensionId);
  while (browser.targets().includes(target)) await new Promise(r => setTimeout(r, 50));
  await settings.close();
}

async function waitForViewerSources(expected) {
  const deadline = Date.now() + 10000;
  let actual;
  do {
    actual = await openViewerSources();
    if (JSON.stringify(actual) === JSON.stringify(expected)) return actual;
    await new Promise(r => setTimeout(r, 200));
  } while (Date.now() < deadline);
  return actual;
}

test("an extension update reopens its PDF tabs where they were, but not ones the user closed", async () => {
  await closeViewerTabs();
  const keep = await openPdf(`${origin}/a.pdf`);
  await goTo(keep, 10);
  const closed = await openPdf(`${origin}/renamed/other.pdf?closed`);
  const navigatedAway = await openPdf(`${origin}/no-extension?away`);
  await navigatedAway.goto(`${origin}/page.html`);
  await closed.close();
  await new Promise(r => setTimeout(r, 300));

  await reloadExtensionFrom(keep);
  const actual = await waitForViewerSources([`${origin}/a.pdf`]);
  assert.deepEqual(actual, [`${origin}/a.pdf`]);

  const reopened = await viewerTargets()[0].page();
  // Reopened tabs load in the background, where requestAnimationFrame-based polling would stall.
  await reopened.bringToFront();
  await reopened.waitForFunction(() => window.PDFViewerApplication?.isInitialViewSet, { polling: 100, timeout: 8000 });
  await reopened.waitForFunction(() => PDFViewerApplication.page === 10, { polling: 100, timeout: 5000 });
  assert.equal(navigatedAway.url(), `${origin}/page.html`, "tabs showing something else are untouched");

  // A second update must not duplicate the tab or bring anything else back.
  await reloadExtensionFrom(reopened);
  await new Promise(r => setTimeout(r, 1500));
  assert.deepEqual(await waitForViewerSources([`${origin}/a.pdf`]), [`${origin}/a.pdf`]);
  await closeViewerTabs();
  await navigatedAway.close();
});

const tabInfo = page => page.evaluate(async () => {
  const tab = await chrome.tabs.getCurrent();
  const group = tab.groupId === -1 ? null : await chrome.tabGroups.get(tab.groupId);
  return { groupId: tab.groupId, index: tab.index, title: group?.title ?? null, color: group?.color ?? null, collapsed: group?.collapsed ?? null };
});

async function reopenedPage(path) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const target = viewerTargets().find(t => new URL(t.url()).searchParams.get("src") === `${origin}${path}`);
    if (target) return target.page();
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`${path} was not reopened`);
}

test("an update restores tab groups, including ones made after opening and ones that held only PDFs", async () => {
  await closeViewerTabs();
  const one = await openPdf(`${origin}/a.pdf?one`);
  const two = await openPdf(`${origin}/a.pdf?two`);
  const loose = await openPdf(`${origin}/a.pdf?loose`);
  await one.evaluate(async () => {
    const { windowId } = await chrome.tabs.getCurrent();
    const pages = await chrome.storage.local.get(null);
    const ids = Object.entries(pages).filter(([k, v]) => k.startsWith("tab:") && /\?(one|two)$/.test(v.source)).map(([k]) => Number(k.slice(4)));
    const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { title: "Books", color: "blue" });
  });
  await new Promise(r => setTimeout(r, 400));
  const before = await tabInfo(one);
  assert.equal(before.title, "Books");

  await reloadExtensionFrom(loose);
  const [newOne, newTwo, newLoose] = [await reopenedPage("/a.pdf?one"), await reopenedPage("/a.pdf?two"), await reopenedPage("/a.pdf?loose")];
  await new Promise(r => setTimeout(r, 500));
  const [infoOne, infoTwo, infoLoose] = [await tabInfo(newOne), await tabInfo(newTwo), await tabInfo(newLoose)];
  assert.equal(infoOne.title, "Books");
  assert.equal(infoOne.color, "blue");
  assert.equal(infoOne.groupId, infoTwo.groupId, "still one group");
  assert.equal(infoLoose.groupId, -1, "ungrouped stays ungrouped");
  assert.ok(infoOne.index < infoTwo.index && infoTwo.index < infoLoose.index, "order kept");

  // Renamed after reopening, then updated again: reopened tabs are tracked as well.
  await newOne.evaluate(async () => {
    const { groupId } = await chrome.tabs.getCurrent();
    await chrome.tabGroups.update(groupId, { title: "Renamed", color: "red" });
  });
  await new Promise(r => setTimeout(r, 400));
  await reloadExtensionFrom(newLoose);
  await new Promise(r => setTimeout(r, 300));
  const again = await reopenedPage("/a.pdf?two");
  await new Promise(r => setTimeout(r, 500));
  const infoAgain = await tabInfo(again);
  assert.equal(infoAgain.title, "Renamed");
  assert.equal(infoAgain.color, "red");
  await closeViewerTabs();
});

test("an update puts PDFs back into a group that survived through other tabs", async () => {
  await closeViewerTabs();
  const other = await browser.newPage();
  await other.goto(`${origin}/page.html`);
  const reader = await openPdf(`${origin}/a.pdf?mixed`);
  const groupId = await reader.evaluate(async () => {
    const me = await chrome.tabs.getCurrent();
    const all = await chrome.tabs.query({ windowId: me.windowId });
    const neighbour = all[me.index - 1];
    const id = await chrome.tabs.group({ tabIds: [neighbour.id, me.id], createProperties: { windowId: me.windowId } });
    await chrome.tabGroups.update(id, { title: "Mixed" });
    return id;
  });
  await new Promise(r => setTimeout(r, 400));
  await reloadExtensionFrom(reader);
  const reopened = await reopenedPage("/a.pdf?mixed");
  await new Promise(r => setTimeout(r, 500));
  assert.equal((await tabInfo(reopened)).groupId, groupId, "same group, no duplicate");
  await closeViewerTabs();
  await other.close();
});

async function setFileAccess(allowed) {
  const settings = await browser.newPage();
  await settings.goto(`chrome://extensions/?id=${extensionId}`);
  await settings.waitForFunction(() => document.querySelector("extensions-manager")?.shadowRoot
    ?.querySelector("extensions-detail-view")?.shadowRoot.querySelector("#allow-on-file-urls"));
  await settings.evaluate(wanted => {
    const toggle = document.querySelector("extensions-manager").shadowRoot
      .querySelector("extensions-detail-view").shadowRoot.querySelector("#allow-on-file-urls");
    if (toggle.checked !== wanted) toggle.shadowRoot.querySelector("cr-toggle").click();
  }, allowed);
  await settings.close();
  await new Promise(r => setTimeout(r, 1500)); // Chrome reloads the extension on this change.
}

test("changing file access reopens PDF tabs too", async () => {
  await closeViewerTabs();
  await setFileAccess(false);
  await setFileAccess(true);
  await openPdf(`${origin}/a.pdf`);
  await new Promise(r => setTimeout(r, 300));
  await setFileAccess(false);
  assert.deepEqual(await waitForViewerSources([`${origin}/a.pdf`]), [`${origin}/a.pdf`]);
  await closeViewerTabs();
  await new Promise(r => setTimeout(r, 300));
  await setFileAccess(true);
});

test("local files: redirected and remembered with file access on", async () => {
  await setFileAccess(true);
  const first = await openPdf(`file://${localPath}`);
  assert.ok(first.url().startsWith(viewerPrefix()));
  await goTo(first, 8);
  await first.close();
  const second = await openPdf(`file://${localPath}`, { expectedPage: 8 });
  assert.equal(await currentPage(second), 8);
  await second.close();
});

test("local files: without access, Chrome's viewer stays and the popup explains why", async () => {
  await setFileAccess(false);
  const pdf = await browser.newPage();
  await pdf.goto(`file://${localPath}`, { waitUntil: "domcontentloaded" });
  await new Promise(r => setTimeout(r, 500));
  assert.equal(pdf.url(), `file://${localPath}`);
  await pdf.close();
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.waitForSelector("#fileAccess:not([hidden])", { timeout: 3000 });
  await popup.close();
  await setFileAccess(true);
});
