import { OPEN_TAB_PREFIX, POSITION_PREFIX } from "../shared/storage-keys.js";

const MAX_ROWS = 50;

const message = chrome.i18n.getMessage;
const element = id => document.getElementById(id);

for (const [id, name] of [
  ["statDocumentsLabel", "statDocuments"],
  ["statFinishedLabel", "statFinished"],
  ["statPagesLabel", "statPages"],
  ["empty", "historyEmpty"],
  ["fileAccessText", "fileAccessNeeded"],
  ["fileAccessButton", "fileAccessOpen"],
]) {
  element(id).textContent = message(name);
}
element("search").placeholder = message("historySearch");
element("fileAccessButton").addEventListener("click", () => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});
chrome.extension.isAllowedFileSchemeAccess().then(allowed => {
  element("fileAccess").hidden = allowed;
});

function fileName(url) {
  try {
    const name = new URL(url).pathname.split("/").pop();
    return decodeURIComponent(name) || url;
  } catch {
    return url ?? "";
  }
}

const relativeTime = new Intl.RelativeTimeFormat(chrome.i18n.getUILanguage(), { numeric: "auto" });
function timeAgo(timestamp) {
  const minutes = Math.round((timestamp - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
  return relativeTime.format(Math.round(hours / 24), "day");
}

const isFinished = entry => entry.pages > 0 && entry.page >= entry.pages;

function renderStats(entries) {
  element("stats").hidden = entries.length === 0;
  element("statDocuments").textContent = entries.length;
  element("statFinished").textContent = entries.filter(isFinished).length;
  element("statPages").textContent = entries.reduce((sum, entry) => sum + (entry.page || 0), 0);
}

// Live viewers answer for themselves, since tab addresses are hidden without the "tabs" permission.
// A tab Chrome discarded to save memory can't answer, so its record is the best evidence available.
async function findOpenTab(url) {
  const answer = await chrome.runtime.sendMessage({ type: "find-viewer", source: url }).catch(() => null);
  if (answer?.tabId) return chrome.tabs.get(answer.tabId).catch(() => null);
  const stored = await chrome.storage.local.get(null);
  for (const [key, entry] of Object.entries(stored)) {
    if (!key.startsWith(OPEN_TAB_PREFIX) || entry.source !== url) continue;
    const tab = await chrome.tabs.get(Number(key.slice(OPEN_TAB_PREFIX.length))).catch(() => null);
    if (tab?.discarded) return tab;
  }
  return null;
}

async function openDocument(url) {
  const tab = await findOpenTab(url);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
}

function row(entry) {
  const item = document.createElement("li");
  item.className = "row";

  const open = Object.assign(document.createElement("button"), { type: "button", className: "open" });
  open.title = entry.url ?? message("historyNoLink");
  open.disabled = !entry.url; // Opened through "Open file", so there is no address to return to.
  open.addEventListener("click", () => openDocument(entry.url));

  const title = Object.assign(document.createElement("span"), { className: "title", textContent: entry.displayTitle });
  const position = entry.pages
    ? message("historyPosition", [String(entry.page), String(entry.pages)])
    : message("historyPositionNoTotal", String(entry.page));
  const when = entry.updatedAt ? ` · ${timeAgo(entry.updatedAt)}` : "";
  const meta = Object.assign(document.createElement("span"), { className: "meta", textContent: position + when });
  open.append(title, meta);

  if (entry.pages) {
    const bar = Object.assign(document.createElement("span"), { className: "bar" });
    const fill = document.createElement("i");
    fill.style.width = `${Math.min(100, (entry.page / entry.pages) * 100)}%`;
    bar.append(fill);
    open.append(bar);
  }

  const remove = Object.assign(document.createElement("button"), {
    type: "button",
    className: "remove",
    textContent: "×",
    title: message("historyRemove"),
  });
  remove.setAttribute("aria-label", `${message("historyRemove")}: ${entry.displayTitle}`);
  remove.addEventListener("click", async () => {
    await chrome.storage.local.remove(entry.key);
    all = all.filter(other => other.key !== entry.key);
    render();
  });

  item.append(open, remove);
  return item;
}

let all = [];

function render() {
  const query = element("search").value.trim().toLowerCase();
  const matches = query
    ? all.filter(entry => `${entry.displayTitle} ${entry.url ?? ""}`.toLowerCase().includes(query))
    : all;
  renderStats(all);
  element("search").hidden = all.length <= 5;
  element("history").replaceChildren(...matches.slice(0, MAX_ROWS).map(row));
  element("empty").hidden = matches.length > 0;
  element("clearHistory").hidden = all.length === 0;
}

element("search").addEventListener("input", render);

// A second click confirms, because this can't be undone.
const clearButton = element("clearHistory");
clearButton.textContent = message("historyClear");
clearButton.addEventListener("click", async () => {
  if (!clearButton.dataset.armed) {
    clearButton.dataset.armed = "true";
    clearButton.textContent = message("historyClearConfirm");
    return;
  }
  await chrome.storage.local.remove(all.map(entry => entry.key));
  all = [];
  render();
});

chrome.storage.local.get(null).then(stored => {
  all = Object.entries(stored)
    .filter(([key, value]) => key.startsWith(POSITION_PREFIX) && value.page && (value.title || value.url))
    .map(([key, value]) => ({ ...value, key, displayTitle: value.title || fileName(value.url) }))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  render();
});
