import { PAGE_NUMBERING_KEY } from "../shared/storage-keys.js";

const BOOK_MODE = "book";
const FILE_MODE = "file";

const isNumeric = label => /^\d+$/.test(label);

// PDFs can name pages ("Cover", "iv", "15") independently of their position in the file.
// The page box only ever holds digits:
//   file mode: N is the Nth page of the file.
//   book mode: N is the page printed as N, through PDF.js's label lookup given only numeric labels.
// A page's own name, when it adds something, appears beside the box.
export function pageNumbering(app) {
  const message = chrome.i18n.getMessage;
  const toggle = Object.assign(document.createElement("button"), { type: "button", id: "pageNumberingToggle", hidden: true });
  const hint = Object.assign(document.createElement("span"), { id: "pageLabelHint", hidden: true });
  document.getElementById("numPages").after(hint, toggle);

  const savedBookMode = chrome.storage.local.get(PAGE_NUMBERING_KEY)
    .then(stored => stored[PAGE_NUMBERING_KEY] === BOOK_MODE)
    .catch(() => false);
  let bookMode = false;
  let labels = null;

  const showHint = pageNumber => {
    const label = labels?.[pageNumber - 1] ?? "";
    const numeric = isNumeric(label);
    const redundant = !label || (numeric && (bookMode || Number(label) === pageNumber));
    hint.hidden = redundant;
    hint.textContent = redundant ? "" : numeric ? message("bookPageHint", label) : label;
    hint.title = hint.textContent;
  };

  const apply = () => {
    const { pdfViewer, pdfThumbnailViewer, toolbar, pagesCount } = app;
    const useLabels = Boolean(labels) && bookMode;
    pdfViewer.setPageLabels(useLabels ? labels.map(label => (isNumeric(label) ? label : "")) : null);
    pdfThumbnailViewer?.setPageLabels(useLabels ? labels : null);
    toolbar?.setPagesCount(pagesCount, useLabels);
    toolbar?.setPageNumber(pdfViewer.currentPageNumber, pdfViewer.currentPageLabel);
    toggle.textContent = message(bookMode ? "numberingBook" : "numberingFile");
    toggle.title = message(bookMode ? "numberingBookTooltip" : "numberingFileTooltip");
    showHint(pdfViewer.currentPageNumber);
  };

  toggle.addEventListener("click", () => {
    bookMode = !bookMode;
    chrome.storage.local.set({ [PAGE_NUMBERING_KEY]: bookMode ? BOOK_MODE : FILE_MODE });
    apply();
  });

  app.eventBus.on("pagesinit", async () => {
    const pdfDocument = app.pdfDocument;
    const [rawLabels, preferBookMode] = await Promise.all([pdfDocument.getPageLabels(), savedBookMode]);
    if (pdfDocument !== app.pdfDocument) return;
    labels = rawLabels?.some((label, i) => label && label !== String(i + 1)) ? rawLabels : null;
    // Book mode only means something if some printed number differs from the file position.
    const canToggle = Boolean(labels?.some((label, i) => isNumeric(label) && Number(label) !== i + 1));
    toggle.hidden = !canToggle;
    bookMode = canToggle && preferBookMode;
    apply();
  });
  app.eventBus.on("pagechanging", ({ pageNumber }) => showHint(pageNumber));
}
