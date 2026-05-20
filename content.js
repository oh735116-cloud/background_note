// ============================================================
// 상수와 상태값
// ============================================================

// Chrome storage 키
const MDH_STORAGE_KEY = "highlights";
const MDH_PENDING_SELECTION_KEY = "pendingSelection";
const MDH_SITE_SETTINGS_KEY = "siteSettings";

// DOM/CSS 식별자
const MDH_HIGHLIGHT_CLASS = "mdh-highlight";
const MDH_STYLE_ID = "mdh-highlight-style";
const MDH_TOOLTIP_ID = "mdh-highlight-tooltip";
const MDH_WIDGET_ID = "mdh-floating-widget";
const MDH_WIDGET_RECENT_LIMIT = 4;
const MDH_SELECTOR = `span.${MDH_HIGHLIGHT_CLASS}`;

// 사용자가 입력하거나 코드가 실행되는 영역은 하이라이트하지 않는다.
const MDH_IGNORED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
]);

let mdhRenderTimer = null;
let mdhTooltip = null;
let mdhWidget = null;
const mdhTextColorCache = new Map();

// ============================================================
// 초기 실행과 이벤트 연결
// ============================================================

// 페이지가 열리면 스타일, 위젯, 저장된 하이라이트를 바로 준비한다.
injectHighlightStyle();
initFloatingWidget();
renderStoredHighlights();

// 이벤트 위임 방식으로 모든 하이라이트 span의 hover 툴팁을 처리한다.
document.addEventListener("mouseover", handleHighlightMouseOver);
document.addEventListener("mousemove", handleHighlightMouseMove);
document.addEventListener("mouseout", handleHighlightMouseOut);

// 다른 화면에서 메모나 사이트 설정을 바꾸면 현재 페이지도 즉시 갱신한다.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes[MDH_STORAGE_KEY] || changes[MDH_SITE_SETTINGS_KEY])
  ) {
    if (changes[MDH_STORAGE_KEY]) {
      renderWidgetRecentHighlights();
    }

    if (changes[MDH_SITE_SETTINGS_KEY]) {
      syncWidgetSiteState();
    }

    scheduleHighlightRender();
  }
});

// background script/sidepanel에서 보내는 새로고침과 선택 텍스트 메시지를 받는다.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "MDH_REFRESH_HIGHLIGHTS") {
    scheduleHighlightRender();
  }

  if (message?.type === "MDH_SELECTION_CAPTURED") {
    loadSelectionIntoWidget(message.payload);
  }
});

// ============================================================
// 하이라이트 렌더링
// ============================================================

// storage 변경이 연속으로 들어와도 실제 렌더링은 한 번만 실행한다.
function scheduleHighlightRender() {
  clearTimeout(mdhRenderTimer);
  mdhRenderTimer = setTimeout(renderStoredHighlights, 120);
}

// 저장된 활성 키워드를 읽어 현재 페이지 본문에 하이라이트를 적용한다.
async function renderStoredHighlights() {
  removeExistingHighlights();

  const { highlights, siteSettings } = await getHighlightState();

  if (isSiteDisabled(siteSettings)) {
    return;
  }

  const activeHighlights = highlights
    .map(normalizeHighlight)
    .filter(Boolean)
    // 긴 키워드를 먼저 처리해야 짧은 키워드가 일부만 먼저 차지하는 일을 막을 수 있다.
    .sort((a, b) => b.keyword.length - a.keyword.length);

  if (activeHighlights.length === 0) {
    return;
  }

  const matcher = createHighlightMatcher(activeHighlights);

  if (!matcher) {
    return;
  }

  highlightTextNodes(document.body, matcher);
}

// 하이라이트 목록과 사이트별 설정을 함께 읽는다.
async function getHighlightState() {
  const result = await getStorage([MDH_STORAGE_KEY, MDH_SITE_SETTINGS_KEY]);

  return {
    highlights: normalizeHighlights(result[MDH_STORAGE_KEY]),
    siteSettings: result[MDH_SITE_SETTINGS_KEY] || {},
  };
}

function isSiteDisabled(siteSettings) {
  return Boolean(siteSettings[getCurrentSiteKey()]?.disabled);
}

// 사이트별 설정 키로 쓸 현재 페이지 대표 주소를 만든다.
function getCurrentSiteKey() {
  return (
    window.location.hostname || window.location.host || window.location.href
  );
}

// 비활성/빈 키워드는 제외하고 검색용 소문자 키워드를 추가한다.
function normalizeHighlight(item) {
  const keyword = normalizeKeyword(item?.keyword);

  if (!keyword || item?.isActive === false) {
    return null;
  }

  return {
    ...item,
    keyword,
    lowerKeyword: keyword.toLowerCase(),
  };
}

// 여러 키워드를 하나의 정규식으로 묶고, 메모 데이터는 Map으로 빠르게 찾는다.
function createHighlightMatcher(highlights) {
  const byKeyword = new Map();
  const patterns = [];

  highlights.forEach((highlight) => {
    if (byKeyword.has(highlight.lowerKeyword)) {
      return;
    }

    byKeyword.set(highlight.lowerKeyword, highlight);
    patterns.push(escapeRegExp(highlight.keyword));
  });

  if (patterns.length === 0) {
    return null;
  }

  return {
    byKeyword,
    regex: new RegExp(patterns.join("|"), "gi"),
  };
}

// 정규식 특수문자가 들어간 키워드도 문자 그대로 검색되게 만든다.
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================
// 빠른 저장 위젯
// ============================================================

// 웹페이지 오른쪽 아래에 위젯을 만들고 버튼 이벤트를 연결한다.
async function initFloatingWidget() {
  if (document.getElementById(MDH_WIDGET_ID)) {
    return;
  }

  injectFloatingWidgetStyle();

  mdhWidget = document.createElement("section");
  mdhWidget.id = MDH_WIDGET_ID;
  mdhWidget.innerHTML = await loadFloatingWidgetTemplate();

  document.documentElement.appendChild(mdhWidget);

  const toggle = mdhWidget.querySelector(".mdh-widget-toggle");
  const close = mdhWidget.querySelector(".mdh-widget-close");
  const sidePanel = mdhWidget.querySelector(".mdh-widget-sidepanel");
  const save = mdhWidget.querySelector(".mdh-widget-save");
  const site = mdhWidget.querySelector(".mdh-widget-site");

  toggle.addEventListener("click", () => {
    setWidgetExpanded(true);
    mdhWidget.querySelector(".mdh-widget-keyword").focus();
  });

  close.addEventListener("click", () => {
    setWidgetExpanded(false);
  });

  sidePanel.addEventListener("click", openWidgetSidePanel);
  save.addEventListener("click", saveWidgetHighlight);
  site.addEventListener("click", toggleWidgetSite);

  await syncWidgetSiteState();
  await renderWidgetRecentHighlights();
  await loadStoredPendingSelection();
}

// 위젯을 열면 패널을 보여주고, 최소화하면 오른쪽 아래 아이콘만 남긴다.
function setWidgetExpanded(isExpanded) {
  const toggle = mdhWidget.querySelector(".mdh-widget-toggle");
  const panel = mdhWidget.querySelector(".mdh-widget-panel");

  panel.hidden = !isExpanded;
  toggle.hidden = isExpanded;
  toggle.setAttribute("aria-expanded", String(isExpanded));
}

// manifest의 web_accessible_resources에 등록된 위젯 HTML을 불러온다.
async function loadFloatingWidgetTemplate() {
  const response = await fetch(chrome.runtime.getURL("floating-widget.html"));
  return response.text();
}

// 위젯에서 사이드패널 관리 화면을 연다.
async function openWidgetSidePanel() {
  setWidgetExpanded(false);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "MDH_OPEN_SIDE_PANEL",
    });

    showWidgetMessage(
      response?.ok ? "사이드패널을 열었어요." : "사이드패널을 열 수 없어요.",
    );
  } catch (error) {
    showWidgetMessage("사이드패널을 열 수 없어요.");
  }
}

// 우클릭 메뉴로 가져온 선택 텍스트를 위젯 입력칸에 넣는다.
function loadSelectionIntoWidget(selection) {
  const keyword = normalizeKeyword(selection?.keyword);

  if (!keyword || !mdhWidget) {
    return;
  }

  const keywordInput = mdhWidget.querySelector(".mdh-widget-keyword");

  setWidgetExpanded(true);
  keywordInput.value = keyword;
  keywordInput.focus();
  showWidgetMessage("선택한 텍스트를 가져왔어요.");
}

// 메시지 타이밍을 놓쳤을 때를 대비해 저장된 임시 선택 텍스트도 확인한다.
async function loadStoredPendingSelection() {
  const result = await getStorage([MDH_PENDING_SELECTION_KEY]);
  const selection = result[MDH_PENDING_SELECTION_KEY];

  if (selection?.sourceUrl === window.location.href) {
    loadSelectionIntoWidget(selection);
  }
}

// 위젯 전용 CSS를 페이지에 주입한다.
function injectFloatingWidgetStyle() {
  if (document.getElementById(`${MDH_WIDGET_ID}-style`)) {
    return;
  }

  const link = document.createElement("link");
  link.id = `${MDH_WIDGET_ID}-style`;
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("floating-widget.css");
  document.documentElement.appendChild(link);
}

// 위젯 입력값을 저장한다. 같은 키워드가 있으면 기존 항목을 갱신한다.
async function saveWidgetHighlight() {
  const keywordInput = mdhWidget.querySelector(".mdh-widget-keyword");
  const memoInput = mdhWidget.querySelector(".mdh-widget-memo");
  const colorInput = mdhWidget.querySelector(".mdh-widget-color");
  const keyword = normalizeKeyword(keywordInput.value);

  if (!keyword) {
    showWidgetMessage("키워드를 입력해 주세요.");
    keywordInput.focus();
    return;
  }

  const highlights = await getHighlights();
  const now = new Date().toISOString();
  const existingIndex = highlights.findIndex(
    (item) =>
      normalizeKeyword(item.keyword).toLowerCase() === keyword.toLowerCase(),
  );

  // 기존 항목은 id/createdAt을 유지한다.
  const nextHighlight = {
    ...(existingIndex >= 0 ? highlights[existingIndex] : {}),
    id: existingIndex >= 0 ? highlights[existingIndex].id : createId(),
    keyword,
    memo: memoInput.value.trim(),
    color: colorInput.value || "#fff3a3",
    isActive: true,
    sourceUrl: window.location.href,
    createdAt:
      existingIndex >= 0 ? highlights[existingIndex].createdAt || now : now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    highlights[existingIndex] = nextHighlight;
  } else {
    highlights.unshift(nextHighlight);
  }

  await setStorage({
    [MDH_STORAGE_KEY]: highlights,
    [MDH_PENDING_SELECTION_KEY]: null,
  });

  // 저장 후 입력칸, 최근 목록, 본문 하이라이트를 갱신한다.
  keywordInput.value = "";
  memoInput.value = "";
  showWidgetMessage("저장했어요.");
  renderWidgetRecentHighlights(highlights);
  scheduleHighlightRender();
}

// 최근 메모를 위젯에 보여주고, 클릭하면 입력칸에 다시 불러온다.
async function renderWidgetRecentHighlights(nextHighlights) {
  if (!mdhWidget) {
    return;
  }

  const list = mdhWidget.querySelector(".mdh-widget-recent-list");

  if (!list) {
    return;
  }

  const highlights = Array.isArray(nextHighlights)
    ? nextHighlights
    : await getHighlights();
  const recentHighlights = highlights.slice(0, MDH_WIDGET_RECENT_LIMIT);

  if (recentHighlights.length === 0) {
    const empty = document.createElement("div");
    empty.className = "mdh-widget-empty";
    empty.textContent = "아직 저장된 메모가 없습니다.";
    list.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  recentHighlights.forEach((item) => {
    const recent = document.createElement("button");
    recent.className = "mdh-widget-recent-item";
    recent.type = "button";
    recent.title = item.memo || item.keyword || "";

    const keyword = document.createElement("span");
    keyword.className = "mdh-widget-recent-keyword";
    keyword.textContent = item.keyword || "(비어 있음)";

    const memo = document.createElement("span");
    memo.className = "mdh-widget-recent-memo";
    memo.textContent = item.memo || "메모 없음";

    recent.append(keyword, memo);
    recent.addEventListener("click", () => {
      mdhWidget.querySelector(".mdh-widget-keyword").value = item.keyword || "";
      mdhWidget.querySelector(".mdh-widget-memo").value = item.memo || "";
      mdhWidget.querySelector(".mdh-widget-color").value =
        item.color || "#fff3a3";
    });
    fragment.append(recent);
  });

  list.replaceChildren(fragment);
}

// 현재 사이트의 하이라이트 사용 여부를 바꾼다.
async function toggleWidgetSite() {
  const settings = await getSiteSettings();
  const siteKey = getCurrentSiteKey();
  const current = settings[siteKey] || {};
  settings[siteKey] = {
    ...current,
    disabled: !current.disabled,
    updatedAt: new Date().toISOString(),
  };

  await setStorage({ [MDH_SITE_SETTINGS_KEY]: settings });
  await syncWidgetSiteState();
  scheduleHighlightRender();
}

// 저장된 사이트 설정에 맞춰 위젯의 켜짐/꺼짐 표시를 바꾼다.
async function syncWidgetSiteState() {
  if (!mdhWidget) {
    return;
  }

  const settings = await getSiteSettings();
  const disabled = Boolean(settings[getCurrentSiteKey()]?.disabled);
  const siteButton = mdhWidget.querySelector(".mdh-widget-site");
  siteButton.textContent = disabled ? "현재 사이트 꺼짐" : "현재 사이트 켜짐";
  siteButton.classList.toggle("is-off", disabled);
}

// 위젯에 짧은 상태 메시지를 보여주고 잠시 뒤 숨긴다.
function showWidgetMessage(message) {
  const messageElement = mdhWidget.querySelector(".mdh-widget-message");
  messageElement.textContent = message;
  messageElement.hidden = false;
  clearTimeout(showWidgetMessage.timer);
  showWidgetMessage.timer = setTimeout(() => {
    messageElement.hidden = true;
  }, 1800);
}

// ============================================================
// 텍스트 노드 치환
// ============================================================

// TreeWalker로 텍스트 노드만 모아 하이라이트 치환을 수행한다.
function highlightTextNodes(root, matcher) {
  if (!root) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim() || shouldIgnoreNode(node)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach((node) => replaceTextNodeMatches(node, matcher));
}

// 매칭된 구간만 span으로 감싸고 나머지 텍스트는 그대로 둔다.
function replaceTextNodeMatches(textNode, matcher) {
  const text = textNode.nodeValue;
  const matches = findMatches(text, matcher);

  if (matches.length === 0) {
    return;
  }

  const fragment = document.createDocumentFragment();
  let cursor = 0;

  matches.forEach((match) => {
    if (match.start > cursor) {
      fragment.append(text.slice(cursor, match.start));
    }

    const span = document.createElement("span");
    const backgroundColor = match.highlight.color || "#fff3a3";
    span.className = MDH_HIGHLIGHT_CLASS;
    span.dataset.mdhId = match.highlight.id || "";
    span.dataset.mdhKeyword = match.highlight.keyword;
    span.dataset.mdhMemo = match.highlight.memo || "";
    span.style.backgroundColor = backgroundColor;
    // 배경색에 맞춰 글자색을 바꿔 가독성을 유지한다.
    span.style.color = getReadableTextColor(backgroundColor);
    span.textContent = text.slice(match.start, match.end);
    fragment.append(span);

    cursor = match.end;
  });

  if (cursor < text.length) {
    fragment.append(text.slice(cursor));
  }

  textNode.parentNode.replaceChild(fragment, textNode);
}

// 정규식 결과와 실제 하이라이트 데이터를 묶어 매칭 목록으로 만든다.
function findMatches(text, matcher) {
  const matches = [];
  matcher.regex.lastIndex = 0;

  let match;
  while ((match = matcher.regex.exec(text)) !== null) {
    const keyword = match[0].toLowerCase();
    const highlight = matcher.byKeyword.get(keyword);

    if (!highlight) {
      continue;
    }

    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      highlight,
    });

    if (match[0].length === 0) {
      matcher.regex.lastIndex += 1;
    }
  }

  return matches;
}

// 다시 렌더링하기 전에 기존 span을 텍스트로 되돌려 중복 감싸기를 막는다.
function removeExistingHighlights() {
  hideMemoTooltip();

  const touchedParents = new Set();
  document.querySelectorAll(MDH_SELECTOR).forEach((span) => {
    if (span.parentNode) {
      touchedParents.add(span.parentNode);
    }
    span.replaceWith(document.createTextNode(span.textContent));
  });

  touchedParents.forEach((parent) => parent.normalize());
}

// ============================================================
// 메모 툴팁
// ============================================================

// 하이라이트 위에 마우스가 올라오면 메모가 있는 경우에만 툴팁을 띄운다.
function handleHighlightMouseOver(event) {
  const highlight = event.target.closest?.(MDH_SELECTOR);

  if (!highlight) {
    return;
  }

  const memo = String(highlight.dataset.mdhMemo || "").trim();

  if (!memo) {
    return;
  }

  showMemoTooltip(memo, event);
}

// 열린 툴팁은 마우스 이동에 맞춰 위치를 갱신한다.
function handleHighlightMouseMove(event) {
  if (mdhTooltip && !mdhTooltip.hidden) {
    positionMemoTooltip(event);
  }
}

// 하이라이트 영역을 벗어나면 툴팁을 숨긴다.
function handleHighlightMouseOut(event) {
  const highlight = event.target.closest?.(MDH_SELECTOR);

  if (!highlight) {
    return;
  }

  if (event.relatedTarget?.closest?.(MDH_SELECTOR) === highlight) {
    return;
  }

  hideMemoTooltip();
}

// 툴팁에 메모를 넣고 마우스 근처에 표시한다.
function showMemoTooltip(memo, event) {
  const tooltip = getMemoTooltip();
  tooltip.textContent = memo;
  tooltip.hidden = false;
  positionMemoTooltip(event);
}

// 툴팁을 DOM에서 제거하지 않고 숨겨서 다음 hover 때 재사용한다.
function hideMemoTooltip() {
  if (mdhTooltip) {
    mdhTooltip.hidden = true;
  }
}

// 툴팁 DOM은 한 번만 만들고 재사용한다.
function getMemoTooltip() {
  if (mdhTooltip) {
    return mdhTooltip;
  }

  mdhTooltip = document.createElement("div");
  mdhTooltip.id = MDH_TOOLTIP_ID;
  mdhTooltip.hidden = true;
  document.documentElement.appendChild(mdhTooltip);

  return mdhTooltip;
}

// 툴팁이 화면 밖으로 나가지 않도록 좌표를 보정한다.
function positionMemoTooltip(event) {
  const tooltip = getMemoTooltip();
  const offset = 12;
  const margin = 8;
  const maxLeft = window.innerWidth - tooltip.offsetWidth - margin;
  const maxTop = window.innerHeight - tooltip.offsetHeight - margin;
  const left = Math.max(margin, Math.min(event.clientX + offset, maxLeft));
  const top = Math.max(margin, Math.min(event.clientY + offset, maxTop));

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

// ============================================================
// 스타일과 유틸리티
// ============================================================

// 입력창, 스크립트, 위젯 내부처럼 하이라이트하면 안 되는 노드를 걸러낸다.
function shouldIgnoreNode(node) {
  const parent = node.parentElement;

  if (
    !parent ||
    parent.closest(MDH_SELECTOR) ||
    parent.closest(`#${MDH_WIDGET_ID}`)
  ) {
    return true;
  }

  return Boolean(parent.closest(Array.from(MDH_IGNORED_TAGS).join(",")));
}

// 하이라이트 span과 메모 툴팁의 기본 스타일을 페이지에 주입한다.
function injectHighlightStyle() {
  if (document.getElementById(MDH_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = MDH_STYLE_ID;
  style.textContent = `
    .${MDH_HIGHLIGHT_CLASS} {
      border-radius: 4px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      cursor: help;
      font-weight: 700;
      padding: 1px 3px;
      text-shadow: none;
    }

    #${MDH_TOOLTIP_ID} {
      position: fixed;
      z-index: 2147483647;
      max-width: 280px;
      padding: 9px 11px;
      border: 1px solid rgba(111, 78, 55, 0.16);
      border-radius: 10px;
      background: #fffaf0;
      box-shadow: 0 10px 26px rgba(89, 64, 46, 0.2);
      color: #3b2a20;
      font: 14px/1.45 "Comic Sans MS", "Segoe Print", "맑은 고딕", sans-serif;
      pointer-events: none;
      white-space: pre-wrap;
      word-break: break-word;
    }

    #${MDH_TOOLTIP_ID}[hidden] {
      display: none;
    }
  `;
  document.documentElement.appendChild(style);
}

// 배경색 밝기를 계산해 읽기 쉬운 글자색을 고른다.
function getReadableTextColor(backgroundColor) {
  if (mdhTextColorCache.has(backgroundColor)) {
    return mdhTextColorCache.get(backgroundColor);
  }

  const rgb = parseColor(backgroundColor);

  if (!rgb) {
    return cacheTextColor(backgroundColor, "#2b2118");
  }

  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return cacheTextColor(
    backgroundColor,
    luminance > 0.62 ? "#2b2118" : "#ffffff",
  );
}

// #rgb, #rrggbb 형식의 색상 문자열을 RGB 숫자 값으로 변환한다.
function parseColor(value) {
  const color = String(value || "").trim();

  if (/^#[0-9a-f]{3}$/i.test(color)) {
    const [, r, g, b] = color;
    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16),
    };
  }

  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return {
      r: Number.parseInt(color.slice(1, 3), 16),
      g: Number.parseInt(color.slice(3, 5), 16),
      b: Number.parseInt(color.slice(5, 7), 16),
    };
  }

  return null;
}

// storage 접근을 Promise로 감싸 async/await에서 쓰기 쉽게 만든다.
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

function getSiteSettings() {
  return getStorage([MDH_SITE_SETTINGS_KEY]).then(
    (result) => result[MDH_SITE_SETTINGS_KEY] || {},
  );
}

function getHighlights() {
  return getStorage([MDH_STORAGE_KEY]).then((result) =>
    normalizeHighlights(result[MDH_STORAGE_KEY]),
  );
}

function cacheTextColor(backgroundColor, textColor) {
  mdhTextColorCache.set(backgroundColor, textColor);
  return textColor;
}

function normalizeHighlights(value) {
  return Array.isArray(value) ? value : [];
}

// 키워드 공백을 정리해 비교/저장 기준을 통일한다.
function normalizeKeyword(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

// storage에 저장할 하이라이트 id를 만든다.
function createId() {
  return `hl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
