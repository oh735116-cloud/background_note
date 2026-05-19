// ============================================================
// 상수와 DOM 참조
// ============================================================

// Chrome storage에서 사용하는 키
const STORAGE_KEYS = {
  highlights: "highlights",
  pendingSelection: "pendingSelection",
  siteSettings: "siteSettings",
};

const DEFAULT_COLOR = "#fff3a3";

// 사이드패널 화면에서 자주 사용하는 DOM 요소를 모아 둔다.
const elements = {
  form: document.getElementById("highlightForm"),
  id: document.getElementById("highlightId"),
  keyword: document.getElementById("keywordInput"),
  memo: document.getElementById("memoInput"),
  color: document.getElementById("colorInput"),
  active: document.getElementById("activeInput"),
  list: document.getElementById("highlightList"),
  count: document.getElementById("countLabel"),
  reset: document.getElementById("resetButton"),
  siteLabel: document.getElementById("currentSiteLabel"),
  siteToggle: document.getElementById("siteToggleButton"),
  notice: document.getElementById("noticeText"),
};

let highlights = [];
let siteSettings = {};
let currentSiteKey = "";
let currentSiteUrl = "";

init();

// ============================================================
// 초기 실행과 이벤트 연결
// ============================================================

// 현재 탭과 storage 상태를 읽고 화면을 처음 그린 뒤 이벤트를 연결한다.
async function init() {
  const activeTab = await getActiveTab();
  currentSiteUrl = activeTab?.url || "";
  currentSiteKey = getSiteKey(currentSiteUrl);

  const stored = await getStorageValues([
    STORAGE_KEYS.highlights,
    STORAGE_KEYS.siteSettings,
    STORAGE_KEYS.pendingSelection,
  ]);

  highlights = Array.isArray(stored[STORAGE_KEYS.highlights])
    ? stored[STORAGE_KEYS.highlights]
    : [];
  siteSettings = stored[STORAGE_KEYS.siteSettings] || {};

  // 현재 상태를 화면에 반영한다.
  renderSiteControl();
  renderHighlights();
  loadPendingSelection(stored[STORAGE_KEYS.pendingSelection]);

  // 폼, 목록 버튼, 현재 사이트 토글을 연결한다.
  elements.form.addEventListener("submit", handleSubmit);
  elements.reset.addEventListener("click", resetForm);
  elements.list.addEventListener("click", handleListClick);
  elements.siteToggle?.addEventListener("click", toggleCurrentSite);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[STORAGE_KEYS.highlights]) {
      highlights = Array.isArray(changes[STORAGE_KEYS.highlights].newValue)
        ? changes[STORAGE_KEYS.highlights].newValue
        : [];
      renderHighlights();
    }

    if (changes[STORAGE_KEYS.siteSettings]) {
      siteSettings = changes[STORAGE_KEYS.siteSettings].newValue || {};
      renderSiteControl();
    }
  });
}

// 컨텍스트 메뉴에서 가져온 임시 선택 텍스트가 있으면 키워드 입력칸에 채운다.
function loadPendingSelection(pendingSelection) {
  if (!pendingSelection?.keyword) {
    return;
  }

  elements.keyword.value = pendingSelection.keyword;
  elements.keyword.focus();
}

// ============================================================
// 메모 저장과 수정
// ============================================================

// 폼 제출 시 새 메모를 저장하거나 기존 메모를 갱신한다.
async function handleSubmit(event) {
  event.preventDefault();

  const keyword = normalizeKeyword(elements.keyword.value);

  if (!keyword) {
    elements.keyword.focus();
    return;
  }

  const now = new Date().toISOString();
  const id = elements.id.value;
  const lowerKeyword = keyword.toLowerCase();
  const existingIndex = id
    ? highlights.findIndex((item) => item.id === id)
    : highlights.findIndex(
        (item) => normalizeKeyword(item.keyword).toLowerCase() === lowerKeyword,
      );

  // 수정 중이면 기존 id/createdAt을 유지하고, 새 항목이면 새 id를 만든다.
  const nextHighlight = {
    ...(existingIndex >= 0 ? highlights[existingIndex] : {}),
    id: existingIndex >= 0 ? highlights[existingIndex].id : createId(),
    keyword,
    memo: elements.memo.value.trim(),
    color: elements.color.value || DEFAULT_COLOR,
    isActive: elements.active.checked,
    sourceUrl:
      existingIndex >= 0
        ? highlights[existingIndex].sourceUrl || currentSiteUrl
        : currentSiteUrl,
    createdAt:
      existingIndex >= 0 ? highlights[existingIndex].createdAt || now : now,
    updatedAt: now,
  };

  highlights =
    existingIndex >= 0
      ? highlights.map((item, index) =>
          index === existingIndex ? nextHighlight : item,
        )
      : [nextHighlight, ...highlights];

  // 저장 후 content script가 페이지 하이라이트를 다시 그리도록 알린다.
  await setStorageValues({
    [STORAGE_KEYS.highlights]: highlights,
    [STORAGE_KEYS.pendingSelection]: null,
  });
  await refreshTabs();

  resetForm();
  renderHighlights();
}

// 목록 안의 수정/중지/삭제 버튼 클릭을 한곳에서 처리한다.
function handleListClick(event) {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const item = highlights.find(
    (highlight) => highlight.id === button.dataset.id,
  );

  if (!item) {
    return;
  }

  if (button.dataset.action === "edit") {
    fillForm(item);
  }

  if (button.dataset.action === "toggle") {
    updateHighlight({ ...item, isActive: item.isActive === false });
  }

  if (button.dataset.action === "delete") {
    deleteHighlight(item.id);
  }
}

// 선택한 항목을 폼에 채워 수정 모드로 전환한다.
function fillForm(item) {
  elements.id.value = item.id;
  elements.keyword.value = item.keyword || "";
  elements.memo.value = item.memo || "";
  elements.color.value = item.color || DEFAULT_COLOR;
  elements.active.checked = item.isActive !== false;
  elements.keyword.focus();
}

// 폼을 새 항목 입력 상태로 되돌린다.
function resetForm() {
  elements.id.value = "";
  elements.keyword.value = "";
  elements.memo.value = "";
  elements.color.value = DEFAULT_COLOR;
  elements.active.checked = true;
}

// 항목 하나를 교체 저장하고 열린 탭에 변경을 알린다.
async function updateHighlight(nextHighlight) {
  highlights = highlights.map((item) =>
    item.id === nextHighlight.id ? nextHighlight : item,
  );
  await setStorageValues({ [STORAGE_KEYS.highlights]: highlights });
  await refreshTabs();
  renderHighlights();
}

// 항목 하나를 삭제하고 열린 탭에 변경을 알린다.
async function deleteHighlight(id) {
  highlights = highlights.filter((item) => item.id !== id);
  await setStorageValues({ [STORAGE_KEYS.highlights]: highlights });
  await refreshTabs();
  renderHighlights();
}

// ============================================================
// 메모 목록 렌더링
// ============================================================

// 저장된 메모 개수와 목록을 화면에 그린다.
function renderHighlights() {
  elements.count.textContent = `저장된 메모 ${highlights.length}개`;

  if (highlights.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "아직 저장된 메모가 없습니다.";
    elements.list.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  highlights.forEach((item) => fragment.append(createHighlightItem(item)));
  elements.list.replaceChildren(fragment);
}

// 목록에 표시할 메모 카드 하나를 만든다.
function createHighlightItem(item) {
  const article = document.createElement("article");
  article.className = "highlight-item";

  const header = document.createElement("div");
  header.className = "item-header";

  const keyword = document.createElement("div");
  keyword.className = "keyword";

  const swatch = document.createElement("span");
  swatch.className = "swatch";
  swatch.style.backgroundColor = item.color || DEFAULT_COLOR;

  const keywordText = document.createElement("span");
  keywordText.className = "keyword-text";
  keywordText.textContent = item.keyword || "(비어 있음)";

  keyword.append(swatch, keywordText);

  const status = document.createElement("span");
  status.className = "status";
  if (item.isActive === false) {
    status.classList.add("is-paused");
  }
  status.textContent = item.isActive === false ? "중지됨" : "사용 중";

  header.append(keyword, status);

  const memo = document.createElement("div");
  memo.className = "memo";
  memo.textContent = item.memo || "메모 없음";

  const actions = document.createElement("div");
  actions.className = "item-actions";
  actions.append(
    createActionButton("edit", "수정", item.id),
    createActionButton(
      "toggle",
      item.isActive === false ? "재개" : "중지",
      item.id,
    ),
    createActionButton("delete", "삭제", item.id),
  );

  article.append(header, memo, createSourceLink(item.sourceUrl), actions);
  return article;
}

// 저장 당시 페이지 링크를 보기 좋게 표시한다.
function createSourceLink(url) {
  const wrapper = document.createElement("div");
  wrapper.className = "source-link-wrap";

  if (!url) {
    wrapper.textContent = "저장된 사이트 링크 없음";
    return wrapper;
  }

  const link = document.createElement("a");
  link.className = "source-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.title = url;
  link.textContent = `저장한 사이트: ${formatUrl(url)}`;
  wrapper.append(link);

  return wrapper;
}

// 목록 카드의 수정/중지/삭제 버튼을 만든다.
function createActionButton(action, label, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.action = action;
  button.dataset.id = id;
  button.textContent = label;
  return button;
}

// ============================================================
// 현재 사이트 설정
// ============================================================

// 현재 사이트의 하이라이트 켜짐/꺼짐 상태를 화면에 표시한다.
function renderSiteControl() {
  const disabled = Boolean(siteSettings[currentSiteKey]?.disabled);
  elements.siteLabel.textContent = currentSiteKey || "일반 웹사이트가 아닙니다";
  elements.siteToggle.textContent = disabled ? "꺼짐" : "켜짐";
  elements.siteToggle.classList.toggle("is-off", disabled);
}

// 현재 사이트에서 하이라이트를 켜거나 끄는 설정을 저장한다.
async function toggleCurrentSite() {
  if (!currentSiteKey) {
    showNotice("현재 사이트를 확인할 수 없습니다.");
    return;
  }

  const current = siteSettings[currentSiteKey] || {};
  siteSettings = {
    ...siteSettings,
    [currentSiteKey]: {
      ...current,
      disabled: !current.disabled,
      updatedAt: new Date().toISOString(),
    },
  };

  await setStorageValues({ [STORAGE_KEYS.siteSettings]: siteSettings });
  await refreshTabs();
  renderSiteControl();
}

// 사용자에게 짧은 안내 문구를 보여준다.
function showNotice(message) {
  if (!elements.notice) {
    return;
  }

  elements.notice.textContent = message;
  elements.notice.hidden = false;
}

// ============================================================
// storage와 탭 메시지 유틸리티
// ============================================================

// chrome.storage.local.get을 Promise로 감싸 async/await에서 쓰기 쉽게 만든다.
function getStorageValues(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

// chrome.storage.local.set을 Promise로 감싸 저장 완료 후 다음 작업을 이어갈 수 있게 한다.
function setStorageValues(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, resolve);
  });
}

// 사이드패널을 연 기준이 되는 현재 활성 탭을 가져온다.
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// 일반 웹 탭에 하이라이트를 다시 그리라는 메시지를 보낸다.
async function refreshTabs() {
  const tabs = await chrome.tabs.query({});

  await Promise.all(
    tabs
      .filter((tab) => tab.id && tab.url && /^https?:/.test(tab.url))
      .map((tab) => sendTabMessage(tab.id, { type: "MDH_REFRESH_HIGHLIGHTS" })),
  );
}

// 특정 탭의 content script로 메시지를 보내고, 실패해도 화면 흐름은 막지 않는다.
function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

// URL에서 사이트별 설정 키로 사용할 hostname을 뽑는다.
function getSiteKey(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (error) {
    return "";
  }
}

// 긴 URL을 목록에 표시하기 좋은 짧은 형태로 바꾼다.
function formatUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch (error) {
    return url;
  }
}

// 키워드 앞뒤 공백과 연속 공백을 정리한다.
function normalizeKeyword(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

// storage에 저장할 하이라이트 id를 만든다.
function createId() {
  return `hl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
