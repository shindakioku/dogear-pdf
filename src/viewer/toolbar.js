import { TOOLBAR_HIDDEN_KEY } from "../shared/storage-keys.js";

// Page controls go in the middle and zoom to the right. PDF.js finds elements by id, so moving them
// doesn't affect it.
export function arrangeToolbar() {
  const element = id => document.getElementById(id);
  const middle = element("toolbarViewerMiddle");
  const zoomControls = [...middle.children];
  middle.append(element("previous").parentElement, element("numPages").parentElement);
  element("toolbarViewerRight").prepend(...zoomControls);
}

function createButton(id, className, label, onClick) {
  const button = Object.assign(document.createElement("button"), { type: "button", id, className, title: label });
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

// While hidden, the bar comes back for as long as it's in use: pointer at the top edge, search or
// menu open, or a focused field.
export function hideableToolbar() {
  const root = document.documentElement;
  const message = chrome.i18n.getMessage;
  const toolbar = document.querySelector(".toolbar");
  const findbar = document.getElementById("findbar");
  const menu = document.getElementById("secondaryToolbar");
  let pointerOver = false;

  const syncPeek = () => {
    const typing = toolbar.contains(document.activeElement) && document.activeElement.matches("input, select");
    const panelOpen = !findbar.classList.contains("hidden") || !menu.classList.contains("hidden");
    root.classList.toggle("toolbarPeek", pointerOver || typing || panelOpen);
  };

  const applyHidden = hidden => {
    root.classList.toggle("toolbarHidden", hidden);
    pointerOver = false;
    syncPeek();
  };
  const setHidden = hidden => {
    applyHidden(hidden);
    chrome.storage.local.set({ [TOOLBAR_HIDDEN_KEY]: hidden });
  };

  // Beside the wrapper of the menu button and its panel; inside it, the button would wrap.
  document.getElementById("secondaryToolbarToggleButton").parentElement
    .before(createButton("hideToolbarButton", "toolbarButton", message("hideToolbar"), () => setHidden(true)));

  const showTab = createButton("showToolbarTab", "", message("showToolbar"), () => setHidden(false));
  showTab.textContent = "⌄";
  const revealZone = Object.assign(document.createElement("div"), { id: "toolbarRevealZone" });
  document.body.append(revealZone, showTab);

  const setPointerOver = over => () => {
    pointerOver = over;
    syncPeek();
  };
  revealZone.addEventListener("mouseenter", setPointerOver(true));
  toolbar.addEventListener("mouseenter", setPointerOver(true));
  toolbar.addEventListener("mouseleave", setPointerOver(false));
  toolbar.addEventListener("focusin", syncPeek);
  toolbar.addEventListener("focusout", () => setTimeout(syncPeek));

  const panelObserver = new MutationObserver(syncPeek);
  panelObserver.observe(findbar, { attributes: true, attributeFilter: ["class"] });
  panelObserver.observe(menu, { attributes: true, attributeFilter: ["class"] });

  addEventListener("keydown", event => {
    if (event.code !== "KeyT" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.target.matches?.("input, textarea, select") || event.target.isContentEditable) return;
    setHidden(!root.classList.contains("toolbarHidden"));
  });

  chrome.storage.local.get(TOOLBAR_HIDDEN_KEY).then(stored => {
    if (stored[TOOLBAR_HIDDEN_KEY]) applyHidden(true);
  });
}
