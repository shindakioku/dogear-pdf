// For the rare PDF this viewer can't load: lets this tab use Chrome's viewer for that URL.
async function openInChromeViewer(source) {
  const { id: tabId } = await chrome.tabs.getCurrent();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: [{
      id: tabId,
      priority: 2,
      action: { type: "allow" },
      condition: { urlFilter: `|${source}|`, tabIds: [tabId], resourceTypes: ["main_frame"] },
    }],
  });
  await chrome.tabs.update(tabId, { url: source });
}

function createButton(id, className, source) {
  const button = Object.assign(document.createElement("button"), { type: "button", id, className });
  const label = Object.assign(document.createElement("span"), { textContent: chrome.i18n.getMessage("openInChromeViewer") });
  button.append(label);
  button.addEventListener("click", () => openInChromeViewer(source));
  return button;
}

export function addFallbackMenuItem(source) {
  document.getElementById("secondaryToolbarButtonContainer")
    .append(createButton("openInChromeViewer", "toolbarButton labeled", source));
}

export function showFallbackBanner(source) {
  document.body.append(createButton("openInChromeViewerBanner", "", source));
}
