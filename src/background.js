import { OPEN_TAB_PREFIX } from "./shared/storage-keys.js";

const VIEWER_URL = chrome.runtime.getURL("pdfjs/web/viewer.html");
const STARTUP_EVENT_WAIT_MS = 1000;

const redirectToViewer = { type: "redirect", redirect: { regexSubstitution: `${VIEWER_URL}?redirect:\\0` } };
const webRequests = {
  resourceTypes: ["main_frame"],
  excludedRequestMethods: ["post"], // The viewer re-fetches with GET and can't replay a POST.
  excludedResponseHeaders: [{ header: "content-disposition", values: ["attachment*"] }], // Downloads stay downloads.
};

const RULES = [
  {
    id: 1,
    priority: 1,
    action: redirectToViewer,
    condition: { regexFilter: "^file://.*\\.pdf([?#].*)?$", resourceTypes: ["main_frame"] },
  },
  {
    id: 2,
    priority: 1,
    action: redirectToViewer,
    condition: {
      ...webRequests,
      regexFilter: "^https?://.*$",
      responseHeaders: [{ header: "content-type", values: ["application/pdf", "application/pdf;*"] }],
    },
  },
  {
    id: 3,
    priority: 1,
    action: redirectToViewer,
    condition: {
      ...webRequests,
      regexFilter: "^https?://.*\\.pdf([?#].*)?$",
      responseHeaders: [{ header: "content-type", values: ["application/octet-stream", "application/octet-stream;*"] }],
    },
  },
];

let browserJustStarted = false;

chrome.runtime.onStartup.addListener(() => {
  browserJustStarted = true;
  forgetGoneTabs();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // The redirect target contains the extension id, so these can't be static rules.
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: RULES.map(rule => rule.id),
    addRules: RULES,
  });

  if (reason === "update") {
    await handleUpdate();
  } else {
    await forgetGoneTabs();
  }

  if (reason === "install" && !(await chrome.extension.isAllowedFileSchemeAccess())) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("popup/popup.html") });
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.local.remove(`${OPEN_TAB_PREFIX}${tabId}`);
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
});

// Chrome closes extension pages when an extension updates. A tab closed by the user has already
// lost its entry through onRemoved, so an entry without a tab means the update closed it.
//
// Updates are often applied at browser start, where Chrome restores tabs itself and reopening them
// here would duplicate them. onStartup may arrive after onInstalled, hence the wait.
async function handleUpdate() {
  await new Promise(resolve => setTimeout(resolve, STARTUP_EVENT_WAIT_MS));
  if (browserJustStarted) {
    await forgetGoneTabs();
  } else {
    await reopenGoneTabs();
  }
}

async function goneTabEntries() {
  const stored = await chrome.storage.local.get(null);
  const gone = [];
  for (const [key, entry] of Object.entries(stored)) {
    if (!key.startsWith(OPEN_TAB_PREFIX)) continue;
    const tabId = Number(key.slice(OPEN_TAB_PREFIX.length));
    const exists = await chrome.tabs.get(tabId).then(() => true, () => false);
    if (!exists) gone.push({ key, entry });
  }
  return gone;
}

async function forgetGoneTabs() {
  const gone = await goneTabEntries();
  await chrome.storage.local.remove(gone.map(({ key }) => key));
}

async function reopenGoneTabs() {
  const gone = await goneTabEntries();
  await chrome.storage.local.remove(gone.map(({ key }) => key));
  gone.sort((a, b) => a.entry.index - b.entry.index);

  const groups = new Map();
  for (const { entry } of gone) {
    // The source URL rather than the viewer's, so the redirect rules apply current permissions.
    const properties = { url: entry.source, active: false };
    const tab = await chrome.tabs.create({ ...properties, windowId: entry.windowId, index: entry.index })
      .catch(() => chrome.tabs.create(properties)); // The window closed along with its last tab.
    if (!entry.group) continue;
    if (!groups.has(entry.group.id)) groups.set(entry.group.id, { info: entry.group, tabs: [] });
    groups.get(entry.group.id).tabs.push(tab);
  }

  for (const { info, tabs } of groups.values()) {
    await restoreGroup(info, tabs).catch(error => console.warn("Could not restore tab group", error));
  }
}

async function restoreGroup(info, tabs) {
  const tabIds = tabs.map(tab => tab.id);
  const { windowId } = tabs[0];
  const survivor = await chrome.tabGroups.get(info.id).catch(() => null); // Survives if it held other tabs.
  if (survivor?.windowId === windowId) {
    await chrome.tabs.group({ groupId: info.id, tabIds });
    return;
  }
  const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  await chrome.tabGroups.update(groupId, { title: info.title, color: info.color, collapsed: info.collapsed });
}
