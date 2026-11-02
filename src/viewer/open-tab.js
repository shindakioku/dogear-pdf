import { OPEN_TAB_PREFIX } from "../shared/storage-keys.js";

// Lets the popup switch to this tab instead of opening the PDF twice.
export function answerPopup(source) {
  chrome.runtime.onMessage.addListener((request, _sender, respond) => {
    if (request.type !== "find-viewer" || request.source !== source) return false;
    chrome.tabs.getCurrent().then(tab => respond({ tabId: tab.id }));
    return true;
  });
}

// Records what background.js needs to reopen this tab if an update closes it. Each viewer watches
// its own tab so that the worker doesn't wake on every tab change in the browser.
export async function trackOpenTab(source) {
  if (chrome.extension.inIncognitoContext) return;
  const NO_GROUP = chrome.tabGroups.TAB_GROUP_ID_NONE;
  const { id: tabId } = await chrome.tabs.getCurrent();
  let groupId = NO_GROUP;

  const record = async () => {
    const tab = await chrome.tabs.getCurrent();
    groupId = tab.groupId;
    const group = groupId === NO_GROUP ? null : await chrome.tabGroups.get(groupId).catch(() => null);
    await chrome.storage.local.set({
      [`${OPEN_TAB_PREFIX}${tabId}`]: {
        source,
        windowId: tab.windowId,
        index: tab.index,
        group: group && { id: group.id, title: group.title, color: group.color, collapsed: group.collapsed },
      },
    });
  };

  chrome.tabs.onUpdated.addListener((updatedId, change) => {
    if (updatedId === tabId && "groupId" in change) record();
  });
  chrome.tabs.onMoved.addListener(movedId => {
    if (movedId === tabId) record();
  });
  chrome.tabs.onAttached.addListener(attachedId => {
    if (attachedId === tabId) record();
  });
  chrome.tabGroups.onUpdated.addListener(group => {
    if (group.id === groupId) record();
  });
  await record();
}
