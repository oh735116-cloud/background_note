//이해못한거 주석처리

const STORAGE_KEYS = {
  highlights: "highlights",
  pendingSelection: "pendingSelection",
}; // 키를 정의한 객체

const CONTEXT_MENU_ID = "mdh-save-selection"; // context menu 고유ID, 프로그램이 선택한 텍스트
const DEFAULT_COLOR = "#fff3a3"; // 기본하이라이트색

chrome.runtime.onInstalled.addListener(() => {
  // 확장 프로그램이 설치되거나 업데이트될 때마다 실행되는 이벤트 리스너입니다. 이 이벤트는 확장 프로그램이 처음 설치될 때뿐만 아니라 업데이트될 때도 발생합니다. 따라서 이 리스너는 확장 프로그램의 초기 설정을 수행하는 데 적합합니다.
  createContextMenu(); // 확장 프로그램이 설치되거나 업데이트될 때마다 컨텍스트 메뉴를 생성하는 함수를 호출합니다. 이 함수는 사용자가 웹 페이지에서 텍스트를 선택했을 때 나타나는 메뉴에 "선택한 텍스트를 메모 하이라이트로 저장" 옵션을 추가합니다.
  ensureStorageShape(); // 확장 프로그램이 설치되거나 업데이트될 때마다 스토리지의 초기 구조를 보장하는 함수를 호출합니다. 이 함수는 스토리지에 "highlights" 키가 배열 형태로 존재하는지 확인하고, 존재하지 않거나 올바른 형태가 아니면 초기값으로 빈 배열을 설정합니다. 이를 통해 확장 프로그램이 예상하는 데이터 구조를 유지할 수 있습니다.
});

chrome.runtime.onStartup.addListener(() => {
  ensureStorageShape(); // 브라우저가 시작할때 불러오는 함수
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.selectionText) {
    return;
  } // 117번 라인에서 정의한 함수와 선택된 텍스트가 없으면 종료

  const keyword = normalizeKeyword(info.selectionText); // 선택된 택스트를 정규화하는 함수 (공백제거 ,대소문자구분)

  if (!keyword) {
    return;
  } // 26번 라인이 빈문자열이면 종료

  const pendingSelection = {
    keyword, // 선택된 텍스트
    sourceUrl: tab?.url || info.pageUrl || "", // 선택된 텍스트 url가져오기, 탭의 url없으면 info(현재페이지).pageUrl(의url), 없으면 빈문자열
    tabId: tab?.id || null, // 탭의 id 가져오기 없으면 null(널)
    createdAt: new Date().toISOString(), // to/ISO/String 날자를 문자열로 바꿔줌
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
}); //

// chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
//   if (!message || typeof message.type !== "string") {
//     return false;
//   }

//   handleMessage(message, sender)
//     .then((payload) => {
//       sendResponse({ ok: true, payload });
//     })
//     .catch((error) => {
//       sendResponse({
//         ok: false,
//         error: error instanceof Error ? error.message : String(error)
//       });
//     });

//   return true;
// });

// async function handleMessage(message, sender) {
//   switch (message.type) {
//     case "MDH_GET_HIGHLIGHTS":
//       return {
//         highlights: await getHighlights()
//       };

//     case "MDH_CREATE_HIGHLIGHT":
//       return {
//         highlight: await createHighlight(message.payload, sender)
//       };

//     case "MDH_UPDATE_HIGHLIGHT":
//       return {
//         highlight: await updateHighlight(message.payload)
//       };

//     case "MDH_DELETE_HIGHLIGHT":
//       await deleteHighlight(message.payload?.id);
//       return { id: message.payload?.id };

//     case "MDH_GET_PENDING_SELECTION":
//       return {
//         pendingSelection: await getPendingSelection()
//       };

//     case "MDH_CLEAR_PENDING_SELECTION":
//       await setStorage({ [STORAGE_KEYS.pendingSelection]: null });
//       return { pendingSelection: null };

//     case "MDH_REFRESH_ACTIVE_TAB":
//       await refreshActiveTab();
//       return { refreshed: true };

//     case "MDH_OPEN_SIDE_PANEL":
//       await openSidePanel(message.payload?.tabId ?? sender.tab?.id);
//       return { opened: true };

//     default:
//       throw new Error(`Unknown message type: ${message.type}`);
//   }
// }

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "선택한 텍스트를 메모 하이라이트로 저장",
      contexts: ["selection"],
    });
  });
} // 선택한 텍스트 하이라이트저장하는 컨텍스메뉴생성함수

async function ensureStorageShape() {
  const result = await getStorage([STORAGE_KEYS.highlights]);

  if (!Array.isArray(result[STORAGE_KEYS.highlights])) {
    await setStorage({ [STORAGE_KEYS.highlights]: [] });
  }
} // 웹 스토리지에 저장하는 함수 배열형태로 저장하는 함수,[]

// async function getHighlights() {
//   const result = await getStorage([STORAGE_KEYS.highlights]);
//   return Array.isArray(result[STORAGE_KEYS.highlights])
//     ? result[STORAGE_KEYS.highlights]
//     : [];
// }

// async function createHighlight(payload = {}, sender = {}) {
//   const keyword = normalizeKeyword(payload.keyword);

//   if (!keyword) {
//     throw new Error("키워드를 입력해 주세요.");
//   }

//   const now = new Date().toISOString();
//   const highlights = await getHighlights();
//   const existingIndex = highlights.findIndex(
//     (item) => item.keyword.trim().toLowerCase() === keyword.toLowerCase()
//   );

//   let savedHighlight;

//   if (existingIndex >= 0) {
//     savedHighlight = {
//       ...highlights[existingIndex],
//       memo: payload.memo ?? highlights[existingIndex].memo ?? "",
//       sourceUrl: payload.sourceUrl ?? highlights[existingIndex].sourceUrl ?? sender.tab?.url ?? "",
//       color: payload.color || highlights[existingIndex].color || DEFAULT_COLOR,
//       isActive: typeof payload.isActive === "boolean"
//         ? payload.isActive
//         : highlights[existingIndex].isActive !== false,
//       updatedAt: now
//     };

//     highlights[existingIndex] = savedHighlight;
//   } else {
//     savedHighlight = {
//       id: createId(),
//       keyword,
//       memo: payload.memo || "",
//       sourceUrl: payload.sourceUrl || sender.tab?.url || "",
//       color: payload.color || DEFAULT_COLOR,
//       isActive: payload.isActive !== false,
//       createdAt: now,
//       updatedAt: now
//     };

//     highlights.unshift(savedHighlight);
//   }

//   await setStorage({ [STORAGE_KEYS.highlights]: highlights });
//   await broadcastHighlightRefresh();

//   return savedHighlight;
// }

// async function updateHighlight(payload = {}) {
//   if (!payload.id) {
//     throw new Error("수정할 하이라이트 id가 없습니다.");
//   }

//   const highlights = await getHighlights();
//   const targetIndex = highlights.findIndex((item) => item.id === payload.id);

//   if (targetIndex === -1) {
//     throw new Error("수정할 하이라이트를 찾을 수 없습니다.");
//   }

//   const current = highlights[targetIndex];
//   const nextKeyword = payload.keyword === undefined
//     ? current.keyword
//     : normalizeKeyword(payload.keyword);

//   if (!nextKeyword) {
//     throw new Error("키워드를 입력해 주세요.");
//   }

//   const updatedHighlight = {
//     ...current,
//     keyword: nextKeyword,
//     memo: payload.memo === undefined ? current.memo : payload.memo,
//     sourceUrl: payload.sourceUrl === undefined ? current.sourceUrl : payload.sourceUrl,
//     color: payload.color || current.color || DEFAULT_COLOR,
//     isActive: typeof payload.isActive === "boolean" ? payload.isActive : current.isActive !== false,
//     updatedAt: new Date().toISOString()
//   };

//   highlights[targetIndex] = updatedHighlight;

//   await setStorage({ [STORAGE_KEYS.highlights]: highlights });
//   await broadcastHighlightRefresh();

//   return updatedHighlight;
// }

// async function deleteHighlight(id) {
//   if (!id) {
//     throw new Error("삭제할 하이라이트 id가 없습니다.");
//   }

//   const highlights = await getHighlights();
//   const nextHighlights = highlights.filter((item) => item.id !== id);

//   await setStorage({ [STORAGE_KEYS.highlights]: nextHighlights });
//   await broadcastHighlightRefresh();
// }

// async function getPendingSelection() {
//   const result = await getStorage([STORAGE_KEYS.pendingSelection]);
//   return result[STORAGE_KEYS.pendingSelection] || null;
// }

// async function refreshActiveTab() {
//   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
//   await notifyTab(tab?.id, { type: "MDH_REFRESH_HIGHLIGHTS" });
// }

// async function broadcastHighlightRefresh() {
//   const tabs = await chrome.tabs.query({});
//   await Promise.all(
//     tabs
//       .filter((tab) => canMessageTab(tab))
//       .map((tab) => notifyTab(tab.id, { type: "MDH_REFRESH_HIGHLIGHTS" }))
//   );
// }

// async function openSidePanel(tabId) {
//   if (!tabId || !chrome.sidePanel?.open) {
//     return;
//   }

//   await chrome.sidePanel.open({ tabId });
// }

// function getStorage(keys) {
//   return new Promise((resolve) => {
//     chrome.storage.local.get(keys, resolve);
//   });
// }

// function setStorage(data) {
//   return new Promise((resolve) => {
//     chrome.storage.local.set(data, resolve);
//   });
// }

// function notifyRuntime(message) {
//   chrome.runtime.sendMessage(message).catch(() => {
//     // No popup or sidepanel is currently listening.
//   });
// }

// function notifyTab(tabId, message) {
//   if (!tabId) {
//     return Promise.resolve();
//   }

//   return chrome.tabs.sendMessage(tabId, message).catch(() => {
//     // Content script may not be available on chrome:// pages or restricted URLs.
//   });
// }

// function canMessageTab(tab) {
//   return Boolean(
//     tab?.id &&
//       tab.url &&
//       /^(https?:|file:)/.test(tab.url)
//   );
// }

// function normalizeKeyword(value) {
//   return String(value || "")
//     .replace(/\s+/g, " ")
//     .trim();
// }

// function createId() {
//   return `hl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
// }
