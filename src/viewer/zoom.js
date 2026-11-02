import { DEFAULT_ZOOM_KEY } from "../shared/storage-keys.js";

const SAVE_DELAY_MS = 400;
const MAX_DEFAULT_SCALE = 1.5; // Beyond this, a full-width page on a large monitor is uncomfortably big.
const CSS_PIXELS_PER_POINT = 96 / 72;
const VIEWER_SIDE_PADDING = 40;

// The zoom the reader last picked; otherwise the window width, capped.
export async function defaultZoom(pdfDocument) {
  const picked = (await chrome.storage.local.get(DEFAULT_ZOOM_KEY))[DEFAULT_ZOOM_KEY];
  if (picked) return picked;
  const firstPage = await pdfDocument.getPage(1);
  const pageWidth = firstPage.getViewport({ scale: 1 }).width * CSS_PIXELS_PER_POINT;
  const available = document.getElementById("viewerContainer").clientWidth - VIEWER_SIDE_PADDING;
  return available / pageWidth > MAX_DEFAULT_SCALE ? MAX_DEFAULT_SCALE * 100 : "page-width";
}

export function zoomControls(app) {
  const percent = Object.assign(document.createElement("span"), { id: "zoomPercent" });
  document.getElementById("scaleSelectContainer").after(percent);
  app.eventBus.on("scalechanging", ({ scale }) => {
    percent.textContent = `${Math.round(scale * 100)}%`;
    // The menu shows a percentage for numeric zooms, but a word for "page-width" and the like.
    percent.hidden = !Number.isNaN(Number(app.pdfViewer.currentScaleValue));
  });

  let timer = 0;
  const remember = zoom => {
    clearTimeout(timer);
    timer = setTimeout(() => chrome.storage.local.set({ [DEFAULT_ZOOM_KEY]: zoom }), SAVE_DELAY_MS);
  };

  // Buttons, Ctrl+wheel, keyboard and pinch all pass through updateZoom; layout changes don't.
  const updateZoom = app.updateZoom;
  app.updateZoom = function (...args) {
    updateZoom.apply(this, args);
    remember(Math.round(app.pdfViewer.currentScale * 100));
  };

  app.eventBus.on("scalechanged", ({ value }) => {
    remember(Number.isNaN(Number(value)) ? value : Math.round(Number(value) * 100));
  });

  const zoomReset = app.zoomReset;
  app.zoomReset = function (...args) {
    clearTimeout(timer);
    chrome.storage.local.remove(DEFAULT_ZOOM_KEY);
    zoomReset.apply(this, args);
  };
}
