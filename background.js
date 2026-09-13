if (typeof importScripts === "function") {
  importScripts("format-utils.js");
}

const formatTools = globalThis.MediaCollectorFormat;
const DOWNLOAD_MESSAGE = "PIN_DOWNLOADER_DOWNLOAD";
const DIRECT_URLS_MESSAGE = "PIN_DOWNLOADER_DIRECT_URLS";
const RECORDED_BLOB_MESSAGE = "PIN_DOWNLOADER_DOWNLOAD_RECORDED_BLOB";
const DOWNLOAD_PROGRESS_MESSAGE = "PIN_DOWNLOADER_DOWNLOAD_PROGRESS";
const BATCH_PROGRESS_MESSAGE = "PIN_DOWNLOADER_BATCH_PROGRESS";
const PINIMG_HOST = "pinimg.com";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || ![
    DOWNLOAD_MESSAGE,
    DIRECT_URLS_MESSAGE,
    RECORDED_BLOB_MESSAGE
  ].includes(message.type)) {
    return false;
  }

  const task = message.type === DOWNLOAD_MESSAGE
    ? downloadPins(message)
    : (message.type === DIRECT_URLS_MESSAGE ? downloadDirectUrls(message) : downloadRecordedBlob(message));
  task
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));

  return true;
});

async function downloadRecordedBlob(message) {
  const url = String(message.url || "");
  if (!url.startsWith("blob:")) {
    throw new Error("Kaydedilen video blob adresi gecersiz.");
  }

  const options = message.options || {};
  const requestedFormat = formatTools.normalizeOutputFormat(options.outputFormat);
  const recordedFormat = formatTools.mediaFormatFromMimeType(message.mimeType) ||
    formatTools.mediaFormatFromUrl(message.filename);
  if (!/^(mp4|webm)$/.test(recordedFormat)) {
    throw new Error("Kaydedilen videonun gercek bicimi belirlenemedi.");
  }
  if ((requestedFormat === "mp4" || requestedFormat === "webm") && recordedFormat !== requestedFormat) {
    throw new Error(`Istenen ${requestedFormat.toUpperCase()} bicimi tarayicida olusturulamadi.`);
  }
  const rootFolder = sanitizePathPart(options.rootFolder || "MediaCollector", "MediaCollector");
  const boardName = sanitizePathPart(message.boardName || options.boardName || "Selected Videos", "Selected Videos");
  const baseName = shortPathPart(message.filename || "selected-video.webm", "selected-video.webm", 100)
    .replace(/\.(webm|mp4)$/i, "");
  const filename = `${rootFolder}/${boardName}/${baseName}.${recordedFormat}`;

  await chromeDownloadAwaitComplete({
    url,
    filename,
    conflictAction: options.overwrite ? "overwrite" : "uniquify",
    saveAs: false
  });

  return { downloaded: 1, failed: 0, total: 1, filename };
}

async function downloadPins(message) {
  return downloadPinsForBoard({
    pins: Array.isArray(message.pins) ? message.pins : [],
    boardName: message.boardName || (message.options && message.options.boardName) || "Media",
    options: message.options || {}
  });
}

async function downloadDirectUrls(message) {
  const urls = normalizeMediaUrls(message.urls || []);
  if (urls.some(url => classifyNetworkMedia(url, '') === 'youtube' || /(^|\.)youtube\.com$/.test(new URL(url).hostname) || new URL(url).hostname === 'youtu.be')) {
    throw new Error('Bu bağlantı bu sürümde desteklenmiyor; sayfa HTML dosyası medya değildir.');
  }
  const options = message.options || {};
  const rootFolder = sanitizePathPart(options.rootFolder || "MediaCollector", "MediaCollector");
  const boardName = sanitizePathPart(message.boardName || options.boardName || "Direct Media", "Direct Media");
  const conflictAction = options.overwrite ? "overwrite" : "uniquify";
  const failures = [];

  let downloaded = 0;
  let failed = 0;

  await runDownloadPool(urls, options.downloadConcurrency, async (url, index) => {
    const filename = buildDirectDownloadFilename({
      rootFolder,
      boardName,
      url,
      index
    });

    try {
      await chromeDownloadAwaitComplete({
        url,
        filename,
        conflictAction,
        saveAs: false
      });
      downloaded += 1;
    } catch (error) {
      failed += 1;
      failures.push({
        index,
        pin: {
          id: `direct-${index + 1}`,
          pinUrl: "",
          url
        },
        url,
        reason: error && error.message ? error.message : "Direct URL download failed."
      });
    }

    sendDownloadProgress(downloaded, failed, urls.length);
  });

  if (failures.length > 0) {
    await saveFailureReport({
      rootFolder,
      boardName,
      failures
    });
  }

  return { downloaded, failed, total: urls.length };
}

async function downloadPinsForBoard({ pins, boardName, options }) {
  const safePins = Array.isArray(pins) ? pins : [];
  const safeOptions = options || {};
  const rootFolder = sanitizePathPart(safeOptions.rootFolder || "MediaCollector", "MediaCollector");
  const safeBoardName = sanitizePathPart(boardName || safeOptions.boardName || "Media", "Media");
  const conflictAction = safeOptions.overwrite ? "overwrite" : "uniquify";
  const tryHighRes = Boolean(safeOptions.tryHighRes);
  const outputFormat = formatTools.normalizeOutputFormat(safeOptions.outputFormat);

  let downloaded = 0;
  let failed = 0;
  const failures = [];

  await runDownloadPool(safePins, safeOptions.downloadConcurrency, async (pin, index) => {

    const urls = await chooseDownloadUrls(pin, tryHighRes, outputFormat);

    if (urls.length === 0) {
      failed += 1;
      failures.push({
        index,
        pin,
        url: "",
        reason: outputFormat === "mp4" || outputFormat === "webm"
          ? `No direct ${outputFormat.toUpperCase()} candidate found.`
          : "No downloadable media URL found."
      });
      sendDownloadProgress(downloaded, failed, safePins.length);
      return;
    }

    const attempt = await downloadFirstAvailable(urls, async (url) => {
      const filename = buildDownloadFilename({
        rootFolder,
        boardName: safeBoardName,
        pin,
        url,
        index
      });
      await chromeDownloadAwaitComplete({ url, filename, conflictAction, saveAs: false });
    });

    if (attempt.ok) {
      downloaded += 1;
    } else {
      failed += 1;
      failures.push({
        index,
        pin,
        url: attempt.url || "",
        reason: attempt.error && attempt.error.message ? attempt.error.message : "All download candidates failed."
      });
    }

    sendDownloadProgress(downloaded, failed, safePins.length);
  });

  if (failures.length > 0 && !safeOptions.suppressFailureReport) {
    await saveFailureReport({
      rootFolder,
      boardName: safeBoardName,
      failures
    });
  }

  return { downloaded, failed, total: safePins.length };
}

async function downloadFirstAvailable(urls, downloadOne) {
  let lastError = null;
  let lastUrl = "";
  for (const url of Array.isArray(urls) ? urls : []) {
    lastUrl = url;
    try {
      await downloadOne(url);
      return { ok: true, url, error: null };
    } catch (error) {
      lastError = error;
    }
  }
  return { ok: false, url: lastUrl, error: lastError };
}

async function chooseDownloadUrls(pin, tryHighRes, outputFormat = "auto") {
  const candidates = normalizeCandidates(pin, outputFormat);
  if (candidates.length === 0) {
    return [];
  }

  if (isVideoUrl(candidates[0].url)) {
    const normalizedOutput = formatTools.normalizeOutputFormat(outputFormat);
    const directCandidates = (normalizedOutput === "mp4" || normalizedOutput === "webm")
      ? candidates.filter((candidate) => formatTools.mediaFormatFromUrl(candidate.url) === normalizedOutput)
      : candidates;
    return unique(directCandidates.map((candidate) => candidate.url));
  }

  if (!tryHighRes) {
    return [candidates[0].url];
  }

  const generated = [];
  for (const candidate of candidates) {
    generated.push(...buildHighResolutionCandidates(candidate.url));
  }

  for (const rawUrl of unique(generated)) {
    if (await imageExists(rawUrl)) {
      return [rawUrl];
    }
  }

  return [candidates[0].url];
}

async function chooseDownloadUrl(pin, tryHighRes, outputFormat = "auto") {
  const urls = await chooseDownloadUrls(pin, tryHighRes, outputFormat);
  return urls[0] || "";
}

function normalizeCandidates(pin, outputFormat = "auto") {
  const rawCandidates = Array.isArray(pin && pin.candidates) ? pin.candidates : [];
  const candidates = rawCandidates
    .filter((candidate) => candidate && typeof candidate.url === "string")
    .map((candidate) => ({
      url: candidate.url,
      score: Math.max(Number(candidate.score) || 0, scoreFromUrl(candidate.url))
    }))
    .filter((candidate) => isSupportedMedia(candidate.url));

  if (pin && typeof pin.url === "string" && isSupportedMedia(pin.url)) {
    candidates.push({
      url: pin.url,
      score: scoreFromUrl(pin.url)
    });
  }

  const byUrl = new Map();
  for (const candidate of candidates) {
    const existing = byUrl.get(candidate.url);
    if (!existing || candidate.score > existing.score) {
      byUrl.set(candidate.url, candidate);
    }
  }

  const sorted = Array.from(byUrl.values()).sort((a, b) => b.score - a.score);
  return sorted.some((candidate) => isVideoUrl(candidate.url))
    ? formatTools.orderVideoCandidates(sorted, outputFormat)
    : sorted;
}

function buildHighResolutionCandidates(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!url.hostname.includes(PINIMG_HOST)) {
      return [];
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return [];
    }

    const first = parts[0];
    if (!/^(\d+)x(?:\d+)?$/.test(first) && first !== "originals") {
      return [];
    }

    const rest = parts.slice(1).join("/");
    const extension = rest.split(".").pop() || "";
    if (!/^(jpe?g|png|webp|gif|avif)$/i.test(extension)) {
      return [];
    }

    return [
      `${url.origin}/originals/${rest}`,
      `${url.origin}/1200x/${rest}`,
      `${url.origin}/736x/${rest}`
    ];
  } catch {
    return [];
  }
}

async function imageExists(rawUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2200);

  try {
    const response = await fetch(rawUrl, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      return false;
    }

    const contentType = response.headers.get("content-type") || "";
    return /^image\//i.test(contentType) || /^video\//i.test(contentType);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function buildDownloadFilename({ rootFolder, boardName, pin, url, index }) {
  const number = String(index + 1).padStart(4, "0");
  const pinId = shortPathPart(pin && pin.id ? String(pin.id) : "pin", "pin", 48);
  const title = shortPathPart(pin && pin.title ? String(pin.title) : pinId, pinId, 54);
  const extension = extensionFromUrl(url);

  return `${rootFolder}/${boardName}/${number}_${pinId}_${title}.${extension}`;
}

function buildDirectDownloadFilename({ rootFolder, boardName, url, index }) {
  const number = String(index + 1).padStart(4, "0");
  const baseTitle = filenameTitleFromUrl(url) || `direct-media-${index + 1}`;
  // Different CDN URLs often end with the same name (for example v1.mp4).
  // Keep a short URL fingerprint so overwrite mode cannot replace one video
  // with another merely because their visible filenames match.
  const title = shortPathPart(`${baseTitle}_${hashText(url).slice(0, 8)}`, `direct-media-${index + 1}`, 88);
  const extension = extensionFromUrl(url, "bin");

  return `${rootFolder}/${boardName}/${number}_${title}.${extension}`;
}

async function saveFailureReport({ rootFolder, boardName, failures }) {
  const lines = [
    "Pinterest Pin Folder Downloader - failed downloads",

    `Failed: ${failures.length}`,
    ""
  ];

  for (const failure of failures) {

    lines.push(`Index: ${failure.index + 1}`);
    lines.push("Reason: Download failed (URLs and private identifiers omitted).");
    lines.push("");
  }

  try {
    await chromeDownloadAwaitComplete({
      url: `data:text/plain;charset=utf-8,${encodeURIComponent(lines.join("\n"))}`,
      filename: `${rootFolder}/${boardName}/_failed_downloads.txt`,
      conflictAction: "overwrite",
      saveAs: false
    });
  } catch {
    // Failure reports are best effort; image downloads are the primary task.
  }
}

function extensionFromUrl(rawUrl, fallback = "jpg") {
  try {
    const url = new URL(rawUrl);
    const match = url.pathname.match(/\.([a-z0-9]+)$/i);
    if (match && /^(avif|gif|jpe?g|png|webp|m4v|mov|mp4|webm)$/i.test(match[1])) {
      return match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function sanitizePathPart(value, fallback) {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .trim()
    .slice(0, 120);

  return cleaned || fallback;
}

function shortPathPart(value, fallback, maxLength) {
  const cleaned = sanitizePathPart(value, fallback);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, Math.max(8, maxLength - 9)).trim()}_${hashText(cleaned).slice(0, 8)}`;
}

function hashText(value) {
  let hash = 2166136261;
  const text = String(value || "");

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizePinterestUrls(values) {
  return unique(
    values
      .map((value) => {
        try {
          const url = new URL(String(value).trim());
          if (!/^https:$/.test(url.protocol) || !/pinterest\./i.test(url.hostname)) {
            return "";
          }

          url.hash = "";
          return url.href;
        } catch {
          return "";
        }
      })
      .filter(Boolean)
  );
}

function normalizeMediaUrls(values) {
  return unique(
    values
      .map((value) => {
        try {
          const url = new URL(String(value).trim());
          if (!/^https?:$/i.test(url.protocol)) {
            return "";
          }

          url.hash = "";
          return url.href;
        } catch {
          return "";
        }
      })
      .filter(Boolean)
  );
}

function filenameTitleFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const filename = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    return filename.replace(/\.[a-z0-9]+$/i, "");
  } catch {
    return "";
  }
}

function isSupportedMedia(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/^https?:$/i.test(url.protocol)) {
      return false;
    }

    return /\.(avif|gif|jpe?g|png|webp|m4v|mov|mp4|webm)(\?|$)/i.test(url.href);
  } catch {
    return false;
  }
}

function scoreFromUrl(rawUrl) {
  try {
      const url = new URL(rawUrl);
      const firstPathPart = url.pathname.split("/").filter(Boolean)[0] || "";
      const videoSizeMatch = url.pathname.match(/\/(\d{3,4})p\//i);
      if (videoSizeMatch) {
        return 20000 + (Number.parseInt(videoSizeMatch[1], 10) || 0);
      }

      if (isVideoUrl(rawUrl)) {
        return 20000;
      }

      if (firstPathPart === "originals") {
        return 10000;
      }

    const sizeMatch = firstPathPart.match(/^(\d+)x(?:\d+)?$/);
    if (sizeMatch) {
      return Number.parseInt(sizeMatch[1], 10) || 0;
    }
  } catch {
    return 0;
  }

  return 0;
}

function isVideoUrl(rawUrl) {
  return /\.(m4v|mov|mp4|webm)(\?|$)/i.test(String(rawUrl || ""));
}

async function ensureContentScript(tabId) {
  try {
    await chromeTabsSendMessage(tabId, { type: "PIN_DOWNLOADER_PING" });
    return;
  } catch {
    await chromeScriptingExecuteScript({
      target: { tabId },
      files: ["format-utils.js", "contentScript.js"]
    });
    await chromeTabsSendMessage(tabId, { type: "PIN_DOWNLOADER_PING" });
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout."));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(error.message));
        return;
      }

      if (tab.status === "complete") {
        clearTimeout(timeout);
        resolve();
        return;
      }

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

function chromeTabsCreate(options) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(options, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(tab);
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

function chromeTabsUpdate(tabId, options) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, options, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(tab);
    });
  });
}

function chromeTabsRemove(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function chromeTabsSendMessage(tabId, message) {
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

function sendDownloadProgress(downloaded, failed, total) {
  sendRuntimeMessage({
    type: DOWNLOAD_PROGRESS_MESSAGE,
    downloaded,
    failed,
    total
  });
}

function sendBatchProgress(current, totalBoards, url) {
  sendRuntimeMessage({
    type: BATCH_PROGRESS_MESSAGE,
    current,
    totalBoards,
    url
  });
}

function sendRuntimeMessage(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      // No popup may be open to receive progress updates. Reading lastError
      // prevents Chrome from reporting an unhandled promise-style error.
      void chrome.runtime.lastError;
    });
  } catch {
    // The popup may be closed while downloads keep running.
  }
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Network media capture + HLS video download
//
// The webRequest listener works like the DevTools (F12) Network tab: it watches
// every request the page makes and remembers the video / HLS / DASH URLs so the
// popup can offer them for download. HLS streams are assembled by offscreen.js.
// ---------------------------------------------------------------------------

const HLS_PROGRESS_MESSAGE = "PIN_DOWNLOADER_HLS_PROGRESS";

let captureWriteQueue = Promise.resolve();
let offscreenSetup = null;
const captureEnabledTabs = new Set();
const captureStateReady = chrome.storage.session.get(null)
  .then((items) => {
    for (const [key, value] of Object.entries(items || {})) {
      const match = key.match(/^capture_enabled_(\d+)$/);
      if (match && value === true) {
        captureEnabledTabs.add(Number(match[1]));
      }
    }
    syncCaptureListener();
  })
  .catch(() => {});

function handleMediaRequest(details) {
  if (details.type === "main_frame") {
    // A fresh navigation replaces the page; drop the old captured list.
    clearCapturedMedia(details.tabId);
    return;
  }

  if (typeof details.tabId !== "number" || details.tabId < 0 || !captureEnabledTabs.has(details.tabId)) {
    return;
  }

  const kind = classifyNetworkMedia(details.url, details.type);
  if (kind) {
    recordCapturedMedia(details.tabId, details.url, kind);
  }
}

function syncCaptureListener() {
  const event = chrome.webRequest.onBeforeRequest;
  const listening = event.hasListener(handleMediaRequest);
  if (captureEnabledTabs.size > 0 && !listening) {
    event.addListener(handleMediaRequest, { urls: ["<all_urls>"] });
  } else if (captureEnabledTabs.size === 0 && listening) {
    event.removeListener(handleMediaRequest);
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  captureEnabledTabs.delete(tabId);
  syncCaptureListener();
  clearCapturedMedia(tabId);
  chrome.storage.session.remove(captureEnabledKey(tabId)).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === 'MEDIA_COLLECTOR_CLEAR_PRIVATE') {
    (async () => {
      await captureStateReady;
      captureEnabledTabs.clear(); syncCaptureListener();
      await captureWriteQueue;
      await chrome.storage.session.clear();
    })().then(() => sendResponse({ok: true})).catch(() => sendResponse({ok: false}));
    return true;
  }
  if (message.type === "PIN_DOWNLOADER_GET_CAPTURED_MEDIA") {
    getCapturedMedia(message.tabId)
      .then((items) => sendResponse({ ok: true, items }))
      .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));
    return true;
  }

  if (message.type === "PIN_DOWNLOADER_GET_CAPTURE_STATUS") {
    captureStateReady
      .then(() => sendResponse({ ok: true, enabled: captureEnabledTabs.has(message.tabId) }))
      .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));
    return true;
  }

  if (message.type === "PIN_DOWNLOADER_SET_CAPTURE_ENABLED") {
    setCaptureEnabled(message.tabId, message.enabled)
      .then((enabled) => sendResponse({ ok: true, enabled }))
      .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));
    return true;
  }

  if (message.type === "PIN_DOWNLOADER_GET_MEDIA_SIZES") {
    estimateCapturedMediaSizes(message.items || [], message.pageUrl)
      .then((items) => sendResponse({ ok: true, items }))
      .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));
    return true;
  }

  if (message.type === "PIN_DOWNLOADER_CLEAR_CAPTURED_MEDIA") {
    clearCapturedMedia(message.tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "PIN_DOWNLOADER_HLS_DIAG") {
    return false;
  }

  if (message.type === "PIN_DOWNLOADER_DOWNLOAD_HLS") {
    enqueueHlsDownload(message) // SIRA: eski hali "downloadHlsStream(message)"
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
      });
    return true;
  }

  return false;
});

function classifyNetworkMedia(rawUrl, resourceType) {
  let pathname = "";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname === "googlevideo.com" || parsed.hostname.endsWith(".googlevideo.com")) return "youtube";
    pathname = parsed.pathname.toLowerCase();
  } catch {
    return "";
  }

  if (/\.m3u8$/.test(pathname)) {
    return "hls";
  }
  if (/\.mpd$/.test(pathname)) {
    return "dash";
  }
  if (/\.(mp4|m4v|mov|webm|ogv|mkv|flv)$/.test(pathname)) {
    return "video";
  }
  if (/\.(ts|m4s)$/.test(pathname)) {
    return "segment";
  }
  if (/\.(mp3|m4a|aac|opus|oga|flac|wav)$/.test(pathname)) {
    return "audio";
  }
  if (resourceType === "media") {
    return "video";
  }

  return "";
}

function recordCapturedMedia(tabId, url, kind) {
  // Individual HLS/DASH segments are noise; the playlist is the useful target.
  if (kind === "segment") {
    return;
  }

  captureWriteQueue = captureWriteQueue
    .then(async () => {
      const key = capturedKey(tabId);
      const stored = await chrome.storage.session.get(key);
      const list = Array.isArray(stored[key]) ? stored[key] : [];

      if (list.some((item) => item.url === url)) {
        return;
      }
      if (list.length >= 120) {
        return;
      }

      list.push({ url, kind, seen: Date.now() });
      await chrome.storage.session.set({ [key]: list });
    })
    .catch(() => {
      // Capture is best effort; ignore storage races.
    });
}

function clearCapturedMedia(tabId) {
  if (typeof tabId !== "number" || tabId < 0) {
    return;
  }

  captureWriteQueue = captureWriteQueue
    .then(() => chrome.storage.session.remove(capturedKey(tabId)))
    .catch(() => {});
}

async function setCaptureEnabled(tabId, enabled) {
  if (typeof tabId !== "number" || tabId < 0) {
    throw new Error("Geçerli bir sekme bulunamadı.");
  }

  await captureStateReady;
  const next = Boolean(enabled);
  if (next) {
    captureEnabledTabs.add(tabId);
    await chrome.storage.session.set({ [captureEnabledKey(tabId)]: true });
  } else {
    captureEnabledTabs.delete(tabId);
    await chrome.storage.session.remove(captureEnabledKey(tabId));
    clearCapturedMedia(tabId);
  }
  syncCaptureListener();
  return next;
}

async function getCapturedMedia(tabId) {
  if (typeof tabId !== "number" || tabId < 0) {
    return [];
  }

  const key = capturedKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return Array.isArray(stored[key]) ? stored[key] : [];
}

function capturedKey(tabId) {
  return `captured_media_${tabId}`;
}

function captureEnabledKey(tabId) {
  return `capture_enabled_${tabId}`;
}

async function estimateCapturedMediaSizes(items, pageUrl) {
  const usable = Array.isArray(items) ? items.filter((item) => item && item.url) : [];
  const results = [];

  for (const item of usable.slice(0, 80)) {
    const copy = { ...item, bytes: 0, sizeStatus: "unknown" };
    try {
      const estimate = item.kind === "hls"
        ? await estimateHlsSize(item.url, pageUrl)
        : await estimateDirectSize(item.url, pageUrl);
      copy.bytes = estimate.bytes || 0;
      copy.sizeStatus = estimate.status || (copy.bytes > 0 ? "ok" : "unknown");
    } catch {
      copy.bytes = 0;
      copy.sizeStatus = "unknown";
    }
    results.push(copy);
  }

  return results;
}

async function estimateDirectSize(url, pageUrl) {
  const response = await fetchWithOptionalReferer(url, pageUrl, { method: "HEAD" });
  if (!response.ok) {
    return { bytes: 0, status: "unknown" };
  }

  const length = Number(response.headers.get("content-length"));
  return Number.isFinite(length) && length > 0
    ? { bytes: length, status: "ok" }
    : { bytes: 0, status: "unknown" };
}

async function estimateHlsSize(url, pageUrl) {
  const manifestResponse = await fetchWithOptionalReferer(url, pageUrl);
  if (!manifestResponse.ok) {
    return { bytes: 0, status: "unknown" };
  }

  const manifest = await manifestResponse.text();
  const variants = extractHlsVariants(manifest, url);

  for (const variant of variants.slice(0, 4)) {
    try {
      const variantResponse = await fetchWithOptionalReferer(variant.url, pageUrl || url);
      if (!variantResponse.ok) {
        continue;
      }

      const variantManifest = await variantResponse.text();
      const variantEstimate = await estimateHlsMediaPlaylistSize(variantManifest, variant.url, pageUrl, variant.bandwidth);
      if (variantEstimate.bytes > 0) {
        return variantEstimate;
      }
    } catch {
      // Try the next variant if this playlist cannot be inspected.
    }
  }

  return estimateHlsMediaPlaylistSize(manifest, url, pageUrl, estimateBitrateFromUrl(url));
}

async function estimateHlsMediaPlaylistSize(manifest, url, pageUrl, fallbackBandwidth = 0) {
  const duration = hlsTotalDuration(manifest);
  const bandwidth = fallbackBandwidth || estimateBitrateFromUrl(url) || estimateBitrateFromManifest(manifest);
  if (duration > 0 && bandwidth > 0) {
    return { bytes: Math.round((bandwidth * duration) / 8), status: "estimated" };
  }

  const segmentUrls = extractHlsSegmentUrls(manifest, url).slice(0, 120);
  if (segmentUrls.length === 0) {
    return { bytes: 0, status: "unknown" };
  }

  let total = 0;
  let measured = 0;
  for (const segmentUrl of segmentUrls) {
    try {
      const response = await fetchWithOptionalReferer(segmentUrl, pageUrl || url, { method: "HEAD" });
      if (!response.ok) {
        continue;
      }
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > 0) {
        total += length;
        measured += 1;
      }
    } catch {
      // Segment size probing is best effort.
    }
  }

  if (total > 0 && measured === segmentUrls.length) {
    return { bytes: total, status: "ok" };
  }
  if (total > 0) {
    const estimated = Math.round((total / measured) * segmentUrls.length);
    return { bytes: estimated, status: "estimated" };
  }

  return { bytes: 0, status: "unknown" };
}

function extractHlsVariants(manifest, baseUrl) {
  const lines = String(manifest || "").split(/\r?\n/);
  const variants = [];
  let pendingBandwidth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const streamMatch = trimmed.match(/^#EXT-X-STREAM-INF:(.*)$/i);
    if (streamMatch) {
      pendingBandwidth = hlsAttributeNumber(streamMatch[1], "AVERAGE-BANDWIDTH")
        || hlsAttributeNumber(streamMatch[1], "BANDWIDTH");
      continue;
    }

    if (!pendingBandwidth || !trimmed || trimmed.startsWith("#")) {
      continue;
    }

    try {
      variants.push({
        url: new URL(trimmed, baseUrl).href,
        bandwidth: pendingBandwidth
      });
    } catch {
      // Ignore malformed variant URLs.
    }
    pendingBandwidth = 0;
  }

  return variants.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
}

function hlsTotalDuration(manifest) {
  return String(manifest || "")
    .split(/\r?\n/)
    .reduce((total, line) => {
      const match = line.match(/^#EXTINF:([\d.]+)/i);
      return match ? total + (Number(match[1]) || 0) : total;
    }, 0);
}

function estimateBitrateFromManifest(manifest) {
  let best = 0;
  for (const line of String(manifest || "").split(/\r?\n/)) {
    const match = line.match(/^#EXT-X-STREAM-INF:(.*)$/i);
    if (!match) {
      continue;
    }
    best = Math.max(
      best,
      hlsAttributeNumber(match[1], "AVERAGE-BANDWIDTH"),
      hlsAttributeNumber(match[1], "BANDWIDTH")
    );
  }
  return best;
}

function hlsAttributeNumber(attributes, name) {
  const match = String(attributes || "").match(new RegExp(`${name}=(\\d+)`, "i"));
  return match ? Number(match[1]) || 0 : 0;
}

function estimateBitrateFromUrl(rawUrl) {
  try {
    const path = decodeURIComponent(new URL(rawUrl).pathname);
    const match = path.match(/(?:^|[_-])(\d{3,6})\s*k(?:bps)?(?:[_-]|$)/i);
    if (match) {
      return (Number(match[1]) || 0) * 1000;
    }
  } catch {
    return 0;
  }
  return 0;
}

function extractHlsSegmentUrls(manifest, baseUrl) {
  const urls = [];
  const lines = String(manifest || "").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (!/\.(ts|m4s|mp4|m4v)(\?|$)/i.test(trimmed)) {
      continue;
    }

    try {
      urls.push(new URL(trimmed, baseUrl).href);
    } catch {
      // Ignore malformed playlist entries.
    }
  }

  return urls;
}

function fetchWithOptionalReferer(url, pageUrl, options = {}) {
  const referer = safeReferer(pageUrl);

  return fetch(url, {
    ...options,
    headers: options.headers,
    referrer: referer || undefined,
    credentials: "include",
    cache: "no-store"
  });
}

function safeReferer(value) {
  try {
    if (value) {
      return new URL(value).href;
    }
  } catch {
    return "";
  }
  return "";
}

// ===== HLS INDIRME SIRASI - BASLANGIC ======================================
// Ayni anda calisan iki HLS indirmesi ortak offscreen isciyi ve Referer
// kuralini paylastigi icin birbirini bozuyordu. Bu sira HLS indirmelerini
// teker teker (otomatik, sirayla) calistirir; downloadHlsStream'e dokunmaz.
//
// GERI ALMAK ICIN iki adim yeterli:
//   1) Bu "BASLANGIC ... BITIS" blogunu tamamen sil.
//   2) Mesaj isleyicideki "enqueueHlsDownload(message)" satirini tekrar
//      "downloadHlsStream(message)" yap.
const HLS_QUEUE_LIMIT = 50;
const hlsQueue = [];
let hlsActive = false;

function enqueueHlsDownload(message) {
  return new Promise((resolve, reject) => {
    if (hlsQueue.length >= HLS_QUEUE_LIMIT) {
      reject(new Error(`Indirme sirasi dolu (en fazla ${HLS_QUEUE_LIMIT}).`));
      return;
    }

    hlsQueue.push({ message, resolve, reject });
    const waiting = hlsQueue.length + (hlsActive ? 1 : 0);

    if (hlsActive || hlsQueue.length > 1) {
      sendHlsQueueStatus(`Siraya eklendi - ${waiting}. sirada bekliyor`);
    }

    processHlsQueue();
  });
}

async function processHlsQueue() {
  if (hlsActive) {
    return;
  }

  const job = hlsQueue.shift();
  if (!job) {
    return;
  }

  hlsActive = true;
  if (hlsQueue.length > 0) {
    sendHlsQueueStatus(`Indirme basliyor - sirada ${hlsQueue.length} video daha var`);
  }

  try {
    const result = await downloadHlsStream(job.message);
    job.resolve(result);
  } catch (error) {
    job.reject(error);
  } finally {
    hlsActive = false;
    processHlsQueue();
  }
}

function sendHlsQueueStatus(phase) {
  sendRuntimeMessage({
    type: HLS_PROGRESS_MESSAGE,
    phase,
    done: 0,
    total: 0
  });
}
// ===== HLS INDIRME SIRASI - BITIS ===========================================

const HLS_REFERER_RULE_ID = 7301;

async function downloadHlsStream(message) {
  const url = String(message.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Gecerli bir HLS (.m3u8) adresi gerekli.");
  }

  const options = message.options || {};
  const rootFolder = sanitizePathPart(options.rootFolder || "MediaCollector", "MediaCollector");
  const boardName = sanitizePathPart(message.boardName || options.boardName || "Videos", "Videos");
  const conflictAction = options.overwrite ? "overwrite" : "uniquify";


  await applyHlsReferer(url, message.pageUrl);

  try {
    await ensureOffscreenDocument();
    await waitForOffscreenReady();

    let assembled;
    try {
      assembled = await sendRuntimeMessageAsync({
        type: "OFFSCREEN_DOWNLOAD_HLS",
        url
      });
    } catch (error) {
      throw new Error(`Offscreen calisaniyla haberlesilemedi: ${error && error.message ? error.message : error}`);
    }

    if (!assembled || !assembled.ok) {
      const reason = assembled && assembled.error ? assembled.error : "HLS videosu olusturulamadi.";
      throw new Error(`Parcalar birlestirilemedi: ${reason}`);
    }


    const filename = `${rootFolder}/${boardName}/${assembled.suggestedName}`;

    try {
      await chromeDownloadAwaitComplete({
        url: assembled.blobUrl,
        filename,
        conflictAction,
        saveAs: false
      });
    } catch (error) {
      throw new Error(`Dosya diske yazilamadi: ${error && error.message ? error.message : error}`);
    }

    return {
      downloaded: 1,
      failed: 0,
      total: 1,
      bytes: assembled.bytes || 0,
      segments: assembled.segments || 0
    };
  } finally {
    // Closing the offscreen document revokes the blob URL, so only do it after
    // the download has finished writing the file to disk.
    await closeOffscreenDocument();
    await clearHlsReferer();
  }
}

// Some video CDNs reject segment requests that arrive without a Referer header.
// fetch() cannot set Referer, so a declarativeNetRequest rule injects it for the
// extension's own requests (tabId -1) while an HLS download is in progress.
async function applyHlsReferer(mediaUrl, pageUrl) {
  let referer = "";
  for (const candidate of [pageUrl, mediaUrl]) {
    try {
      if (candidate) {
        referer = new URL(candidate).origin + "/";
        break;
      }
    } catch {
      referer = "";
    }
  }

  let host = "";
  try {
    host = new URL(mediaUrl).hostname;
  } catch {
    host = "";
  }

  if (!referer || !host) {
    return false;
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [HLS_REFERER_RULE_ID],
      addRules: [{
        id: HLS_REFERER_RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "referer", operation: "set", value: referer }]
        },
        condition: {
          tabIds: [-1],
          urlFilter: `||${host}`
        }
      }]
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function clearHlsReferer() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [HLS_REFERER_RULE_ID]
    });
  } catch {
    // The rule may already be gone.
  }
}

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });

  if (contexts && contexts.length > 0) {
    return;
  }

  if (!offscreenSetup) {
    offscreenSetup = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["BLOBS"],
        justification: "Assemble HLS video segments into a single downloadable file."
      })
      .catch((error) => {
        // A concurrent caller may have created it first; that is fine.
        if (!/single offscreen/i.test(String(error && error.message))) {
          throw error;
        }
      })
      .finally(() => {
        offscreenSetup = null;
      });
  }

  await offscreenSetup;
}

async function closeOffscreenDocument() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    if (contexts && contexts.length > 0) {
      await chrome.offscreen.closeDocument();
    }
  } catch {
    // The offscreen document may already be gone.
  }
}

async function waitForOffscreenReady() {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      const pong = await sendRuntimeMessageAsync({ type: "OFFSCREEN_PING" });
      if (pong && pong.ok) {
        return;
      }
    } catch {
      // The offscreen document has not registered its listener yet.
    }
    await sleep(120);
  }

  throw new Error("Offscreen indirme calisani baslatilamadi.");
}

function sendRuntimeMessageAsync(message) {
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

function chromeDownloadAwaitComplete(options, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      let settled = false;
      const timer = setTimeout(() => {
        settle(reject, new Error("İndirme zaman aşımına uğradı."));
      }, timeoutMs);

      function settle(action, value) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(handleChange);
        action(value);
      }

      function handleChange(delta) {
        if (delta.id !== downloadId || !delta.state) {
          return;
        }

        if (delta.state.current === "complete") {
          settle(resolve, downloadId);
        } else if (delta.state.current === "interrupted") {
          settle(reject, new Error("İndirme Chrome tarafından yarıda kesildi."));
        }
      }

      chrome.downloads.onChanged.addListener(handleChange);

      // A blob download can finish before the onChanged listener is attached,
      // so check the current state once as well.
      chrome.downloads.search({ id: downloadId }, (items) => {
        const item = items && items[0];
        if (!item) {
          return;
        }
        if (item.state === "complete") {
          settle(resolve, downloadId);
        } else if (item.state === "interrupted") {
          settle(reject, new Error("İndirme Chrome tarafından yarıda kesildi."));
        }
      });
    });
  });
}

async function runDownloadPool(items, requested, task) {
  const n = Number(requested);
  const size = Number.isFinite(n) ? Math.max(1, Math.min(6, Math.floor(n))) : 3;
  let cursor = 0;
  await Promise.all(Array.from({length: Math.min(size, items.length)}, async () => {
    while (cursor < items.length) { const index = cursor++; await task(items[index], index); }
  }));
}
