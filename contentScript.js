(() => {
  const formatTools = globalThis.MediaCollectorFormat;
  const KNOWN_IMAGE_HOST = "pinimg.com";
  const PROGRESS_MESSAGE = "PIN_DOWNLOADER_PROGRESS";
  const PICK_STYLE_ID = "pin-downloader-pick-style";
  const PICK_TOOLBAR_ID = "pin-downloader-pick-toolbar";
  const scanMemoryByPage = new Map();
  const pickState = {
    active: false,
    downloading: false,
    selectedPins: new Map(),
    selectedElements: new Map(),
    options: {}
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    if (message.type === "PIN_DOWNLOADER_PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (/(^|\.)youtube\.com$/.test(location.hostname) || location.hostname === 'youtu.be') {
      sendResponse({ ok: false, error: 'Bu sayfa bu sürümde desteklenmiyor.' });
      return false;
    }
    if (message.type === "PIN_DOWNLOADER_SCAN") {
      const memory = getPageMemory();
      mergePinsIntoMap(memory, collectKnownPins({ includeEmbedded: true }));
      sendResponse({
        ok: true,
        boardName: detectBoardName(),
        targetPins: detectExpectedPinCount(),
        pins: pinsFromMap(memory)
      });
      return false;
    }

    if (message.type === "PIN_DOWNLOADER_SCAN_VIDEOS") {
      sendResponse({
        ok: true,
        boardName: detectBoardName(),
        targetPins: null,
        pins: collectVideoMedia({ includeEmbedded: true })
      });
      return false;
    }

    if (message.type === "PIN_DOWNLOADER_AUTOSCROLL_SCAN") {
      autoScrollAndScan(message.options || {})
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error) }));
      return true;
    }

    if (message.type === "PIN_DOWNLOADER_START_PICK") {
      enterPickMode(message.options || {});
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "PIN_DOWNLOADER_STOP_PICK") {
      exitPickMode();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  async function autoScrollAndScan(options) {
    const maxScrolls = clampNumber(options.maxScrolls, 1, 1200, 500);
    const delayMs = clampNumber(options.scrollDelay, 250, 5000, 900);
    const stopAfterNoGrowth = clampNumber(options.stopAfterNoGrowth, 3, 80, 24);
    const targetPins = detectExpectedPinCount();
    const memory = getPageMemory();

    memory.clear();

    window.scrollTo({ top: 0, behavior: "instant" });
    await sleep(500);

    let visiblePins = collectKnownPins({ includeEmbedded: true });
    mergePinsIntoMap(memory, visiblePins);
    let noGrowthRounds = 0;
    let bottomRounds = 0;
    let lastScrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;

    sendProgress({
      pins: memory.size,
      targetPins,
      visiblePins: visiblePins.length,
      atBottom: isNearPageBottom(),
      scrolls: 0,
      maxScrolls
    });

    for (let index = 0; index < maxScrolls; index += 1) {
      const beforeY = window.scrollY;

      scrollTowardBottom();

      await sleep(delayMs);
      visiblePins = collectKnownPins({ includeEmbedded: false });
      const addedCount = mergePinsIntoMap(memory, visiblePins);
      const currentScrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
      const moved = Math.abs(window.scrollY - beforeY) > 8;
      const heightGrew = currentScrollHeight > lastScrollHeight + 8;
      const atBottom = isNearPageBottom();

      let lateAddedCount = 0;
      let lateHeightGrew = false;
      if (atBottom) {
        triggerLazyLoadAtBottom();
        await sleep(Math.min(Math.max(delayMs, 900), 1800));
        lateAddedCount = mergePinsIntoMap(memory, collectKnownPins({ includeEmbedded: index % 5 === 0 }));
        const lateScrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
        lateHeightGrew = lateScrollHeight > currentScrollHeight + 8;
        lastScrollHeight = Math.max(lastScrollHeight, lateScrollHeight);
      }

      sendProgress({
        pins: memory.size,
        targetPins,
        visiblePins: visiblePins.length,
        newPins: addedCount + lateAddedCount,
        atBottom,
        scrolls: index + 1,
        maxScrolls
      });

      if (addedCount === 0 && lateAddedCount === 0 && !heightGrew && !lateHeightGrew) {
        noGrowthRounds += 1;
      } else {
        noGrowthRounds = 0;
      }

      if (atBottom && !moved && addedCount === 0 && lateAddedCount === 0 && !heightGrew && !lateHeightGrew) {
        bottomRounds += 1;
      } else if (atBottom && addedCount === 0 && lateAddedCount === 0 && !heightGrew && !lateHeightGrew) {
        bottomRounds = Math.min(bottomRounds + 1, stopAfterNoGrowth);
      } else {
        bottomRounds = 0;
      }

      lastScrollHeight = Math.max(lastScrollHeight, currentScrollHeight);

      if (targetPins && memory.size >= targetPins && atBottom) {
        break;
      }

      if (bottomRounds >= 10 || (atBottom && noGrowthRounds >= Math.min(stopAfterNoGrowth, 16))) {
        break;
      }

      if (noGrowthRounds >= stopAfterNoGrowth && !heightGrew && !lateHeightGrew) {
        break;
      }
    }

    mergePinsIntoMap(memory, collectKnownPins({ includeEmbedded: true }));

    return {
      boardName: detectBoardName(),
      targetPins,
      pins: pinsFromMap(memory)
    };
  }

  function scrollTowardBottom() {
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 900;
    const currentHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
    const targetY = Math.min(window.scrollY + Math.max(viewportHeight * 0.9, 760), currentHeight);

    window.scrollTo({
      top: targetY,
      left: 0,
      behavior: "smooth"
    });
  }

  function triggerLazyLoadAtBottom() {
    const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
    window.scrollTo({ top: scrollHeight, left: 0, behavior: "instant" });

    try {
      window.dispatchEvent(new WheelEvent("wheel", {
        deltaY: 900,
        bubbles: true,
        cancelable: true
      }));
    } catch {
      // Synthetic wheel support is optional.
    }
  }

  function isNearPageBottom() {
    const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight || 0;
    return window.scrollY + viewportHeight >= scrollHeight - Math.max(viewportHeight * 0.1, 120);
  }

  function getPageMemory() {
    const key = currentPageKey();
    if (!scanMemoryByPage.has(key)) {
      scanMemoryByPage.set(key, new Map());
    }

    return scanMemoryByPage.get(key);
  }

  function currentPageKey() {
    return `${location.origin}${location.pathname}`;
  }

  function pinsFromMap(pinMap) {
    return Array.from(pinMap.values());
  }

  function mergePinsIntoMap(pinMap, pins) {
    let addedCount = 0;

    for (const pin of pins) {
      if (!pin) {
        continue;
      }

      const key = pin.id || canonicalImageKey(pin.url);
      if (!key) {
        continue;
      }

      const existing = pinMap.get(key);
      if (!existing) {
        pinMap.set(key, pin);
        addedCount += 1;
        continue;
      }

      const mergedCandidates = mergeCandidates(existing.candidates || [], pin.candidates || []);
      const best = mergedCandidates[0] || {
        url: existing.url || pin.url,
        score: Math.max(existing.score || 0, pin.score || 0)
      };

      pinMap.set(key, {
        ...existing,
        title: existing.title || pin.title,
        pinUrl: existing.pinUrl || pin.pinUrl,
        url: best.url,
        score: best.score,
        candidates: mergedCandidates
      });
    }

    return addedCount;
  }

  function collectKnownPins({ includeEmbedded }) {
    const pinMap = new Map();
    mergePinsIntoMap(pinMap, collectPins());
    mergePinsIntoMap(pinMap, collectResourcePins());

    if (includeEmbedded) {
      mergePinsIntoMap(pinMap, collectEmbeddedPins());
    }

    return pinsFromMap(pinMap);
  }

  function collectVideoMedia({ includeEmbedded }) {
    const pinMap = new Map();
    const videos = Array.from(document.querySelectorAll("video"));

    for (const video of videos) {
      const pin = pinFromVideo(video, { allowStandaloneLargeImage: true });
      if (pin) {
        mergePinsIntoMap(pinMap, [pin]);
      }
    }

    mergePinsIntoMap(pinMap, collectResourceVideos());

    if (includeEmbedded) {
      mergePinsIntoMap(pinMap, collectEmbeddedVideos());
    }

    return pinsFromMap(pinMap);
  }

  function collectPins() {
    const pins = new Map();
    const images = Array.from(document.querySelectorAll("img"));
    const videos = Array.from(document.querySelectorAll("video"));

    for (const image of images) {
      const pin = pinFromMediaElement(image, { allowStandaloneLargeImage: true });
      if (!pin) {
        continue;
      }

      mergePinsIntoMap(pins, [pin]);
    }

    for (const video of videos) {
      const pin = pinFromMediaElement(video, { allowStandaloneLargeImage: true });
      if (!pin) {
        continue;
      }

      mergePinsIntoMap(pins, [pin]);
    }

    return Array.from(pins.values());
  }

  function pinFromMediaElement(element, options = {}) {
    if (!element) {
      return null;
    }

    if (element.tagName && element.tagName.toLowerCase() === "video") {
      return pinFromVideo(element, options);
    }

    return pinFromImage(element, options);
  }

  function pinFromImage(image, options = {}) {
    if (!image) {
      return null;
    }

    const candidates = extractCandidates(image);
    if (candidates.length === 0) {
      return null;
    }

    const anchor = image.closest('a[href*="/pin/"]');
    const allowStandaloneLargeImage = Boolean(options.allowStandaloneLargeImage);
    const imageSize = Math.max(candidates[0].score || 0, image.naturalWidth || 0, image.naturalHeight || 0);

    if (!anchor && (!allowStandaloneLargeImage || imageSize < 180)) {
      return null;
    }

    const pinId = extractPinId(anchor ? anchor.href : "") || image.dataset.pinId || "";
    const key = pinId || canonicalImageKey(candidates[0].url);
    if (!key) {
      return null;
    }

    const title = extractTitle(image, anchor, pinId);
    return {
      id: key,
      title,
      pinUrl: anchor ? anchor.href : "",
      url: candidates[0].url,
      score: candidates[0].score,
      candidates
    };
  }

  function pinFromVideo(video, options = {}) {
    if (!video) {
      return null;
    }

    const anchor = video.closest('a[href*="/pin/"]');
    const pinId = extractPinId(anchor ? anchor.href : "") || video.dataset.pinId || "";

    // Do not let the poster image represent a clicked video. Pinterest often
    // places an <img> poster over the player; downloading that candidate made
    // the picker appear to support only images.
    const candidates = formatTools.orderVideoCandidates(
      mergeCandidates(
        extractVideoCandidates(video),
        extractPinVideoCandidates(video, pinId)
      ).filter((candidate) => isVideoUrl(candidate.url)),
      pickState.active ? pickState.options.outputFormat : "auto"
    );

    const allowStandaloneLargeImage = Boolean(options.allowStandaloneLargeImage);
    const bounds = video.getBoundingClientRect();
    const mediaSize = Math.max(
      candidates[0] ? candidates[0].score || 0 : 0,
      video.videoWidth || 0,
      video.videoHeight || 0,
      bounds.width || 0,
      bounds.height || 0
    );

    if (!anchor && (!allowStandaloneLargeImage || mediaSize < 180)) {
      return null;
    }

    const posterKey = canonicalImageKey(normalizeImageUrl(video.poster || video.getAttribute("poster") || ""));
    const key = pinId || posterKey || `picked-video-${Array.from(document.querySelectorAll("video")).indexOf(video) + 1}`;
    if (!key) {
      return null;
    }

    return {
      id: key,
      title: pinId ? `video-${pinId}` : "selected-video",
      pinUrl: anchor ? anchor.href : "",
      url: candidates[0] ? candidates[0].url : "",
      score: candidates[0] ? candidates[0].score : mediaSize,
      candidates,
      mediaKind: "video",
      captureFromElement: true
    };
  }

  function collectResourcePins() {
    if (!performance || typeof performance.getEntriesByType !== "function") {
      return [];
    }

    const urls = performance
      .getEntriesByType("resource")
      .map((entry) => entry && entry.name)
      .filter(Boolean);

    return pinsFromImageUrls(urls, "resource");
  }

  function collectResourceVideos() {
    if (!performance || typeof performance.getEntriesByType !== "function") {
      return [];
    }

    const urls = performance
      .getEntriesByType("resource")
      .map((entry) => entry && entry.name)
      .filter(Boolean)
      .filter(isVideoUrl);

    return pinsFromImageUrls(urls, "resource-video");
  }

  function collectEmbeddedPins() {
    const chunks = [];
    const elements = Array.from(document.querySelectorAll("script, meta, link"));

    for (const element of elements) {
      chunks.push(element.textContent || "");

      for (const attr of ["content", "href", "src", "imagesrcset"]) {
        chunks.push(element.getAttribute(attr) || "");
      }
    }

    const text = chunks
      .join(" ")
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    const urls = Array.from(text.matchAll(/https?:\/\/[^"'\s<>()]+pinimg\.com[^"'\s<>()]+?\.(?:avif|gif|jpe?g|png|webp|m4v|mov|mp4|webm)(?:\?[^"'\s<>()]*)?/gi))
      .map((match) => match[0]);

    return pinsFromImageUrls(urls, "embedded");
  }

  function collectEmbeddedVideos() {
    const chunks = [];
    const elements = Array.from(document.querySelectorAll("script, meta, link, source"));

    for (const element of elements) {
      chunks.push(element.textContent || "");

      for (const attr of ["content", "href", "src", "data-src", "data-video-src"]) {
        chunks.push(element.getAttribute(attr) || "");
      }
    }

    const text = chunks
      .join(" ")
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    const urls = Array.from(text.matchAll(/https?:\/\/[^"'\s<>()]+?\.(?:m4v|mov|mp4|webm)(?:\?[^"'\s<>()]*)?/gi))
      .map((match) => match[0]);

    return pinsFromImageUrls(urls, "embedded-video");
  }

  function pinsFromImageUrls(urls, source) {
    const pins = new Map();

    for (const rawUrl of urls) {
      const url = normalizeImageUrl(rawUrl);
      if (!url || !isSupportedMediaUrl(url) || !isLikelyPinImageUrl(url)) {
        continue;
      }

      const key = canonicalImageKey(url);
      if (!key) {
        continue;
      }

      const candidate = {
        url,
        score: scoreFromUrl(url)
      };
      const existing = pins.get(key);

      if (!existing) {
        pins.set(key, {
          id: key,
          title: source.includes("video") ? "video" : (source === "embedded" ? "embedded-pin" : "loaded-pin"),
          pinUrl: "",
          url,
          score: candidate.score,
          candidates: [candidate]
        });
        continue;
      }

      const candidates = mergeCandidates(existing.candidates || [], [candidate]);
      pins.set(key, {
        ...existing,
        url: candidates[0].url,
        score: candidates[0].score,
        candidates
      });
    }

    return pinsFromMap(pins);
  }

  function extractCandidates(image) {
    const candidates = [];

    addCandidate(candidates, image.currentSrc, image.naturalWidth || 0);
    addCandidate(candidates, image.src, image.naturalWidth || 0);

    for (const attr of ["data-src", "data-lazy-src", "data-pin-media"]) {
      addCandidate(candidates, image.getAttribute(attr), image.naturalWidth || 0);
    }

    const srcset = image.getAttribute("srcset") || "";
    for (const item of parseSrcset(srcset)) {
      addCandidate(candidates, item.url, item.score);
    }

    return mergeCandidates([], candidates);
  }

  function extractVideoCandidates(video) {
    const candidates = [];

    addCandidate(candidates, video.currentSrc, Math.max(video.videoWidth || 0, video.videoHeight || 0));
    addCandidate(candidates, video.src, Math.max(video.videoWidth || 0, video.videoHeight || 0));
    addCandidate(candidates, video.getAttribute("poster"), Math.max(video.videoWidth || 0, video.videoHeight || 0));

    for (const source of Array.from(video.querySelectorAll("source"))) {
      addCandidate(candidates, source.src, 0);
      addCandidate(candidates, source.getAttribute("src"), 0);
    }

    for (const attr of ["data-src", "data-lazy-src", "data-video-src", "data-pin-media"]) {
      addCandidate(candidates, video.getAttribute(attr), 0);
    }

    return mergeCandidates([], candidates);
  }

  function extractPinVideoCandidates(video, pinId) {
    const candidates = [];
    const chunks = [];
    const scope = video.closest('a[href*="/pin/"], [data-test-id], [role="listitem"]');

    if (scope) {
      chunks.push(scope.outerHTML || "");
    }

    if (pinId) {
      const scripts = Array.from(document.querySelectorAll("script"));

      for (const script of scripts) {
        for (const url of extractVideoUrlsFromPinJson(script.textContent || "", pinId)) {
          addCandidate(candidates, url, scoreFromUrl(url) + 50000);
        }
      }

      // Some Pinterest script tags are JavaScript wrappers rather than plain
      // JSON. Use a narrow text window only when exact JSON matching failed.
      for (const script of candidates.length === 0 ? scripts : []) {
        const text = script.textContent || "";
        let position = text.indexOf(pinId);
        let matches = 0;

        while (position >= 0 && matches < 4) {
          chunks.push(text.slice(Math.max(0, position - 24000), position + 24000));
          position = text.indexOf(pinId, position + pinId.length);
          matches += 1;
        }
      }
    }

    for (const chunk of chunks) {
      const decoded = String(chunk || "")
        .replace(/\\u002F/gi, "/")
        .replace(/\\u0026/gi, "&")
        .replace(/\\\//g, "/")
        .replace(/&amp;/g, "&");
      const urls = Array.from(decoded.matchAll(/https?:\/\/[^"'\s<>()]+?\.(?:m4v|mov|mp4|webm)(?:\?[^"'\s<>()]*)?/gi))
        .map((match) => match[0]);

      for (const url of urls) {
        addCandidate(candidates, url, scoreFromUrl(url));
      }
    }

    if (candidates.length === 0 && isOnlyPlayingVideo(video)) {
      const resources = performance && typeof performance.getEntriesByType === "function"
        ? performance.getEntriesByType("resource")
        : [];
      const latestVideo = resources
        .filter((entry) => entry && isVideoUrl(entry.name))
        .sort((a, b) => (Number(b.responseEnd) || 0) - (Number(a.responseEnd) || 0))[0];

      if (latestVideo) {
        addCandidate(candidates, latestVideo.name, scoreFromUrl(latestVideo.name));
      }
    }

    return mergeCandidates([], candidates);
  }

  function extractVideoUrlsFromPinJson(text, pinId) {
    const trimmed = String(text || "").trim();
    if (!trimmed || !trimmed.includes(pinId) || !/^[\[{]/.test(trimmed)) {
      return [];
    }

    let root;
    try {
      root = JSON.parse(trimmed);
    } catch {
      return [];
    }

    const stack = [root];
    const seen = new Set();
    const matchingObjects = [];
    let visited = 0;

    while (stack.length > 0 && visited < 75000) {
      const value = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) {
        continue;
      }
      seen.add(value);
      visited += 1;

      const ids = [value.id, value.pin_id, value.pinId]
        .filter((candidate) => candidate !== undefined && candidate !== null)
        .map(String);
      if (ids.includes(String(pinId))) {
        matchingObjects.push(value);
        continue;
      }

      for (const child of Object.values(value)) {
        if (child && typeof child === "object") {
          stack.push(child);
        }
      }
    }

    const urls = [];
    const videoPattern = /^https?:\/\/.+\.(?:m4v|mov|mp4|webm)(?:\?.*)?$/i;
    for (const object of matchingObjects) {
      const values = [object];
      const objectSeen = new Set();
      let objectVisited = 0;

      while (values.length > 0 && objectVisited < 10000) {
        const value = values.pop();
        if (typeof value === "string") {
          if (videoPattern.test(value)) {
            urls.push(value);
          }
          continue;
        }
        if (!value || typeof value !== "object" || objectSeen.has(value)) {
          continue;
        }
        objectSeen.add(value);
        objectVisited += 1;
        values.push(...Object.values(value));
      }
    }

    return Array.from(new Set(urls));
  }

  function isOnlyPlayingVideo(video) {
    const playing = Array.from(document.querySelectorAll("video")).filter((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return !candidate.paused && !candidate.ended && rect.width > 0 && rect.height > 0;
    });

    return playing.length === 1 && playing[0] === video;
  }

  function parseSrcset(srcset) {
    if (!srcset.trim()) {
      return [];
    }

    return srcset
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const pieces = part.split(/\s+/);
        const url = pieces[0];
        const descriptor = pieces[1] || "";
        let score = 0;

        if (descriptor.endsWith("w")) {
          score = Number.parseInt(descriptor, 10) || 0;
        } else if (descriptor.endsWith("x")) {
          score = Math.round((Number.parseFloat(descriptor) || 1) * 500);
        }

        return { url, score };
      });
  }

  function addCandidate(candidates, rawUrl, scoreHint) {
    const normalized = normalizeImageUrl(rawUrl);
    if (!normalized || !isSupportedMediaUrl(normalized)) {
      return;
    }

    candidates.push({
      url: normalized,
      score: Math.max(scoreHint || 0, scoreFromUrl(normalized))
    });
  }

  function mergeCandidates(existing, next) {
    const byUrl = new Map();

    for (const candidate of [...existing, ...next]) {
      if (!candidate || !candidate.url) {
        continue;
      }

      const current = byUrl.get(candidate.url);
      if (!current || candidate.score > current.score) {
        byUrl.set(candidate.url, candidate);
      }
    }

    return Array.from(byUrl.values()).sort((a, b) => b.score - a.score);
  }

  function normalizeImageUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") {
      return "";
    }

    try {
      return new URL(rawUrl, location.href).href;
    } catch {
      return "";
    }
  }

  function isSupportedMediaUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (!/^https?:$/i.test(url.protocol)) {
        return false;
      }

      return /\.(avif|gif|jpe?g|m4v|mov|mp4|png|webp|webm)(\?|$)/i.test(url.href);
    } catch {
      return false;
    }
  }

  function isLikelyPinImageUrl(rawUrl) {
    const score = scoreFromUrl(rawUrl);
    if (score >= 180) {
      return true;
    }

    try {
      const url = new URL(rawUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[0] === "originals" || parts[0] === "videos" || isVideoUrl(rawUrl);
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

  function canonicalImageKey(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length <= 1) {
        return url.pathname;
      }

      if (/^(\d+)x(?:\d+)?$/.test(parts[0]) || parts[0] === "originals") {
        return parts.slice(1).join("/");
      }

      return parts.join("/");
    } catch {
      return "";
    }
  }

  function extractPinId(rawUrl) {
    const match = String(rawUrl || "").match(/\/pin\/(\d+)/i);
    return match ? match[1] : "";
  }

  function detectExpectedPinCount() {
    const text = String(document.body ? document.body.innerText : "")
      .replace(/\s+/g, " ")
      .trim();

    const patterns = [
      /\b([\d.,]+)\s+Pins?\b/i,
      /\b([\d.,]+)\s+Pin\b/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) {
        continue;
      }

      const count = parseCompactNumber(match[1]);
      if (count > 0) {
        return count;
      }
    }

    return null;
  }

  function parseCompactNumber(rawValue) {
    const normalized = String(rawValue || "").replace(/[.,]/g, "");
    const count = Number.parseInt(normalized, 10);
    return Number.isFinite(count) ? count : null;
  }

  function enterPickMode(options) {
    const incomingBoardName = options && options.boardName && options.boardName !== "Media"
      ? options.boardName
      : "";

    pickState.active = true;
    pickState.options = {
      ...(options || {}),
      outputFormat: formatTools.normalizeOutputFormat(options && options.outputFormat),
      boardName: incomingBoardName || detectBoardName() || "Selected Pins"
    };

    ensurePickStyle();
    ensurePickToolbar();
    document.documentElement.classList.add("pin-downloader-pick-active");
    document.addEventListener("mouseover", handlePickMouseOver, true);
    document.addEventListener("mouseout", handlePickMouseOut, true);
    document.addEventListener("pointerdown", handlePickPointerDown, true);
    document.addEventListener("click", blockPickInteraction, true);
    document.addEventListener("dblclick", blockPickInteraction, true);
    document.addEventListener("auxclick", blockPickInteraction, true);
    document.addEventListener("keydown", handlePickKeydown, true);
    updatePickToolbar(pickState.options.videoOnly ? "Videolara tıkla; ardından Seçilenleri indir. Blob videolar gerçek zamanda dönüştürülür." : "Görsel veya videoya tıklayarak seç.");
  }

  function exitPickMode() {
    pickState.active = false;
    document.documentElement.classList.remove("pin-downloader-pick-active");
    document.removeEventListener("mouseover", handlePickMouseOver, true);
    document.removeEventListener("mouseout", handlePickMouseOut, true);
    document.removeEventListener("pointerdown", handlePickPointerDown, true);
    document.removeEventListener("click", blockPickInteraction, true);
    document.removeEventListener("dblclick", blockPickInteraction, true);
    document.removeEventListener("auxclick", blockPickInteraction, true);
    document.removeEventListener("keydown", handlePickKeydown, true);

    for (const element of pickState.selectedElements.values()) {
      element.classList.remove("pin-downloader-picked");
      element.classList.remove("pin-downloader-pick-hover");
    }

    pickState.selectedPins.clear();
    pickState.selectedElements.clear();
    removePickToolbar();
  }

  function handlePickMouseOver(event) {
    if (!pickState.active) {
      return;
    }

    const image = mediaElementFromEvent(event);
    if (!image || !pinFromMediaElement(image, { allowStandaloneLargeImage: true })) {
      return;
    }

    image.classList.add("pin-downloader-pick-hover");
  }

  function handlePickMouseOut(event) {
    if (!pickState.active) {
      return;
    }

    const image = mediaElementFromEvent(event);
    if (!image) {
      return;
    }

    image.classList.remove("pin-downloader-pick-hover");
  }

  function handlePickPointerDown(event) {
    if (!pickState.active) {
      return;
    }

    const toolbar = document.getElementById(PICK_TOOLBAR_ID);
    if (toolbar && event.target instanceof Node && toolbar.contains(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const image = mediaElementFromEvent(event);
    const pin = image ? pinFromMediaElement(image, { allowStandaloneLargeImage: true }) : null;
    if (!image) {
      updatePickToolbar("Bir gorsel veya videonun ustune tikla.");
      return;
    }

    if (!pin) {
      updatePickToolbar("Bu medya secilemedi.");
      return;
    }

    if (pickState.options.videoOnly && image.tagName.toLowerCase() !== 'video') {
      updatePickToolbar('Bu modda videoya tıkla. Video yüklenmediyse seçimden çık, pini açıp tekrar dene.');
      return;
    }
    togglePickedPin(pin, image);
  }

  function blockPickInteraction(event) {
    if (!pickState.active) {
      return;
    }

    const toolbar = document.getElementById(PICK_TOOLBAR_ID);
    if (toolbar && event.target instanceof Node && toolbar.contains(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function handlePickKeydown(event) {
    if (!pickState.active) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      exitPickMode();
    }
  }

  function togglePickedPin(pin, image) {
    if (pickState.selectedPins.has(pin.id)) {
      pickState.selectedPins.delete(pin.id);
      const selectedElement = pickState.selectedElements.get(pin.id);
      if (selectedElement) {
        selectedElement.classList.remove("pin-downloader-picked");
      }
      pickState.selectedElements.delete(pin.id);
      updatePickToolbar("Secimden cikarildi.");
      return;
    }

    pickState.selectedPins.set(pin.id, pin);
    pickState.selectedElements.set(pin.id, image);
    image.classList.add("pin-downloader-picked");
    updatePickToolbar(image.tagName.toLowerCase() === "video" ? "Video secildi." : "Gorsel secildi.");
  }

  function mediaElementFromEvent(event) {
    const target = event && event.target instanceof Element ? event.target : null;
    if (!target) {
      return null;
    }

    if (target.tagName && /^video$/i.test(target.tagName)) {
      return target;
    }

    let container = target;
    for (let depth = 0; container && depth < 12; depth += 1) {
      const videos = Array.from(container.querySelectorAll("video"));
      const videoAtClick = videos.find((video) => {
        const rect = video.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom;
      });

      if (videoAtClick) {
        return videoAtClick;
      }
      if (videos.length === 1 && container.matches('a[href*="/pin/"], [data-test-id], [role="listitem"]')) {
        return videos[0];
      }

      container = container.parentElement;
    }

    return target.tagName && /^img$/i.test(target.tagName) ? target : null;
  }

  function ensurePickToolbar() {
    let toolbar = document.getElementById(PICK_TOOLBAR_ID);
    if (toolbar) {
      return toolbar;
    }

    toolbar = document.createElement("div");
    toolbar.id = PICK_TOOLBAR_ID;
    toolbar.innerHTML = [
      '<span class="pin-downloader-pick-count">0 secili</span>',
      '<span class="pin-downloader-pick-format"></span>',
      '<span class="pin-downloader-pick-message">Gorsel veya videoya tiklayarak sec.</span>',
      '<button type="button" data-pin-downloader-action="download">Secilenleri indir</button>',
      '<button type="button" data-pin-downloader-action="clear">Temizle</button>',
      '<button type="button" data-pin-downloader-action="close">Cikis</button>'
    ].join("");

    toolbar.addEventListener("click", handlePickToolbarClick);
    document.documentElement.appendChild(toolbar);
    return toolbar;
  }

  function removePickToolbar() {
    const toolbar = document.getElementById(PICK_TOOLBAR_ID);
    if (toolbar) {
      toolbar.removeEventListener("click", handlePickToolbarClick);
      toolbar.remove();
    }
  }

  function handlePickToolbarClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button) {
      return;
    }

    const action = button.getAttribute("data-pin-downloader-action");
    if (action === "download") {
      downloadPickedPins();
      return;
    }

    if (action === "clear") {
      clearPickedPins();
      return;
    }

    if (action === "close") {
      exitPickMode();
    }
  }

  function clearPickedPins() {
    for (const element of pickState.selectedElements.values()) {
      element.classList.remove("pin-downloader-picked");
    }

    pickState.selectedPins.clear();
    pickState.selectedElements.clear();
    updatePickToolbar("Secimler temizlendi.");
  }

  async function downloadPickedPins() {
    if (pickState.downloading) {
      return;
    }

    const pins = pinsFromMap(pickState.selectedPins);
    if (pins.length === 0) {
      updatePickToolbar("Once gorsel veya video sec.");
      return;
    }

    pickState.downloading = true;
    updatePickToolbar("Indirme baslatiliyor.");

    let downloaded = 0;
    let failed = 0;
    let finalMessage = "";
    const directPins = [];
    const outputFormat = formatTools.normalizeOutputFormat(pickState.options.outputFormat);

    try {
      for (let index = 0; index < pins.length; index += 1) {
        const pin = pins[index];
        if (pin.mediaKind !== "video" || !pin.captureFromElement) {
          directPins.push(pin);
          continue;
        }

        const candidates = formatTools.orderVideoCandidates([
          ...(Array.isArray(pin.candidates) ? pin.candidates : []),
          ...(pin.url ? [{ url: pin.url, score: pin.score || 0 }] : [])
        ], outputFormat);
        const preparedPin = {
          ...pin,
          url: candidates[0] ? candidates[0].url : "",
          score: candidates[0] ? candidates[0].score : pin.score,
          candidates
        };
        const videoAction = formatTools.selectedVideoAction(preparedPin.url, outputFormat);

        if (videoAction === "direct") {
          if (outputFormat !== "mp4" && outputFormat !== "webm") {
            directPins.push(preparedPin);
            continue;
          }

          const directResponse = await sendPickedPinsToBackground([preparedPin], { suppressFailureReport: true });
          if ((Number(directResponse.downloaded) || 0) > 0) {
            downloaded += 1;
            continue;
          }
        }

        if (videoAction === "fail") {
          failed += 1;
          updatePickToolbar("Orijinal video adresi bulunamadi; yeniden kodlama yapilmadi.");
          continue;
        }

        const video = pickState.selectedElements.get(pin.id);
        try {
          await recordPickedVideo(video, preparedPin, index + 1, pins.length, outputFormat);
          downloaded += 1;
        } catch (error) {
          // A real direct URL is still preferable to losing the selection
          // completely when captureStream is blocked by the page.
          if ((outputFormat === "auto" || outputFormat === "original") && preparedPin.url) {
            directPins.push(preparedPin);
          } else {
            failed += 1;
            updatePickToolbar(`Video donusumu basarisiz: ${error && error.message ? error.message : error}`);
          }
        }
      }

      if (directPins.length > 0) {
        const response = await sendPickedPinsToBackground(directPins);
        downloaded += Number(response.downloaded) || 0;
        failed += Number(response.failed) || 0;
      }

      finalMessage = `Bitti: ${downloaded}/${pins.length} indirildi. Hata: ${failed}.`;
    } catch (error) {
      finalMessage = `Hata: ${error && error.message ? error.message : error}`;
    } finally {
      pickState.downloading = false;
      updatePickToolbar(finalMessage || `Bitti: ${downloaded}/${pins.length} indirildi. Hata: ${failed}.`);
    }
  }

  function sendPickedPinsToBackground(pins, optionOverrides = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: "PIN_DOWNLOADER_DOWNLOAD",
        boardName: pickState.options.boardName || detectBoardName() || "Selected Pins",
        pins,
        options: { ...pickState.options, ...optionOverrides }
      }, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error(response && response.error ? response.error : "Indirme basarisiz."));
          return;
        }
        resolve(response);
      });
    });
  }

  async function recordPickedVideo(video, pin, current, total, outputFormat) {
    if (!(video instanceof HTMLVideoElement)) {
      throw new Error("Secilen video ogesi bulunamadi.");
    }

    const capture = video.captureStream || video.mozCaptureStream;
    if (typeof capture !== "function" || typeof MediaRecorder === "undefined") {
      throw new Error("Bu Chrome surumu video+ses kaydini desteklemiyor.");
    }

    if (video.readyState < 1) {
      await waitForMediaEvent(video, "loadedmetadata", 10000);
    }

    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Video suresi okunamadi.");
    }

    const original = {
      currentTime: video.currentTime,
      muted: video.muted,
      loop: video.loop,
      playbackRate: video.playbackRate,
      paused: video.paused
    };

    let stream;
    let recorder;
    let progressTimer;

    try {
      video.pause();
      video.loop = false;
      video.playbackRate = 1;
      if (video.currentTime > 0.05) {
        video.currentTime = 0;
        await waitForMediaEvent(video, "seeked", 8000);
      }

      // Start once before captureStream so Chrome exposes both the video and
      // audio tracks, then rewind before MediaRecorder begins.
      await video.play();
      stream = capture.call(video);
      video.pause();
      if (video.currentTime > 0.05) {
        video.currentTime = 0;
        await waitForMediaEvent(video, "seeked", 8000);
      }

      const mimeType = pickRecorderMimeType(outputFormat);
      if (!mimeType && (outputFormat === "mp4" || outputFormat === "webm")) {
        throw new Error(`${outputFormat.toUpperCase()} kaydi bu Chrome surumunde desteklenmiyor.`);
      }
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks = [];

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      });

      const stopped = new Promise((resolve, reject) => {
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.addEventListener("error", (event) => reject(event.error || new Error("Kayit hatasi.")), { once: true });
      });

      recorder.start(1000);
      await video.play();
      progressTimer = setInterval(() => {
        const percent = Math.min(100, Math.round((video.currentTime / duration) * 100));
        updatePickToolbar(`%${percent} · Video ${current}/${total} ${formatTools.outputFormatLabel(outputFormat)} bicimine donusturuluyor`);
      }, 500);

      await waitForMediaEvent(video, "ended", Math.ceil((duration + 30) * 1000));
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      await stopped;

      const actualMimeType = recorder.mimeType || mimeType || "video/webm";
      const actualFormat = formatTools.mediaFormatFromMimeType(actualMimeType);
      if (!actualFormat) {
        throw new Error("Tarayicinin olusturdugu video bicimi belirlenemedi.");
      }
      if ((outputFormat === "mp4" || outputFormat === "webm") && actualFormat !== outputFormat) {
        throw new Error(`Tarayici ${outputFormat.toUpperCase()} yerine ${actualFormat.toUpperCase()} olusturdu.`);
      }
      const blob = new Blob(chunks, { type: actualMimeType });
      if (blob.size === 0) {
        throw new Error("Kaydedilen video bos.");
      }

      await downloadRecordedBlob(blob, pin, current, actualFormat, actualMimeType);
    } finally {
      clearInterval(progressTimer);
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
      video.pause();
      video.muted = original.muted;
      video.loop = original.loop;
      video.playbackRate = original.playbackRate;
      if (Number.isFinite(original.currentTime)) {
        try {
          video.currentTime = original.currentTime;
        } catch {
          // The source may have changed while recording.
        }
      }
      if (!original.paused) {
        video.play().catch(() => {});
      }
    }
  }

  function pickRecorderMimeType(outputFormat) {
    for (const type of formatTools.recorderMimeCandidates(outputFormat)) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return "";
  }

  function waitForMediaEvent(media, eventName, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${eventName} bekleme suresi doldu.`));
      }, timeoutMs);
      const onEvent = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Video oynatma hatasi."));
      };
      const cleanup = () => {
        clearTimeout(timer);
        media.removeEventListener(eventName, onEvent);
        media.removeEventListener("error", onError);
      };

      media.addEventListener(eventName, onEvent, { once: true });
      media.addEventListener("error", onError, { once: true });
    });
  }

  async function downloadRecordedBlob(blob, pin, index, actualFormat, mimeType) {
    const url = URL.createObjectURL(blob);
    const safeTitle = String(pin.title || `selected-video-${index}`)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || `selected-video-${index}`;

    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "PIN_DOWNLOADER_DOWNLOAD_RECORDED_BLOB",
          url,
          filename: `${safeTitle}.${actualFormat}`,
          mimeType,
          boardName: pickState.options.boardName || detectBoardName() || "Selected Videos",
          options: pickState.options
        }, (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          if (!response || !response.ok) {
            reject(new Error(response && response.error ? response.error : "Kaydedilen video diske yazilamadi."));
            return;
          }
          resolve(response);
        });
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function updatePickToolbar(message) {
    const toolbar = ensurePickToolbar();
    const count = toolbar.querySelector(".pin-downloader-pick-count");
    const format = toolbar.querySelector(".pin-downloader-pick-format");
    const status = toolbar.querySelector(".pin-downloader-pick-message");
    const downloadButton = toolbar.querySelector('[data-pin-downloader-action="download"]');
    const selectedCount = pickState.selectedPins.size;

    if (count) {
      count.textContent = `${selectedCount} secili`;
    }

    if (format) {
      format.textContent = formatTools.outputFormatLabel(pickState.options.outputFormat);
    }

    if (status) {
      status.textContent = message || "";
    }

    if (downloadButton) {
      downloadButton.disabled = selectedCount === 0 || pickState.downloading;
    }
  }

  function ensurePickStyle() {
    if (document.getElementById(PICK_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = PICK_STYLE_ID;
    style.textContent = `
      html.pin-downloader-pick-active,
      html.pin-downloader-pick-active * {
        cursor: crosshair !important;
      }

      .pin-downloader-pick-hover {
        outline: 4px solid rgba(189, 8, 28, 0.65) !important;
        outline-offset: 3px !important;
      }

      .pin-downloader-picked {
        outline: 5px solid #0a7f48 !important;
        outline-offset: 4px !important;
        filter: saturate(1.1) brightness(0.92) !important;
      }

      #${PICK_TOOLBAR_ID} {
        position: fixed !important;
        z-index: 2147483647 !important;
        left: 50% !important;
        top: 14px !important;
        transform: translateX(-50%) !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        width: min(960px, calc(100vw - 24px)) !important;
        max-width: calc(100vw - 24px) !important;
        padding: 9px 10px !important;
        border: 1px solid rgba(20, 24, 28, 0.18) !important;
        border-radius: 8px !important;
        background: #ffffff !important;
        color: #1f2328 !important;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18) !important;
        font: 12px/1.2 Inter, Segoe UI, system-ui, sans-serif !important;
      }

      #${PICK_TOOLBAR_ID} * {
        cursor: default !important;
      }

      #${PICK_TOOLBAR_ID} .pin-downloader-pick-count {
        min-width: 64px !important;
        font-weight: 750 !important;
      }

      #${PICK_TOOLBAR_ID} .pin-downloader-pick-format {
        padding: 4px 7px !important;
        border-radius: 999px !important;
        background: #fbe8e5 !important;
        color: #8f1020 !important;
        font-weight: 700 !important;
        white-space: nowrap !important;
      }

      #${PICK_TOOLBAR_ID} .pin-downloader-pick-message {
        flex: 1 1 420px !important;
        min-width: 0 !important;
        max-width: none !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        color: #5b626b !important;
      }

      #${PICK_TOOLBAR_ID} button {
        min-height: 30px !important;
        border: 1px solid #d0d5da !important;
        border-radius: 7px !important;
        background: #ffffff !important;
        color: #1f2328 !important;
        padding: 0 10px !important;
        font: 12px/1 Inter, Segoe UI, system-ui, sans-serif !important;
      }

      #${PICK_TOOLBAR_ID} button[data-pin-downloader-action="download"] {
        border-color: #bd081c !important;
        background: #bd081c !important;
        color: #ffffff !important;
      }

      #${PICK_TOOLBAR_ID} button:disabled {
        opacity: 0.48 !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function extractTitle(image, anchor, pinId) {
    const alt = (image.getAttribute("alt") || "").trim();
    if (alt && !/^image$/i.test(alt)) {
      return alt;
    }

    const aria = anchor ? (anchor.getAttribute("aria-label") || "").trim() : "";
    if (aria) {
      return aria;
    }

    return pinId ? `pin-${pinId}` : "pin";
  }

  function detectBoardName() {
    const h1 = firstCleanText(document.querySelector("h1"));
    if (h1) {
      return h1;
    }

    const metaTitle = document.querySelector('meta[property="og:title"], meta[name="title"]');
    const metaText = metaTitle ? cleanBoardTitle(metaTitle.getAttribute("content") || "") : "";
    if (metaText) {
      return metaText;
    }

    const pageTitle = cleanBoardTitle(document.title || "");
    if (pageTitle) {
      return pageTitle;
    }

    const pathParts = location.pathname.split("/").filter(Boolean);
    return decodeURIComponent(pathParts[pathParts.length - 1] || "Media").replace(/[-_]+/g, " ");
  }

  function firstCleanText(element) {
    if (!element) {
      return "";
    }

    return cleanBoardTitle(element.textContent || "");
  }

  function cleanBoardTitle(text) {
    return String(text || "")
      .replace(/\s*\|\s*Pinterest\s*$/i, "")
      .replace(/\s*-\s*Pinterest\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function sendProgress(payload) {
    try {
      chrome.runtime.sendMessage({
        type: PROGRESS_MESSAGE,
        ...payload
      }, () => {
        // The popup is often closed while an auto-scroll scan is still running.
        void chrome.runtime.lastError;
      });
    } catch {
      // Progress messages are optional; the popup may be closed.
    }
  }
})();
