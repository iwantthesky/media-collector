// Offscreen worker: assembles HLS (.m3u8) streams into a single downloadable
// file. It runs in an extension page context so it can use fetch (cross-origin
// reads via host permissions), Web Crypto for AES-128, and URL.createObjectURL,
// none of which behave the same way inside the service worker.

const HLS_PROGRESS_MESSAGE = "PIN_DOWNLOADER_HLS_PROGRESS";
const FETCH_TIMEOUT_MS = 30000;
const MAX_FETCH_ATTEMPTS = 7;
const RETRY_BASE_DELAY_MS = 800;
const RATE_LIMIT_DELAY_MS = 8000;
const MAX_RETRY_DELAY_MS = 45000;
const MAX_SEGMENTS = 20000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "OFFSCREEN_PING") {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "OFFSCREEN_DOWNLOAD_HLS") {
    assembleHlsVideo(String(message.url || ""), message.concurrency)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: String(error && error.message ? error.message : error)
        });
      });
    return true;
  }

  return false;
});

async function assembleHlsVideo(playlistUrl, concurrency = 3) {
  if (!/^https?:\/\//i.test(playlistUrl)) {
    throw new Error("Gecersiz HLS adresi.");
  }

  reportProgress(0, 0, "Playlist okunuyor");

  const job = { controller: new AbortController(), retryAt: 0 };
  let { url: mediaUrl, text: playlistText } = await fetchPlaylist(playlistUrl, job);

  // A master playlist lists quality variants instead of segments. Follow the
  // highest-bandwidth variant down to an actual media playlist.
  for (let depth = 0; depth < 3 && isMasterPlaylist(playlistText); depth += 1) {
    const variants = parseMasterPlaylist(playlistText, mediaUrl);
    if (variants.length === 0) {
      throw new Error("HLS master playlist icinde video kalitesi bulunamadi.");
    }
    // Prefer a muxed variant when the master playlist offers one. Some CDNs
    // expose a video-only rendition with a separate AUDIO group first; using
    // that rendition produces a silent file even though the video is valid.
    variants.sort((a, b) => {
      const aMuxed = a.audioGroup ? 0 : 1;
      const bMuxed = b.audioGroup ? 0 : 1;
      return (bMuxed - aMuxed) || (b.bandwidth - a.bandwidth);
    });
    ({ url: mediaUrl, text: playlistText } = await fetchPlaylist(variants[0].url, job));
  }

  const playlist = parseMediaPlaylist(playlistText, mediaUrl);

  if (playlist.segments.length === 0) {
    throw new Error("HLS playlist icinde indirilecek parca bulunamadi.");
  }
  if (playlist.segments.length > MAX_SEGMENTS) {
    throw new Error(`Bu akis cok uzun (${playlist.segments.length} parca). Muhtemelen canli yayin.`);
  }

  const total = playlist.segments.length;
  const buffers = new Array(total);
  const keyCache = new Map();

  let completed = 0;
  let cursor = 0;

  reportProgress(0, total, "Parcalar indiriliyor");

  async function downloadPart(index) {
    buffers[index] = await fetchSegment(
      playlist.segments[index],
      playlist.mediaSequence + index,
      keyCache,
      job
    );
    completed += 1;
    reportProgress(completed, total, "Parcalar indiriliyor");
  }

  // Use the first response in the output and stop early on an access refusal.
  await downloadPart(cursor++);
  const workers = Array.from({ length: Math.min(concurrency, total - 1) }, async () => {
    while (cursor < total && !job.controller.signal.aborted) {
      await downloadPart(cursor++);
    }
  });
  try {
    await Promise.all(workers);
  } catch (error) {
    job.controller.abort(error);
    throw error;
  }

  reportProgress(total, total, "Dosya birlestiriliyor");

  const parts = [];
  if (playlist.mapUrl) {
    parts.push(new Uint8Array(await fetchBuffer(playlist.mapUrl, "", job)));
  }
  for (const buffer of buffers) {
    parts.push(new Uint8Array(buffer));
  }

  let totalBytes = 0;
  for (const part of parts) {
    totalBytes += part.byteLength;
  }
  if (totalBytes === 0) {
    throw new Error("Indirilen parcalar bos. Akis korumali olabilir.");
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }

  const isFragmentedMp4 = Boolean(playlist.mapUrl);
  const extension = isFragmentedMp4 ? "mp4" : "ts";
  const mimeType = isFragmentedMp4 ? "video/mp4" : "video/mp2t";
  const blob = new Blob([combined], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);

  return {
    ok: true,
    blobUrl,
    bytes: totalBytes,
    segments: total,
    suggestedName: buildSuggestedName(playlistUrl, extension)
  };
}

async function fetchSegment(segment, sequenceNumber, keyCache, job) {
  let data = await fetchBuffer(segment.url, segment.byteRange, job);

  if (segment.key && /^AES-128$/i.test(segment.key.method)) {
    data = await decryptSegment(data, segment.key, sequenceNumber, keyCache, job);
  } else if (segment.key && segment.key.method && !/^NONE$/i.test(segment.key.method)) {
    throw new Error(`Desteklenmeyen sifreleme yontemi: ${segment.key.method}`);
  }

  return data;
}

async function decryptSegment(data, key, sequenceNumber, keyCache, job) {
  if (!key.uri) {
    throw new Error("AES-128 anahtar adresi playlist'te yok.");
  }

  if (!keyCache.has(key.uri)) {
    keyCache.set(key.uri, fetchBuffer(key.uri, "", job).then(rawKey => {
      if (rawKey.byteLength !== 16) {
        throw new Error("AES-128 anahtari 16 bayt degil.");
      }
      return crypto.subtle.importKey("raw", rawKey, { name: "AES-CBC" }, false, ["decrypt"]);
    }));
  }
  const cryptoKey = await keyCache.get(key.uri);

  let iv = key.iv;
  if (!iv) {
    iv = new Uint8Array(16);
    new DataView(iv.buffer).setUint32(12, sequenceNumber >>> 0);
  }

  return crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, data);
}

function isMasterPlaylist(text) {
  return /#EXT-X-STREAM-INF/i.test(text);
}

function parseMasterPlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const variants = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!/^#EXT-X-STREAM-INF:/i.test(line)) {
      continue;
    }

    const attributes = parseAttributes(line.slice(line.indexOf(":") + 1));
    let uri = "";
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j].trim();
      if (!candidate || candidate.startsWith("#")) {
        continue;
      }
      uri = candidate;
      break;
    }

    if (!uri) {
      continue;
    }

    variants.push({
      url: resolveUrl(uri, baseUrl),
      bandwidth: Number(attributes.BANDWIDTH || attributes["AVERAGE-BANDWIDTH"] || 0),
      resolution: attributes.RESOLUTION || "",
      audioGroup: attributes.AUDIO || ""
    });
  }

  return variants;
}

function parseMediaPlaylist(text, baseUrl) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const segments = [];
  const byteOffsets = new Map();

  let currentKey = null;
  let mapUrl = "";
  let mediaSequence = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }

    if (/^#EXT-X-MEDIA-SEQUENCE:/i.test(line)) {
      mediaSequence = Number(line.split(":")[1]) || 0;
      continue;
    }

    if (/^#EXT-X-KEY:/i.test(line)) {
      const attributes = parseAttributes(line.slice(line.indexOf(":") + 1));
      if (!attributes.METHOD || /^NONE$/i.test(attributes.METHOD)) {
        currentKey = null;
      } else {
        currentKey = {
          method: attributes.METHOD,
          uri: attributes.URI ? resolveUrl(attributes.URI, baseUrl) : "",
          iv: attributes.IV ? hexToBytes(attributes.IV) : null
        };
      }
      continue;
    }

    if (/^#EXT-X-MAP:/i.test(line)) {
      const attributes = parseAttributes(line.slice(line.indexOf(":") + 1));
      if (attributes.URI) {
        mapUrl = resolveUrl(attributes.URI, baseUrl);
      }
      continue;
    }

    // Only an #EXTINF tag introduces a media segment. Every other line is
    // ignored here, which stops a stray query string or title fragment from
    // being mistaken for a segment of its own.
    if (!/^#EXTINF:/i.test(line)) {
      continue;
    }

    const commaIndex = line.indexOf(",");
    const title = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : "";

    // Locate the segment URI line that belongs to this #EXTINF tag.
    let byteRangeTag = "";
    let uriLine = "";
    let cursor = i + 1;
    for (; cursor < lines.length; cursor += 1) {
      const next = lines[cursor];
      if (!next) {
        continue;
      }
      if (/^#EXT-X-BYTERANGE:/i.test(next)) {
        byteRangeTag = (next.split(":")[1] || "").trim();
        continue;
      }
      if (next.startsWith("#")) {
        if (/^#EXTINF:/i.test(next)) {
          break;
        }
        continue;
      }
      uriLine = next;
      break;
    }

    if (!uriLine) {
      i = cursor - 1;
      continue;
    }

    // Some token-protected CDNs split the URI across two lines: the file name
    // on one line and the "?token" query string on the next. Join them back.
    let lookAhead = cursor + 1;
    while (lookAhead < lines.length && lines[lookAhead].startsWith("?")) {
      uriLine += lines[lookAhead];
      lookAhead += 1;
    }

    // Other CDNs leave only the "?token" on the URI line and keep the file
    // name in the #EXTINF title. Rebuild the real reference from both halves.
    let segmentRef = uriLine;
    if (uriLine.startsWith("?") && title && !/[?=&]/.test(title)) {
      segmentRef = title + uriLine;
    }

    const url = resolveUrl(segmentRef, baseUrl);

    let byteRange = "";
    if (byteRangeTag) {
      const [lengthPart, offsetPart] = byteRangeTag.split("@");
      const length = Number(lengthPart);
      const offset = offsetPart !== undefined
        ? Number(offsetPart)
        : (byteOffsets.get(url) || 0);
      if (Number.isFinite(length) && length > 0) {
        byteRange = `bytes=${offset}-${offset + length - 1}`;
        byteOffsets.set(url, offset + length);
      }
    }

    segments.push({ url, key: currentKey, byteRange });
    i = lookAhead - 1;
  }

  return { segments, mapUrl, mediaSequence };
}

function parseAttributes(text) {
  const attributes = {};
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    attributes[match[1].toUpperCase()] = value;
  }

  return attributes;
}

function resolveUrl(uri, baseUrl) {
  try {
    const resolved = new URL(uri, baseUrl);

    // Token-protected CDNs (e.g. ?validto=...&ipa=...&hd1=...) usually list
    // segments as bare relative names. If a resolved URL has no query string of
    // its own, inherit the playlist's query string so the access token travels
    // with every segment, key and map request.
    if (!resolved.search) {
      const base = new URL(baseUrl);
      if (base.search) {
        resolved.search = base.search;
      }
    }

    return resolved.href;
  } catch {
    return uri;
  }
}

function hexToBytes(hex) {
  const clean = String(hex || "").replace(/^0x/i, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Number.parseInt(clean.substr(i * 2, 2), 16) || 0;
  }
  return bytes;
}

function buildSuggestedName(playlistUrl, extension) {
  let base = "video";

  try {
    const parts = new URL(playlistUrl).pathname.split("/").filter(Boolean);
    const last = (parts.pop() || "").replace(/\.(m3u8|mpd)$/i, "");
    const cleanedLast = last.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
    const generic = /^(index|playlist|master|manifest|video|media|hls|stream)$/i;

    if (cleanedLast && !generic.test(cleanedLast)) {
      base = cleanedLast.slice(0, 60);
    } else if (parts.length > 0) {
      const folder = parts.pop().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
      base = folder ? folder.slice(0, 60) : "video";
    }
  } catch {
    base = "video";
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${base}_${stamp}.${extension}`;
}

async function fetchPlaylist(url, job) {
  return fetchWithRetry(url, job, {}, async response => {
    const text = (await response.text()).trimStart();
    if (!/^#EXTM3U(?:\r?\n|$)/.test(text)) {
      throw new Error("Sunucu geçerli bir HLS listesi döndürmedi.");
    }
    return { url: response.url || url, text };
  });
}

async function fetchBuffer(url, byteRange, job) {
  const headers = byteRange ? { Range: byteRange } : {};
  return fetchWithRetry(url, job, headers, response => response.arrayBuffer());
}

async function fetchWithRetry(url, job, headers, consume) {
  const signal = job.controller.signal;
  let lastError;

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
    while (job.retryAt > Date.now()) {
      await sleep(job.retryAt - Date.now(), signal);
    }
    signal.throwIfAborted();

    const request = new AbortController();
    const abortRequest = () => request.abort(signal.reason);
    signal.addEventListener("abort", abortRequest, { once: true });
    const timer = setTimeout(() => request.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        headers,
        signal: request.signal
      });
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
    } finally {
      if (!response?.ok) {
        clearTimeout(timer);
        signal.removeEventListener("abort", abortRequest);
      }
    }

    if (response?.ok) {
      try {
        return await consume(response);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abortRequest);
      }
    }

    let delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
    if (response) {
      void response.body?.cancel().catch(() => {});
      const status = response.status;
      if (status === 401 || status === 403) {
        throw new Error("Sunucu HLS kaynağına erişimi reddetti (HTTP " + status + ").");
      }
      lastError = new Error("HLS kaynağı HTTP " + status + " döndürdü.");
      if (![408, 425, 429, 500, 502, 503, 504].includes(status)) {
        break;
      }

      const requestedDelay = parseRetryAfter(response.headers.get("retry-after"));
      if (requestedDelay !== null && requestedDelay > MAX_RETRY_DELAY_MS) {
        throw new Error("Sunucu " + Math.ceil(requestedDelay / 1000) + " saniye beklemeyi istedi. HLS indirmesi durduruldu (HTTP " + status + ").");
      }
      delay = requestedDelay ?? (status === 429 ? Math.min(RATE_LIMIT_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS) : delay);
      if (status === 429 || requestedDelay !== null) {
        job.retryAt = Math.max(job.retryAt, Date.now() + delay);
      }
    }

    if (attempt < MAX_FETCH_ATTEMPTS - 1) {
      await sleep(delay, signal);
    }
  }

  throw lastError || new Error("HLS kaynağı indirilemedi.");
}

function parseRetryAfter(value, now = Date.now()) {
  const text = typeof value === "string" ? value.trim() : "";
  if (/^\d+$/.test(text)) {
    return Number(text) * 1000;
  }
  if (!/[a-z]/i.test(text)) {
    return null;
  }
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function reportProgress(done, total, phase) {
  try {
    chrome.runtime.sendMessage({
      type: HLS_PROGRESS_MESSAGE,
      done,
      total,
      phase
    }, () => {
      // The popup is often closed during a long download.
      void chrome.runtime.lastError;
    });
  } catch {
    // Progress is best effort.
  }
}

function sleep(ms, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
