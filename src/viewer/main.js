// Loaded before PDF.js by a script tag that scripts/build.mjs adds to viewer.html.
import { addFallbackMenuItem, showFallbackBanner } from "./fallback.js";
import { answerPopup, trackOpenTab } from "./open-tab.js";
import { rememberPosition } from "./position.js";
import { pageNumbering } from "./page-numbering.js";
import { arrangeToolbar, hideableToolbar } from "./toolbar.js";
import { zoomControls } from "./zoom.js";

// "?DNR:" is what versions before 1.0.0 redirected to. Tabs Chrome restores from that time still use it.
const REDIRECT_PREFIXES = ["?redirect:", "?DNR:"];

// Redirect rules can't URL-encode, so normalise before PDF.js parses the query string:
// a source URL containing "&file=" must not be read as a viewer parameter.
const prefix = REDIRECT_PREFIXES.find(candidate => location.search.startsWith(candidate));
if (prefix) {
  const raw = location.search.slice(prefix.length);
  history.replaceState(null, "", `${location.pathname}?src=${encodeURIComponent(raw)}${location.hash}`);
}
const source = new URLSearchParams(location.search).get("src");

// PDF.js's layout can trigger this benign browser notice, which would fill the extension's error list.
addEventListener("error", event => {
  if (event.message?.startsWith("ResizeObserver loop")) event.preventDefault();
});

document.addEventListener("webviewerloaded", () => {
  arrangeToolbar();
  const options = window.PDFViewerApplicationOptions;
  options.set("disablePreferences", true); // Saved PDF.js preferences would override these options.
  options.set("enableWebGPU", false); // Only helps rare mesh gradients, and warns without a GPU adapter.
  options.set("verbosity", 0); // Errors only. Font quirks in a PDF aren't actionable.
  options.set("defaultUrl", ""); // Otherwise PDF.js opens its demo document.
  options.set("viewOnLoad", 1); // Positions come from position.js, not PDF.js's 20-file history.
  options.set("disablePageLabels", true); // Handled by page-numbering.js.
  options.set("withCredentials", true); // PDFs behind a login need the site's cookies.
  const app = window.PDFViewerApplication;
  app.initializedPromise.then(() => start(app));
});

function start(app) {
  rememberPosition(app, source);
  pageNumbering(app);
  zoomControls(app);
  hideableToolbar();

  // Redirects only target top-level pages. Framed, a web page could make this page fetch URLs with
  // the user's cookies and write to their history.
  const canOpen = window.top === window && /^(https?|file):/i.test(source ?? "");
  if (!canOpen) return;

  addFallbackMenuItem(source);
  trackOpenTab(source);
  answerPopup(source);
  app.open({ url: source }).catch(() => showFallbackBanner(source));
}
