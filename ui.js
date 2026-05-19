const STORAGE_KEYS = {
  highlights: "highlights",
  pendingSelection: "pendingSelection",
  siteSettings: "siteSettings",
};

const DEFAULT_COLOR = "#fff3a3";

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

  renderSiteControl();
  renderHighlights();
  loadPendingSelection(stored[STORAGE_KEYS.pendingSelection]);

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

function loadPendingSelection(pendingSelection) {
  if (!pendingSelection?.keyword) {
    return;
  }

  elements.keyword.value = pendingSelection.keyword;
  elements.keyword.focus();
}

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

  await setStorageValues({
    [STORAGE_KEYS.highlights]: highlights,
    [STORAGE_KEYS.pendingSelection]: null,
  });
  await refreshTabs();

  resetForm();
  renderHighlights();
}

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

function fillForm(item) {
  elements.id.value = item.id;
  elements.keyword.value = item.keyword || "";
  elements.memo.value = item.memo || "";
  elements.color.value = item.color || DEFAULT_COLOR;
  elements.active.checked = item.isActive !== false;
  elements.keyword.focus();
}

function resetForm() {
  elements.id.value = "";
  elements.keyword.value = "";
  elements.memo.value = "";
  elements.color.value = DEFAULT_COLOR;
  elements.active.checked = true;
}

async function updateHighlight(nextHighlight) {
  highlights = highlights.map((item) =>
    item.id === nextHighlight.id ? nextHighlight : item,
  );
  await setStorageValues({ [STORAGE_KEYS.highlights]: highlights });
  await refreshTabs();
  renderHighlights();
}

async function deleteHighlight(id) {
  highlights = highlights.filter((item) => item.id !== id);
  await setStorageValues({ [STORAGE_KEYS.highlights]: highlights });
  await refreshTabs();
  renderHighlights();
}

function renderHighlights() {
  elements.count.textContent = `저장된 메모 ${highlights.length}개`;

  if (highlights.length === 0) {
    elements.list.innerHTML = `<div class="empty-state">아직 저장된 메모가 없습니다.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  highlights.forEach((item) => fragment.append(createHighlightItem(item)));
  elements.list.replaceChildren(fragment);
}

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

function createActionButton(action, label, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.action = action;
  button.dataset.id = id;
  button.textContent = label;
  return button;
}

function renderSiteControl() {
  const disabled = Boolean(siteSettings[currentSiteKey]?.disabled);
  elements.siteLabel.textContent = currentSiteKey || "일반 웹사이트가 아닙니다";
  elements.siteToggle.textContent = disabled ? "꺼짐" : "켜짐";
  elements.siteToggle.classList.toggle("is-off", disabled);
}

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

function showNotice(message) {
  if (!elements.notice) {
    return;
  }

  elements.notice.textContent = message;
  elements.notice.hidden = false;
}

function getStorageValues(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function setStorageValues(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, resolve);
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function refreshTabs() {
  const tabs = await chrome.tabs.query({});

  await Promise.all(
    tabs
      .filter((tab) => tab.id && tab.url && /^(https?:|file:)/.test(tab.url))
      .map((tab) => sendTabMessage(tab.id, { type: "MDH_REFRESH_HIGHLIGHTS" })),
  );
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function getSiteKey(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname || "";
  } catch (error) {
    return "";
  }
}

function formatUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch (error) {
    return url;
  }
}

function normalizeKeyword(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function createId() {
  return `hl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
