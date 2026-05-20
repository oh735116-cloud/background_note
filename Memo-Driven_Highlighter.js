// ============================================================
// 상수와 기본 설정
// ============================================================

// Chrome storage에서 사용하는 키
const STORAGE_KEYS = {
  highlights: "highlights",
  pendingSelection: "pendingSelection",
};

// 컨텍스트 메뉴 id와 새 하이라이트의 기본 색상
const CONTEXT_MENU_ID = "mdh-save-selection";
const DEFAULT_COLOR = "#fff3a3";

enableSidePanelOnActionClick();

// ============================================================
// 확장 프로그램 생명주기
// ============================================================

// 설치/업데이트 시 컨텍스트 메뉴와 storage 구조를 준비한다.
chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
  ensureStorageShape();
  enableSidePanelOnActionClick();
});

// 브라우저가 다시 시작될 때도 최소 상태를 보장한다.
chrome.runtime.onStartup.addListener(() => {
  ensureStorageShape();
  enableSidePanelOnActionClick();
});

// ============================================================
// 컨텍스트 메뉴: 선택 텍스트 가져오기
// ============================================================

// 사용자가 우클릭 메뉴를 누르면 선택한 텍스트를 임시 키워드로 저장하고 content script에 알린다.
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
      notifyTab(tab?.id, {
        type: "MDH_SELECTION_CAPTURED",
        payload: pendingSelection,
      });
    },
  );
});

// ============================================================
// runtime 메시지 라우터
// ============================================================

// sidepanel, 위젯, content script가 보내는 요청을 한곳에서 처리한다.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  handleMessage(message, sender)
    .then((payload) => {
      sendResponse({ ok: true, payload });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return true;
});

// 메시지 type별로 storage CRUD, 탭 새로고침, 사이드패널 열기를 수행한다.
async function handleMessage(message, sender) {
  switch (message.type) {
    case "MDH_GET_HIGHLIGHTS":
      return {
        highlights: await getHighlights(),
      };

    case "MDH_CREATE_HIGHLIGHT":
      return {
        highlight: await createHighlight(message.payload, sender),
      };

    case "MDH_UPDATE_HIGHLIGHT":
      return {
        highlight: await updateHighlight(message.payload),
      };

    case "MDH_DELETE_HIGHLIGHT":
      await deleteHighlight(message.payload?.id);
      return { id: message.payload?.id };

    case "MDH_GET_PENDING_SELECTION":
      return {
        pendingSelection: await getPendingSelection(),
      };

    case "MDH_CLEAR_PENDING_SELECTION":
      await setStorage({ [STORAGE_KEYS.pendingSelection]: null });
      return { pendingSelection: null };

    case "MDH_REFRESH_ACTIVE_TAB":
      await refreshActiveTab();
      return { refreshed: true };

    case "MDH_OPEN_SIDE_PANEL":
      await openSidePanel(message.payload, sender.tab);
      return { opened: true };

    case "MDH_CLOSE_SIDE_PANEL":
      await closeSidePanel(message.payload, sender.tab);
      return { closed: true };

    case "MDH_NOTIFY_HIGHLIGHT_SAVED":
      await showHighlightSavedNotification(message.payload);
      return { notified: true };

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ============================================================
// 초기 설정
// ============================================================

// 선택 텍스트를 메모 키워드로 가져오는 우클릭 메뉴를 만든다.
function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "선택한 텍스트를 메모 하이라이트로 저장",
      contexts: ["selection"],
    });
  });
}

// highlights가 항상 배열 형태로 존재하도록 보정한다.
async function ensureStorageShape() {
  const result = await getStorage([STORAGE_KEYS.highlights]);

  if (!Array.isArray(result[STORAGE_KEYS.highlights])) {
    await setStorage({ [STORAGE_KEYS.highlights]: [] });
  }
}

// 확장 아이콘 클릭 시 팝업 대신 사이드패널이 열리도록 설정한다.
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

// ============================================================
// 하이라이트 데이터 관리
// ============================================================

// 저장된 하이라이트 목록을 읽고, 값이 없거나 잘못되면 빈 배열을 반환한다.
async function getHighlights() {
  const result = await getStorage([STORAGE_KEYS.highlights]);
  return Array.isArray(result[STORAGE_KEYS.highlights])
    ? result[STORAGE_KEYS.highlights]
    : [];
}

// 새 하이라이트를 저장한다. 같은 키워드가 있으면 기존 항목을 갱신한다.
async function createHighlight(payload = {}, sender = {}) {
  const keyword = normalizeKeyword(payload.keyword);

  if (!keyword) {
    throw new Error("키워드를 입력해 주세요.");
  }

  const now = new Date().toISOString();
  const highlights = await getHighlights();
  const existingIndex = highlights.findIndex(
    (item) =>
      normalizeKeyword(item.keyword).toLowerCase() === keyword.toLowerCase(),
  );

  let savedHighlight;

  // 기존 항목은 id/createdAt을 유지하고 내용만 갱신한다.
  if (existingIndex >= 0) {
    savedHighlight = {
      ...highlights[existingIndex],
      memo: payload.memo ?? highlights[existingIndex].memo ?? "",
      sourceUrl:
        payload.sourceUrl ??
        highlights[existingIndex].sourceUrl ??
        sender.tab?.url ??
        "",
      color: payload.color || highlights[existingIndex].color || DEFAULT_COLOR,
      isActive:
        typeof payload.isActive === "boolean"
          ? payload.isActive
          : highlights[existingIndex].isActive !== false,
      updatedAt: now,
    };

    highlights[existingIndex] = savedHighlight;
  } else {
    // 새 항목은 최신 목록 맨 앞에 넣는다.
    savedHighlight = {
      id: createId(),
      keyword,
      memo: payload.memo || "",
      sourceUrl: payload.sourceUrl || sender.tab?.url || "",
      color: payload.color || DEFAULT_COLOR,
      isActive: payload.isActive !== false,
      createdAt: now,
      updatedAt: now,
    };

    highlights.unshift(savedHighlight);
  }

  await setStorage({ [STORAGE_KEYS.highlights]: highlights });
  await broadcastHighlightRefresh();
  await showHighlightSavedNotification(savedHighlight);

  return savedHighlight;
}

// id로 기존 하이라이트를 찾아 수정한다.
async function showHighlightSavedNotification(highlight = {}) {
  if (!chrome.notifications?.create) {
    return;
  }

  const keyword = normalizeKeyword(highlight.keyword) || "메모";
  const memo = String(highlight.memo || "").trim();

  await chrome.notifications.create(`mdh-saved-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon/icon-128x128.png"),
    title: "메모 하이라이트 저장됨",
    message: memo
      ? `${truncateText(keyword, 32)}: ${truncateText(memo, 72)}`
      : `${truncateText(keyword, 72)} 저장 완료`,
    priority: 1,
  });
}

async function updateHighlight(payload = {}) {
  if (!payload.id) {
    throw new Error("수정할 하이라이트 id가 없습니다.");
  }

  const highlights = await getHighlights();
  const targetIndex = highlights.findIndex((item) => item.id === payload.id);

  if (targetIndex === -1) {
    throw new Error("수정할 하이라이트를 찾을 수 없습니다.");
  }

  const current = highlights[targetIndex];
  const nextKeyword =
    payload.keyword === undefined
      ? current.keyword
      : normalizeKeyword(payload.keyword);

  if (!nextKeyword) {
    throw new Error("키워드를 입력해 주세요.");
  }

  const updatedHighlight = {
    ...current,
    keyword: nextKeyword,
    memo: payload.memo === undefined ? current.memo : payload.memo,
    sourceUrl:
      payload.sourceUrl === undefined ? current.sourceUrl : payload.sourceUrl,
    color: payload.color || current.color || DEFAULT_COLOR,
    isActive:
      typeof payload.isActive === "boolean"
        ? payload.isActive
        : current.isActive !== false,
    updatedAt: new Date().toISOString(),
  };

  highlights[targetIndex] = updatedHighlight;

  await setStorage({ [STORAGE_KEYS.highlights]: highlights });
  await broadcastHighlightRefresh();

  return updatedHighlight;
}

// id에 해당하는 하이라이트를 삭제한다.
async function deleteHighlight(id) {
  if (!id) {
    throw new Error("삭제할 하이라이트 id가 없습니다.");
  }

  const highlights = await getHighlights();
  const nextHighlights = highlights.filter((item) => item.id !== id);

  await setStorage({ [STORAGE_KEYS.highlights]: nextHighlights });
  await broadcastHighlightRefresh();
}

// 컨텍스트 메뉴로 가져온 임시 선택 텍스트를 읽는다.
async function getPendingSelection() {
  const result = await getStorage([STORAGE_KEYS.pendingSelection]);
  return result[STORAGE_KEYS.pendingSelection] || null;
}

// ============================================================
// 탭/사이드패널 동기화
// ============================================================

// 현재 활성 탭에 하이라이트를 다시 그리라고 알린다.
async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await notifyTab(tab?.id, { type: "MDH_REFRESH_HIGHLIGHTS" });
}

// 모든 일반 웹 탭에 하이라이트 새로고침 메시지를 보낸다.
async function broadcastHighlightRefresh() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => canMessageTab(tab))
      .map((tab) => notifyTab(tab.id, { type: "MDH_REFRESH_HIGHLIGHTS" })),
  );
}

// 특정 탭 기준으로 사이드패널을 연다.
async function openSidePanel(payload = {}, tab = {}) {
  if (!chrome.sidePanel?.open) {
    throw new Error(
      "This Chrome version does not support opening side panels.",
    );
  }

  const tabId = payload?.tabId ?? tab?.id;
  const windowId = payload?.windowId ?? tab?.windowId;

  if (tabId) {
    await chrome.sidePanel.open({ tabId });

    if (chrome.sidePanel?.setOptions) {
      await chrome.sidePanel
        .setOptions({
          tabId,
          path: "sidepanel.html",
          enabled: true,
        })
        .catch(() => {});
    }

    return;
  }

  if (windowId) {
    await chrome.sidePanel.open({ windowId });
    return;
  }

  throw new Error("Cannot find a tab or window for the side panel.");
}

async function closeSidePanel(payload = {}, tab = {}) {
  if (!chrome.sidePanel?.close) {
    return;
  }

  const tabId = payload?.tabId ?? tab?.id;
  const windowId = payload?.windowId ?? tab?.windowId;

  if (windowId) {
    await chrome.sidePanel.close({ windowId });
    return;
  }

  if (tabId) {
    await chrome.sidePanel.close({ tabId });
    return;
  }
}

// ============================================================
// 공통 유틸리티
// ============================================================

// chrome.storage.local.get을 Promise로 감싸 async/await에서 쓰기 쉽게 만든다.
function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

// chrome.storage.local.set을 Promise로 감싸 저장 완료 후 다음 작업을 이어갈 수 있게 한다.
function setStorage(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

// 특정 탭의 content script로 메시지를 보낸다.
function notifyTab(tabId, message) {
  if (!tabId) {
    return Promise.resolve();
  }

  return chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Content script may not be available on chrome:// pages or restricted URLs.
  });
}

// content script가 주입되는 http/https 탭만 메시지 대상으로 삼는다.
function canMessageTab(tab) {
  return Boolean(tab?.id && tab.url && /^https?:/.test(tab.url));
}

// 키워드 앞뒤 공백과 연속 공백을 정리한다.
function normalizeKeyword(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

// storage에 저장할 하이라이트 id를 만든다.
function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function createId() {
  return `hl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
