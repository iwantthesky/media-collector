const state = {
  pins: [],
  boardName: "",
  activeTabId: null,
  activeTabUrl: "",
  capturedRequestId: 0,
  pageSupported: false,
  busy: false,
  captureEnabled: false
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  restoreSettings();
  bindEvents();
  refreshActiveTab();
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === "PIN_DOWNLOADER_PROGRESS") {
    const suffix = message.atBottom ? " Sayfa sonu kontrol ediliyor." : "";
    const target = message.targetPins ? `/${message.targetPins}` : "";
    setStatus(`Scroll ${message.scrolls}/${message.maxScrolls}: ${message.pins}${target} medya bulundu.${suffix}`);
  }

  if (message.type === "PIN_DOWNLOADER_DOWNLOAD_PROGRESS") {
    setStatus(`İndiriliyor: ${message.downloaded}/${message.total}. Hata: ${message.failed}.`);
  }

  if (message.type === "PIN_DOWNLOADER_BATCH_PROGRESS") {
    setStatus(`Liste: ${message.current}/${message.totalBoards}. Şu an: ${message.url || ""}`);
  }

  if (message.type === "PIN_DOWNLOADER_HLS_PROGRESS") {
    const phase = message.phase || "İndiriliyor";
    if (message.total > 0) {
      setStatus(`${phase}: ${message.done}/${message.total} parça.`);
    } else {
      setStatus(`${phase}...`);
    }
  }
});

function cacheElements() {
  for (const id of [
    "clearPrivateBtn",
    "downloadConcurrency",
    "pageState",
    "pinCount",
    "boardName",
    "rootFolder",
    "maxScrolls",
    "scrollDelay",
    "tryHighRes",
    "overwrite",
    "mediaUrls",
    "scanBtn",
    "videoBtn",
    "scrollBtn",
    "downloadBtn",
    "directUrlBtn",
    "pickBtn",
    "captureToggleBtn",
    "refreshCapturedBtn",
    "capturedList",
    "status"
  ]) {
    elements[id] = document.getElementById(id);
  }
}

function bindEvents() {
  elements.clearPrivateBtn.addEventListener('click', clearPrivateData);
  elements.downloadConcurrency.addEventListener('change', saveSettings);
  elements.scanBtn.addEventListener("click", () => runScan(false));
  elements.videoBtn.addEventListener("click", scanVideos);
  elements.scrollBtn.addEventListener("click", () => runScan(true));
  elements.downloadBtn.addEventListener("click", downloadPins);
  elements.directUrlBtn.addEventListener("click", downloadDirectMediaUrls);
  elements.pickBtn.addEventListener("click", startPickMode);
  elements.captureToggleBtn.addEventListener("click", toggleCapture);
  elements.refreshCapturedBtn.addEventListener("click", refreshCapturedMedia);

  for (const id of ["rootFolder", "maxScrolls", "scrollDelay", "tryHighRes", "overwrite", "mediaUrls"]) {
    elements[id].addEventListener("change", saveSettings);
    elements[id].addEventListener("input", saveSettings);
  }
}

async function downloadDirectMediaUrls() {
  const urls = parseMediaUrlList(elements.mediaUrls.value);
  if (urls.length === 0) {
    setStatus("Medya adresleri alanına en az bir doğrudan bağlantı yaz.");
    return;
  }

  if (urls.some(isYoutubePage)) {
    setStatus('Bu sayfa bağlantısı bu sürümde desteklenmiyor. Doğrudan bir medya dosyası adresi kullan.');
    return;
  }
  saveSettings();
  setBusy(true);
  setStatus(`${urls.length} medya adresi indiriliyor.`);

  try {
    const response = await chromeRuntimeSendMessage({
      type: "PIN_DOWNLOADER_DIRECT_URLS",
      urls,
      boardName: elements.boardName.value.trim() || "Direct Media",
      options: currentOptions()
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Medya adresi indirilemedi.");
    }

    setStatus(`Bitti: ${response.downloaded}/${response.total} indirildi. Hata: ${response.failed}.`);
  } catch (error) {
    setStatus(`Hata: ${error.message || error}`);
  } finally {
    setBusy(false);
  }
}

async function refreshActiveTab() {
  const [tab] = await chromeTabsQuery({ active: true, currentWindow: true });
  state.activeTabId = tab && tab.id ? tab.id : null;
  state.activeTabUrl = tab && tab.url ? tab.url : "";

  if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    elements.pageState.textContent = "Desteklenen bir web sayfası aç";
    setControlsEnabled(false);
    setStatus("Önce normal bir web sayfası aç. Chrome ayar sayfaları desteklenmez.");
    return;
  }

  if (isYoutubePage(tab.url)) {
    elements.pageState.textContent = 'Bu sayfa desteklenmiyor';
    setControlsEnabled(false);
    setStatus('Bu sürüm bu sayfada tarama, seçim veya indirme sunmuyor.');
    return;
  }
  elements.pageState.textContent = shortUrl(tab.url);
  setControlsEnabled(true);
  setStatus("Hazır. Bir tarama veya seçim modu başlat.");
  refreshCaptureStatus();
}

async function runScan(withScroll) {
  if (!state.activeTabId) {
    return;
  }

  saveSettings();
  setBusy(true);

  try {
    await ensureContentScript(state.activeTabId);
    setStatus(withScroll ? "Sayfa kaydırılıyor, medya yükleniyor." : "Sayfa taranıyor.");

    const response = await sendToTab(state.activeTabId, {
      type: withScroll ? "PIN_DOWNLOADER_AUTOSCROLL_SCAN" : "PIN_DOWNLOADER_SCAN",
      options: currentOptions()
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Tarama başarısız.");
    }

    applyScanResult(response);
    setStatus(`${scanCountText(response)} medya bulundu. İndirme hazır.`);
  } catch (error) {
    setStatus(`Hata: ${error.message || error}`);
  } finally {
    setBusy(false);
  }
}

async function scanVideos() {
  if (!state.activeTabId) {
    return;
  }

  saveSettings();
  setBusy(true);

  try {
    await ensureContentScript(state.activeTabId);
    setStatus("Sayfadaki videolar taranıyor.");

    const response = await sendToTab(state.activeTabId, {
      type: "PIN_DOWNLOADER_SCAN_VIDEOS",
      options: currentOptions()
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Video taraması başarısız.");
    }

    applyScanResult(response);
    setStatus(`${state.pins.length} video bulundu. İndirme hazır.`);
  } catch (error) {
    setStatus(`Hata: ${error.message || error}`);
  } finally {
    setBusy(false);
  }
}

async function downloadPins() {
  if (state.pins.length === 0) {
    return;
  }

  saveSettings();
  setBusy(true);
  setStatus("İndirme başlatılıyor.");

  try {
    const boardName = elements.boardName.value.trim() || state.boardName || "Media";
    const response = await chromeRuntimeSendMessage({
      type: "PIN_DOWNLOADER_DOWNLOAD",
      boardName,
      pins: state.pins,
      options: currentOptions()
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "İndirme başarısız.");
    }

    setStatus(`Bitti: ${response.downloaded}/${response.total} indirildi. Hata: ${response.failed}.`);
  } catch (error) {
    setStatus(`Hata: ${error.message || error}`);
  } finally {
    setBusy(false);
  }
}

async function startPickMode() {
  if (!state.activeTabId) {
    setStatus("Önce desteklenen bir web sayfası aç.");
    return;
  }

  saveSettings();
  setBusy(true);

  try {
    await ensureContentScript(state.activeTabId);
    const response = await sendToTab(state.activeTabId, {
      type: "PIN_DOWNLOADER_START_PICK",
      options: { ...currentOptions(), videoOnly: false }
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Seçim modu başlatılamadı.");
    }

    window.close();
  } catch (error) {
    setStatus(`Hata: ${error.message || error}`);
  } finally {
    setBusy(false);
  }
}

function applyScanResult(response) {
  state.pins = Array.isArray(response.pins) ? response.pins : [];
  state.boardName = response.boardName || state.boardName || "";

  if (!elements.boardName.value.trim() && state.boardName) {
    elements.boardName.value = state.boardName;
  }

  elements.pinCount.textContent = String(state.pins.length);
  updateControls();
}

function scanCountText(response) {
  const targetPins = response && response.targetPins ? response.targetPins : null;
  return targetPins ? `${state.pins.length}/${targetPins}` : String(state.pins.length);
}

function currentOptions() {
  return {
    downloadConcurrency: numberValue(elements.downloadConcurrency, 3, 1, 6),
    rootFolder: elements.rootFolder.value.trim() || "MediaCollector",
    boardName: elements.boardName.value.trim() || state.boardName || "Media",
    maxScrolls: numberValue(elements.maxScrolls, 500, 1, 1200),
    scrollDelay: numberValue(elements.scrollDelay, 900, 250, 5000),
    stopAfterNoGrowth: 24,
    tryHighRes: elements.tryHighRes.checked,
    overwrite: elements.overwrite.checked
  };
}

function numberValue(input, fallback, min, max) {
  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

async function ensureContentScript(tabId) {
  try {
    await sendToTab(tabId, { type: "PIN_DOWNLOADER_PING" });
    return;
  } catch {
    await chromeScriptingExecuteScript({
      target: { tabId },
      files: ["contentScript.js"]
    });
    await sendToTab(tabId, { type: "PIN_DOWNLOADER_PING" });
  }
}

function setControlsEnabled(enabled) {
  state.pageSupported = Boolean(enabled);
  updateControls();
}

function setBusy(isBusy) {
  state.busy = Boolean(isBusy);
  updateControls();
}

function updateControls() {
  const canUsePage = state.pageSupported && !state.busy;
  elements.scanBtn.disabled = !canUsePage;
  elements.videoBtn.disabled = !canUsePage;
  elements.scrollBtn.disabled = !canUsePage;
  elements.pickBtn.disabled = !canUsePage;
  elements.captureToggleBtn.disabled = !canUsePage;
  elements.refreshCapturedBtn.disabled = !canUsePage || !state.captureEnabled;
  elements.directUrlBtn.disabled = state.busy;
  elements.downloadBtn.disabled = state.busy || !state.pageSupported || state.pins.length === 0;
}

function setStatus(text) {
  elements.status.textContent = text;
  const normalized = String(text || "").toLocaleLowerCase("tr-TR");
  elements.status.dataset.tone = normalized.startsWith("hata")
    ? "error"
    : (normalized.startsWith("bitti") || normalized.includes("indirildi") ? "success" : "info");
}

function saveSettings() {
  chrome.storage.local.set({
    rootFolder: elements.rootFolder.value,
    maxScrolls: elements.maxScrolls.value,
    scrollDelay: elements.scrollDelay.value,
    tryHighRes: elements.tryHighRes.checked,
    overwrite: elements.overwrite.checked,
    downloadConcurrency: elements.downloadConcurrency.value
  });
}

function restoreSettings() {
  chrome.storage.local.remove(["boardUrls", "mediaUrls"]);
  chrome.storage.local.get(
    {
      rootFolder: "MediaCollector",
      maxScrolls: "500",
      scrollDelay: "900",
      tryHighRes: true,
      overwrite: true,
      downloadConcurrency: "3"
    },
    (items) => {
      elements.rootFolder.value = items.rootFolder;
      elements.maxScrolls.value = items.maxScrolls;
      elements.scrollDelay.value = items.scrollDelay;
      elements.tryHighRes.checked = Boolean(items.tryHighRes);
      elements.overwrite.checked = Boolean(items.overwrite);
      elements.downloadConcurrency.value = items.downloadConcurrency;
    }
  );
}

function parseUrlList(text) {
  return Array.from(
    new Set(
      String(text || "")
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => /^https:\/\/[^/]*pinterest\.[^/]+\/.+/i.test(item))
    )
  );
}

function parseMediaUrlList(text) {
  return Array.from(
    new Set(
      String(text || "")
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => /^https?:\/\//i.test(item))
    )
  );
}

function shortUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length ? parts.join(" / ") : url.hostname;
  } catch {
    return rawUrl;
  }
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(response);
    });
  });
}

function chromeRuntimeSendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(response);
    });
  });
}

function chromeTabsQuery(query) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(query, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(tabs);
    });
  });
}

function chromeScriptingExecuteScript(options) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(options, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(result);
    });
  });
}

async function refreshCapturedMedia() {
  const requestId = state.capturedRequestId + 1;
  state.capturedRequestId = requestId;

  if (!state.activeTabId) {
    renderCapturedMedia([]);
    return;
  }

  try {
    const response = await chromeRuntimeSendMessage({
      type: "PIN_DOWNLOADER_GET_CAPTURED_MEDIA",
      tabId: state.activeTabId
    });
    const items = response && Array.isArray(response.items) ? response.items : [];
    renderCapturedMedia(items);

    if (items.length === 0) {
      return;
    }

    try {
      const sizeResponse = await chromeRuntimeSendMessage({
        type: "PIN_DOWNLOADER_GET_MEDIA_SIZES",
        items,
        pageUrl: state.activeTabUrl
      });

      if (requestId === state.capturedRequestId && sizeResponse && Array.isArray(sizeResponse.items)) {
        renderCapturedMedia(sizeResponse.items);
      }
    } catch {
      // Keep the captured list visible even when size probing is blocked.
    }
  } catch {
    renderCapturedMedia([]);
  }
}

async function refreshCaptureStatus() {
  if (!state.activeTabId) {
    state.captureEnabled = false;
    updateCaptureButton();
    renderCapturedMedia([]);
    return;
  }

  try {
    const response = await chromeRuntimeSendMessage({
      type: "PIN_DOWNLOADER_GET_CAPTURE_STATUS",
      tabId: state.activeTabId
    });
    state.captureEnabled = Boolean(response && response.ok && response.enabled);
  } catch {
    state.captureEnabled = false;
  }
  updateCaptureButton();
  refreshCapturedMedia();
}

async function toggleCapture() {
  if (!state.activeTabId) {
    return;
  }

  const next = !state.captureEnabled;
  elements.captureToggleBtn.disabled = true;
  try {
    const response = await chromeRuntimeSendMessage({
      type: "PIN_DOWNLOADER_SET_CAPTURE_ENABLED",
      tabId: state.activeTabId,
      enabled: next
    });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Yakalama durumu değiştirilemedi.");
    }
    state.captureEnabled = Boolean(response.enabled);
    updateCaptureButton();
    renderCapturedMedia([]);
    setStatus(state.captureEnabled
      ? "Bu sekmede medya yakalama açık. Videoyu oynatıp listeyi yenile."
      : "Medya yakalama kapatıldı ve geçici adres listesi silindi.");
  } catch (error) {
    setStatus(`Hata: ${error.message || error}`);
  } finally {
    updateControls();
  }
}

function updateCaptureButton() {
  elements.captureToggleBtn.textContent = state.captureEnabled
    ? "Bu sekmede yakalamayı durdur"
    : "Bu sekmede yakalamayı başlat";
  elements.captureToggleBtn.classList.toggle("capture-active", state.captureEnabled);
  elements.refreshCapturedBtn.disabled = state.busy || !state.pageSupported || !state.captureEnabled;
}

function renderCapturedMedia(items) {
  const container = elements.capturedList;
  container.textContent = "";

  const usable = sortCapturedItems(items.filter((item) => item && item.url));
  if (usable.length === 0) {
    const empty = document.createElement("p");
    empty.className = "captured-empty";
    empty.textContent = "Henüz video isteği yakalanmadı. Videoyu birkaç saniye oynat, sonra Yenile'ye bas.";
    container.appendChild(empty);
    return;
  }

  for (const item of usable) {
    container.appendChild(buildCapturedRow(item));
  }
}

function buildCapturedRow(item) {
  const row = document.createElement("div");
  row.className = "media-item";

  const badge = document.createElement("span");
  badge.className = `badge badge-${item.kind}`;
  badge.textContent = capturedKindLabel(item.kind);

  const label = document.createElement("span");
  label.className = "media-url";
  label.textContent = shortMediaUrl(item.url);
  label.title = shortMediaUrl(item.url);

  const size = document.createElement("span");
  size.className = `media-size ${item.sizeStatus === "estimated" ? "media-size-estimated" : ""}`;
  size.textContent = formatMediaSize(item);
  size.title = item.bytes ? `${item.bytes} bayt` : "Boyut bilinmiyor";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "mini";

  if (item.kind === "hls") {
    button.textContent = "Videoyu indir";
    button.addEventListener("click", () => downloadCapturedHls(item.url, button));
  } else if (item.kind === "youtube" || item.kind === "dash") {
    button.textContent = "Desteklenmiyor";
    button.disabled = true;
    button.title = "DASH (.mpd) akışları bu sürümde birleştirilemiyor.";
  } else {
    button.textContent = "Indir";
    button.addEventListener("click", () => downloadCapturedDirect(item.url, button));
  }

  row.appendChild(badge);
  row.appendChild(label);
  row.appendChild(size);
  row.appendChild(button);
  return row;
}

function sortCapturedItems(items) {
  return [...items].sort((a, b) => {
    const aBytes = Number(a.bytes) || 0;
    const bBytes = Number(b.bytes) || 0;
    if (aBytes !== bBytes) {
      return bBytes - aBytes;
    }
    return (Number(b.seen) || 0) - (Number(a.seen) || 0);
  });
}

function capturedKindLabel(kind) {
  if (kind === "hls") {
    return "HLS";
  }
  if (kind === "dash") {
    return "DASH";
  }
  if (kind === "audio") {
    return "SES";
  }
  return "VIDEO";
}

async function downloadCapturedHls(url, button) {
  saveSettings();
  setBusy(true);
  button.disabled = true;
  setStatus("HLS videosu hazırlanıyor. Parça sayısına göre biraz sürebilir.");

  try {
    const response = await chromeRuntimeSendMessage({
      type: "PIN_DOWNLOADER_DOWNLOAD_HLS",
      url,
      pageUrl: state.activeTabUrl,
      boardName: elements.boardName.value.trim() || state.boardName || "Videos",
      options: currentOptions()
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "HLS indirme başarısız.");
    }

    const sizeText = response.bytes ? ` (${formatBytes(response.bytes)})` : "";
    setStatus(`Video indirildi: ${response.segments || 0} parça birleştirildi${sizeText}.`);
  } catch (error) {
    setStatus(`Hata: ${error.message || error}`);
  } finally {
    setBusy(false);
    button.disabled = false;
  }
}

async function downloadCapturedDirect(url, button) {
  saveSettings();
  setBusy(true);
  button.disabled = true;
  setStatus("Video indiriliyor.");

  try {
    const response = await chromeRuntimeSendMessage({
      type: "PIN_DOWNLOADER_DIRECT_URLS",
      urls: [url],
      boardName: elements.boardName.value.trim() || state.boardName || "Videos",
      options: currentOptions()
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "İndirme başarısız.");
    }

    setStatus(`Bitti: ${response.downloaded}/${response.total} indirildi. Hata: ${response.failed}.`);
  } catch (error) {
    setStatus(`Hata: ${error.message || error}`);
  } finally {
    setBusy(false);
    button.disabled = false;
  }
}

function shortMediaUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const file = url.pathname.split("/").filter(Boolean).pop() || url.pathname;
    return `${url.hostname} / ${file}`.slice(0, 44);
  } catch {
    return String(rawUrl).slice(0, 44);
  }
}

function formatMediaSize(item) {
  const bytes = Number(item && item.bytes);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "B";
  }

  return formatBytes(bytes);
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

function isYoutubePage(raw) {
  try { const host = new URL(raw).hostname; return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com'); } catch { return false; }
}
async function clearPrivateData() {
  try {
    const result = await chromeRuntimeSendMessage({type: 'MEDIA_COLLECTOR_CLEAR_PRIVATE'});
    if (!result?.ok) throw new Error('Geçici veriler silinemedi.');
    await chrome.storage.local.remove(['boardUrls', 'mediaUrls']);
    elements.mediaUrls.value = '';
    state.capturedRequestId += 1;
    state.captureEnabled = false; updateCaptureButton(); renderCapturedMedia([]);
    setStatus('Geçici adresler silindi; tüm sekmelerde yakalama kapatıldı. İndirilen dosyalar ve Chrome indirme geçmişi tarayıcıdan yönetilir.');
  } catch { setStatus('Hata: Geçici veriler silinemedi.'); }
}

