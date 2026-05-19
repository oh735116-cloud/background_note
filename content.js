const MDH_STORAGE_KEY = "highlights";
const MDH_SITE_SETTINGS_KEY = "siteSettings";
const MDH_HIGHLIGHT_CLASS = "mdh-highlight";
const MDH_STYLE_ID = "mdh-highlight-style";
const MDH_TOOLTIP_ID = "mdh-highlight-tooltip";
const MDH_WIDGET_ID = "mdh-floating-widget";
const MDH_SELECTOR = `span.${MDH_HIGHLIGHT_CLASS}`;
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

injectHighlightStyle();
initFloatingWidget();
renderStoredHighlights();
document.addEventListener("mouseover", handleHighlightMouseOver);
document.addEventListener("mousemove", handleHighlightMouseMove);
document.addEventListener("mouseout", handleHighlightMouseOut);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes[MDH_STORAGE_KEY] || changes[MDH_SITE_SETTINGS_KEY])
  ) {
    scheduleHighlightRender();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "MDH_REFRESH_HIGHLIGHTS") {
    scheduleHighlightRender();
  }
});

function scheduleHighlightRender() {
  clearTimeout(mdhRenderTimer);
  mdhRenderTimer = setTimeout(renderStoredHighlights, 120);
}

async function renderStoredHighlights() {
  removeExistingHighlights();

  const { highlights, siteSettings } = await getHighlightState();

  if (isSiteDisabled(siteSettings)) {
    return;
  }

  const activeHighlights = highlights
    .map(normalizeHighlight)
    .filter(Boolean)
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

function getHighlightState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [MDH_STORAGE_KEY, MDH_SITE_SETTINGS_KEY],
      (result) => {
        resolve({
          highlights: Array.isArray(result[MDH_STORAGE_KEY])
            ? result[MDH_STORAGE_KEY]
            : [],
          siteSettings: result[MDH_SITE_SETTINGS_KEY] || {},
        });
      },
    );
  });
}

function isSiteDisabled(siteSettings) {
  return Boolean(siteSettings[getCurrentSiteKey()]?.disabled);
}

function getCurrentSiteKey() {
  return (
    window.location.hostname || window.location.host || window.location.href
  );
}

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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
  const panel = mdhWidget.querySelector(".mdh-widget-panel");
  const close = mdhWidget.querySelector(".mdh-widget-close");
  const sidePanel = mdhWidget.querySelector(".mdh-widget-sidepanel");
  const save = mdhWidget.querySelector(".mdh-widget-save");
  const site = mdhWidget.querySelector(".mdh-widget-site");

  toggle.addEventListener("click", () => {
    panel.hidden = false;
    toggle.hidden = true;
    mdhWidget.querySelector(".mdh-widget-keyword").focus();
  });

  close.addEventListener("click", () => {
    panel.hidden = true;
    toggle.hidden = false;
  });

  sidePanel.addEventListener("click", openWidgetSidePanel);
  save.addEventListener("click", saveWidgetHighlight);
  site.addEventListener("click", toggleWidgetSite);

  await syncWidgetSiteState();
}

async function loadFloatingWidgetTemplate() {
  const response = await fetch(chrome.runtime.getURL("floating-widget.html"));
  return response.text();
}

async function openWidgetSidePanel() {
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

  await setStorage({ [MDH_STORAGE_KEY]: highlights });
  keywordInput.value = "";
  memoInput.value = "";
  showWidgetMessage("저장했어요.");
  scheduleHighlightRender();
}

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

function getSiteSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([MDH_SITE_SETTINGS_KEY], (result) => {
      resolve(result[MDH_SITE_SETTINGS_KEY] || {});
    });
  });
}

function setStorage(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

function showWidgetMessage(message) {
  const messageElement = mdhWidget.querySelector(".mdh-widget-message");
  messageElement.textContent = message;
  messageElement.hidden = false;
  clearTimeout(showWidgetMessage.timer);
  showWidgetMessage.timer = setTimeout(() => {
    messageElement.hidden = true;
  }, 1800);
}

function getHighlights() {
  return new Promise((resolve) => {
    chrome.storage.local.get([MDH_STORAGE_KEY], (result) => {
      resolve(
        Array.isArray(result[MDH_STORAGE_KEY]) ? result[MDH_STORAGE_KEY] : [],
      );
    });
  });
}

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

function handleHighlightMouseMove(event) {
  if (mdhTooltip && !mdhTooltip.hidden) {
    positionMemoTooltip(event);
  }
}

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

function showMemoTooltip(memo, event) {
  const tooltip = getMemoTooltip();
  tooltip.textContent = memo;
  tooltip.hidden = false;
  positionMemoTooltip(event);
}

function hideMemoTooltip() {
  if (mdhTooltip) {
    mdhTooltip.hidden = true;
  }
}

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

function cacheTextColor(backgroundColor, textColor) {
  mdhTextColorCache.set(backgroundColor, textColor);
  return textColor;
}

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

function normalizeKeyword(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function createId() {
  return `hl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
