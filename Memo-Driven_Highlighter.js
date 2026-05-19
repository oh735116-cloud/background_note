const STORAGE_KEYS = {
  highlights: "highlights",
  pendingSelection: "pendingSelection",
};

const CONTEXT_MENU_ID = "mdh-save-selection";

enableSidePanelOnActionClick();

chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
  ensureStorageShape();
  enableSidePanelOnActionClick();
});

chrome.runtime.onStartup.addListener(() => {
  ensureStorageShape();
  enableSidePanelOnActionClick();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "MDH_OPEN_SIDE_PANEL") {
    return false;
  }

  openSidePanel(sender.tab?.id)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error?.message || String(error),
      });
    });

  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.selectionText) {
    return;
  }

  const keyword = normalizeKeyword(info.selectionText);

  if (!keyword) {
    return;
  }

  const pendingSelection = {
    keyword,
    sourceUrl: tab?.url || info.pageUrl || "",
    tabId: tab?.id || null,
    createdAt: new Date().toISOString(),
  };

  chrome.storage.local.set(
    { [STORAGE_KEYS.pendingSelection]: pendingSelection },
    () => {
      notifyRuntime({
        type: "MDH_SELECTION_CAPTURED",
        payload: pendingSelection,
      });

      notifyTab(tab?.id, {
        type: "MDH_SELECTION_CAPTURED",
        payload: pendingSelection,
      });
    },
  );
});

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "선택한 텍스트를 메모 하이라이트로 저장",
      contexts: ["selection"],
    });
  });
}

async function ensureStorageShape() {
  const result = await getStorage([STORAGE_KEYS.highlights]);

  if (!Array.isArray(result[STORAGE_KEYS.highlights])) {
    await setStorage({ [STORAGE_KEYS.highlights]: [] });
  }
}

function enableSidePanelOnActionClick() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }

  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      // Older Chrome versions may not support action-click side panel behavior.
    });
}

async function openSidePanel(tabId) {
  if (!tabId || !chrome.sidePanel?.open) {
    throw new Error("Side panel API is not available.");
  }

  await chrome.sidePanel.open({ tabId });
}

function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function setStorage(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

function notifyRuntime(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // No extension UI is currently listening.
  });
}

function notifyTab(tabId, message) {
  if (!tabId) {
    return Promise.resolve();
  }

  return chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Content script may not be available on restricted pages.
  });
}

function normalizeKeyword(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}
