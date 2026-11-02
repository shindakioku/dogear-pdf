import { POSITION_PREFIX } from "../shared/storage-keys.js";
import { defaultZoom } from "./zoom.js";

const SAVE_DELAY_MS = 400;

export function rememberPosition(app, source) {
  // Only these link to a place. Others, like #toolbar=0, shouldn't cost the reader theirs.
  const linksToPosition = /(^|&)(page|nameddest)=/.test(location.hash.slice(1));
  let key = null;
  let pending = null;
  let timer = 0;

  const flush = () => {
    clearTimeout(timer);
    if (!pending) return;
    chrome.storage.local.set({ [pending.key]: pending.value });
    pending = null;
  };

  const load = app.load;
  app.load = async function (pdfDocument) {
    flush();
    key = `${POSITION_PREFIX}${pdfDocument.fingerprints[0]}`;
    try {
      const zoom = await defaultZoom(pdfDocument);
      const saved = linksToPosition ? null : (await chrome.storage.local.get(key))[key];
      if (saved) {
        // Saved "auto" and "page-width" were defaults, not choices. Choosing one from the menu
        // makes it the default zoom, so it still applies here.
        app.initialBookmark = saved.hash.replace(/zoom=(auto|page-width)\b/, `zoom=${zoom}`);
        app.initialRotation = saved.rotation;
      } else if (/^page=\d+$/.test(app.initialBookmark ?? "")) {
        app.initialBookmark += `&zoom=${zoom}`;
      } else if (!linksToPosition) {
        window.PDFViewerApplicationOptions.set("defaultZoomValue", String(zoom));
      }
    } catch (error) {
      console.warn("Could not read saved position", error);
    }
    return load.call(this, pdfDocument);
  };

  if (chrome.extension.inIncognitoContext) return;

  app.eventBus.on("updateviewarea", ({ location: area }) => {
    // Earlier updates describe the initial layout, not where the reader is.
    if (!key || !app.isInitialViewSet) return;
    pending = {
      key,
      value: {
        hash: area.pdfOpenParams.slice(1),
        page: area.pageNumber,
        rotation: area.rotation,
        pages: app.pagesCount,
        url: app.url?.startsWith("blob:") ? null : source, // Opened with "Open file" or drag and drop.
        title: document.title,
        updatedAt: Date.now(),
      },
    };
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY_MS);
  });
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush();
  });
}
