// Memo-Driven Highlighter 확장 프로그램의 백그라운드 스크립트입니다.
// 사용자가 웹페이지에서 텍스트를 선택한 뒤 우클릭하면, 선택한 텍스트를 저장하고 다른 화면에 알려줍니다.

// chrome.storage.local에 저장할 때 사용할 key 이름을 한곳에 모아둡니다.
const STORAGE_KEYS = {
  highlights: "highlights",
  pendingSelection: "pendingSelection",
};

// 우클릭 메뉴를 구분하기 위한 고유 ID입니다.
const CONTEXT_MENU_ID = "mdh-save-selection";

// 새 하이라이트를 만들 때 사용할 기본 배경색입니다.
const DEFAULT_COLOR = "#fff3a3";

// 확장 프로그램이 처음 설치되거나 업데이트될 때 실행됩니다.
chrome.runtime.onInstalled.addListener(() => {
  // 텍스트를 선택했을 때 나타나는 우클릭 메뉴를 만듭니다.
  createContextMenu();

  // 저장소에 highlights 배열이 없으면 빈 배열로 초기화합니다.
  ensureStorageShape();
});

// 브라우저가 시작될 때 저장소 구조가 올바른지 다시 확인합니다.
chrome.runtime.onStartup.addListener(() => {
  ensureStorageShape();
});

// 사용자가 우클릭 메뉴를 눌렀을 때 실행됩니다.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  // 우리가 만든 메뉴가 아니거나 선택된 텍스트가 없으면 아무 일도 하지 않습니다.
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.selectionText) {
    return;
  }

  // 선택한 텍스트의 앞뒤 공백과 여러 공백을 정리합니다.
  const keyword = normalizeKeyword(info.selectionText);

  // 정리한 뒤 빈 문자열이면 저장하지 않습니다.
  if (!keyword) {
    return;
  }

  // 지금 선택된 텍스트 정보를 임시 저장용 객체로 만듭니다.
  const pendingSelection = {
    keyword,
    sourceUrl: tab?.url || info.pageUrl || "",
    tabId: tab?.id || null,
    createdAt: new Date().toISOString(),
  };

  // 선택 정보를 chrome.storage.local에 저장합니다.
  chrome.storage.local.set(
    { [STORAGE_KEYS.pendingSelection]: pendingSelection },
    () => {
      // 팝업이나 사이드패널이 열려 있다면 선택 정보가 생겼다고 알려줍니다.
      notifyRuntime({
        type: "MDH_SELECTION_CAPTURED",
        payload: pendingSelection,
      });

      // 현재 탭에 content script가 있다면 선택 정보가 생겼다고 알려줍니다.
      notifyTab(tab?.id, {
        type: "MDH_SELECTION_CAPTURED",
        payload: pendingSelection,
      });
    },
  );
});

// 팝업, 사이드패널, content script 등 다른 확장 프로그램 화면에서 보낸 메시지를 받습니다.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 메시지 형식이 올바르지 않으면 처리하지 않습니다.
  if (!message || typeof message.type !== "string") {
    return false;
  }

  // 실제 메시지 처리는 handleMessage 함수에 맡깁니다.
  handleMessage(message, sender)
    .then((payload) => {
      // 처리가 성공하면 ok: true와 결과 데이터를 돌려줍니다.
      sendResponse({ ok: true, payload });
    })
    .catch((error) => {
      // 처리 중 오류가 나면 ok: false와 오류 메시지를 돌려줍니다.
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  // 비동기 응답을 보내기 위해 true를 반환합니다.
  return true;
});

// message.type 값에 따라 어떤 작업을 할지 나눠서 처리합니다.
async function handleMessage(message, sender) {
  switch (message.type) {
    case "MDH_GET_HIGHLIGHTS":
      return {
        highlights: await getHighlights()
      };

    case "MDH_CREATE_HIGHLIGHT":
      return {
        highlight: await createHighlight(message.payload, sender)
      };

    case "MDH_UPDATE_HIGHLIGHT":
      return {
        highlight: await updateHighlight(message.payload)
      };

    case "MDH_DELETE_HIGHLIGHT":
      await deleteHighlight(message.payload?.id);
      return { id: message.payload?.id };

    case "MDH_GET_PENDING_SELECTION":
      return {
        pendingSelection: await getPendingSelection()
      };

    case "MDH_CLEAR_PENDING_SELECTION":
      await setStorage({ [STORAGE_KEYS.pendingSelection]: null });
      return { pendingSelection: null };

    case "MDH_REFRESH_ACTIVE_TAB":
      await refreshActiveTab();
      return { refreshed: true };

    case "MDH_OPEN_SIDE_PANEL":
      await openSidePanel(message.payload?.tabId ?? sender.tab?.id);
      return { opened: true };

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// 웹페이지에서 텍스트를 드래그한 뒤 우클릭했을 때 보일 메뉴를 만듭니다.
function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "선택한 텍스트를 메모 하이라이트로 저장",
      contexts: ["selection"],
    });
  });
}

// 저장소에 highlights가 배열 형태로 준비되어 있는지 확인합니다.
async function ensureStorageShape() {
  const result = await getStorage([STORAGE_KEYS.highlights]);

  // highlights가 없거나 배열이 아니면 빈 배열로 새로 만듭니다.
  if (!Array.isArray(result[STORAGE_KEYS.highlights])) {
    await setStorage({ [STORAGE_KEYS.highlights]: [] });
  }
}

// 저장되어 있는 하이라이트 목록을 가져옵니다.
async function getHighlights() {
  const result = await getStorage([STORAGE_KEYS.highlights]);

  // 저장된 값이 배열이면 그대로 쓰고, 아니면 빈 배열을 돌려줍니다.
  return Array.isArray(result[STORAGE_KEYS.highlights])
    ? result[STORAGE_KEYS.highlights]
    : [];
}

// 새 하이라이트를 만들거나, 같은 키워드가 있으면 기존 하이라이트를 수정합니다.
async function createHighlight(payload = {}, sender = {}) {
  const keyword = normalizeKeyword(payload.keyword);

  // 키워드가 비어 있으면 저장할 수 없으므로 오류를 냅니다.
  if (!keyword) {
    throw new Error("키워드를 입력해 주세요.");
  }

  const now = new Date().toISOString();
  const highlights = await getHighlights();

  // 같은 키워드가 이미 저장되어 있는지 찾습니다. 대소문자는 구분하지 않습니다.
  const existingIndex = highlights.findIndex(
    (item) => item.keyword.trim().toLowerCase() === keyword.toLowerCase()
  );

  let savedHighlight;

  if (existingIndex >= 0) {
    // 이미 있는 키워드라면 기존 id와 생성일은 유지하고 나머지 값만 갱신합니다.
    savedHighlight = {
      ...highlights[existingIndex],
      memo: payload.memo ?? highlights[existingIndex].memo ?? "",
      sourceUrl: payload.sourceUrl ?? highlights[existingIndex].sourceUrl ?? sender.tab?.url ?? "",
      color: payload.color || highlights[existingIndex].color || DEFAULT_COLOR,
      isActive: typeof payload.isActive === "boolean"
        ? payload.isActive
        : highlights[existingIndex].isActive !== false,
      updatedAt: now
    };

    highlights[existingIndex] = savedHighlight;
  } else {
    // 처음 저장하는 키워드라면 새 id를 만들고 목록 맨 앞에 추가합니다.
    savedHighlight = {
      id: createId(),
      keyword,
      memo: payload.memo || "",
      sourceUrl: payload.sourceUrl || sender.tab?.url || "",
      color: payload.color || DEFAULT_COLOR,
      isActive: payload.isActive !== false,
      createdAt: now,
      updatedAt: now
    };

    highlights.unshift(savedHighlight);
  }

  // 바뀐 하이라이트 목록을 저장합니다.
  await setStorage({ [STORAGE_KEYS.highlights]: highlights });

  // 열려 있는 탭들에게 하이라이트 목록이 바뀌었다고 알려줍니다.
  await broadcastHighlightRefresh();

  return savedHighlight;
}

// 저장된 하이라이트 하나를 id 기준으로 수정합니다.
async function updateHighlight(payload = {}) {
  if (!payload.id) {
    throw new Error("수정할 하이라이트 id가 없습니다.");
  }

  const highlights = await getHighlights();
  const targetIndex = highlights.findIndex((item) => item.id === payload.id);

  // 수정할 대상이 없으면 오류를 냅니다.
  if (targetIndex === -1) {
    throw new Error("수정할 하이라이트를 찾을 수 없습니다.");
  }

  const current = highlights[targetIndex];
  const nextKeyword = payload.keyword === undefined
    ? current.keyword
    : normalizeKeyword(payload.keyword);

  if (!nextKeyword) {
    throw new Error("키워드를 입력해 주세요.");
  }

  // payload에 들어온 값만 새 값으로 바꾸고, 없는 값은 기존 값을 유지합니다.
  const updatedHighlight = {
    ...current,
    keyword: nextKeyword,
    memo: payload.memo === undefined ? current.memo : payload.memo,
    sourceUrl: payload.sourceUrl === undefined ? current.sourceUrl : payload.sourceUrl,
    color: payload.color || current.color || DEFAULT_COLOR,
    isActive: typeof payload.isActive === "boolean" ? payload.isActive : current.isActive !== false,
    updatedAt: new Date().toISOString()
  };

  highlights[targetIndex] = updatedHighlight;

  await setStorage({ [STORAGE_KEYS.highlights]: highlights });
  await broadcastHighlightRefresh();

  return updatedHighlight;
}

// 저장된 하이라이트 하나를 id 기준으로 삭제합니다.
async function deleteHighlight(id) {
  if (!id) {
    throw new Error("삭제할 하이라이트 id가 없습니다.");
  }

  const highlights = await getHighlights();

  // 삭제할 id와 다른 항목만 남겨서 새 목록을 만듭니다.
  const nextHighlights = highlights.filter((item) => item.id !== id);

  await setStorage({ [STORAGE_KEYS.highlights]: nextHighlights });
  await broadcastHighlightRefresh();
}

// 우클릭으로 선택했지만 아직 정식 저장하지 않은 임시 선택 정보를 가져옵니다.
async function getPendingSelection() {
  const result = await getStorage([STORAGE_KEYS.pendingSelection]);
  return result[STORAGE_KEYS.pendingSelection] || null;
}

// 현재 활성 탭에 하이라이트를 다시 그리라고 요청합니다.
async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await notifyTab(tab?.id, { type: "MDH_REFRESH_HIGHLIGHTS" });
}

// 메시지를 보낼 수 있는 모든 탭에 하이라이트 새로고침 메시지를 보냅니다.
async function broadcastHighlightRefresh() {
  const tabs = await chrome.tabs.query({});

  await Promise.all(
    tabs
      .filter((tab) => canMessageTab(tab))
      .map((tab) => notifyTab(tab.id, { type: "MDH_REFRESH_HIGHLIGHTS" }))
  );
}

// 가능하면 현재 탭에서 크롬 사이드패널을 엽니다.
async function openSidePanel(tabId) {
  if (!tabId || !chrome.sidePanel?.open) {
    return;
  }

  await chrome.sidePanel.open({ tabId });
}

// chrome.storage.local.get을 Promise 형태로 감싸서 async/await로 쓰기 쉽게 만듭니다.
function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

// chrome.storage.local.set을 Promise 형태로 감싸서 async/await로 쓰기 쉽게 만듭니다.
function setStorage(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

// 확장 프로그램 내부의 다른 화면, 예를 들어 팝업이나 사이드패널에 메시지를 보냅니다.
function notifyRuntime(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // 현재 메시지를 받을 팝업이나 사이드패널이 없으면 조용히 무시합니다.
  });
}

// 특정 탭의 content script에 메시지를 보냅니다.
function notifyTab(tabId, message) {
  if (!tabId) {
    return Promise.resolve();
  }

  return chrome.tabs.sendMessage(tabId, message).catch(() => {
    // chrome:// 페이지처럼 메시지를 보낼 수 없는 탭이면 조용히 무시합니다.
  });
}

// 이 탭에 메시지를 보내도 되는지 확인합니다.
function canMessageTab(tab) {
  return Boolean(
    tab?.id &&
      tab.url &&
      /^(https?:|file:)/.test(tab.url)
  );
}

// 입력된 키워드를 문자열로 바꾸고 공백을 보기 좋게 정리합니다.
function normalizeKeyword(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

// 하이라이트마다 겹치지 않는 id를 만들기 위한 함수입니다.
function createId() {
  return `hl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}