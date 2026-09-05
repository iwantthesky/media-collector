// Offscreen worker: assembles HLS (.m3u8) streams into a single downloadable
// file. It runs in an extension page context so it can use fetch (cross-origin
// reads via host permissions), Web Crypto for AES-128, and URL.createObjectURL,
// none of which behave the same way inside the service worker.

const HLS_PROGRESS_MESSAGE = "PIN_DOWNLOADER_HLS_PROGRESS";
const FETCH_TIMEOUT_MS = 30000;
const SEGMENT_CONCURRENCY = 6;
const MAX_FETCH_ATTEMPTS = 7;
const RETRY_BASE_DELAY_MS = 800;
const RATE_LIMIT_DELAY_MS = 8000;
const MAX_RETRY_DELAY_MS = 45000;
const MAX_SEGMENTS = 20000;

let rateLimitCooldownUntil = 0;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "OFFSCREEN_PING") {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "OFFSCREEN_DOWNLOAD_HLS") {
    assembleHlsVideo(String(message.url || ""))
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

async function assembleHlsVideo(playlistUrl) {
  if (!/^https?:\/\//i.test(playlistUrl)) {
    throw new Error("Gecersiz HLS adresi.");
  }

  reportProgress(0, 0, "Playlist okunuyor");

  let mediaUrl = playlistUrl;
  let playlistText = await fetchText(playlistUrl);

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
    mediaUrl = variants[0].url;
    playlistText = await fetchText(mediaUrl);
  }

  const playlist = parseMediaPlaylist(playlistText, mediaUrl);

  if (playlist.segments.length === 0) {
    sendDiagnostic("Playlist icinde #EXTINF segmenti bulunamadi.\nIlk 18 ham satir: " +
      JSON.stringify(playlistText.split(/\r?\n/).slice(0, 18)));
    throw new Error("HLS playlist icinde indirilecek parca bulunamadi.");
  }
  if (playlist.segments.length > MAX_SEGMENTS) {
    throw new Error(`Bu akis cok uzun (${playlist.segments.length} parca). Muhtemelen canli yayin.`);
  }

  // Test-download the first segment so the exact HTTP failure is visible before
  // attempting all of them.
  const probe = await probeFirstSegment(mediaUrl, playlist);
  sendDiagnostic(probe.report);
  if (!probe.ok) {
    throw new Error(`İlk parça indirilemedi: HTTP ${probe.status}. Adresin süresi dolmuş veya sunucu erişimi sınırlamış olabilir.`);
  }

  const total = playlist.segments.length;
  const buffers = new Array(total);
  const keyCache = new Map();

  let completed = 0;
  let cursor = 0;

  reportProgress(0, total, "Parcalar indiriliyor");

  async function worker() {
    while (cursor < total) {
      const index = cursor;
      cursor += 1;
      buffers[index] = await fetchSegment(
        playlist.segments[index],
        playlist.mediaSequence + index,
        keyCache
      );
      completed += 1;
      reportProgress(completed, total, "Parcalar indiriliyor");
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(SEGMENT_CONCURRENCY, total); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  reportProgress(total, total, "Dosya birlestiriliyor");

  const parts = [];
  if (playlist.mapUrl) {
    parts.push(new Uint8Array(await fetchBuffer(playlist.mapUrl)));
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

async function fetchSegment(segment, sequenceNumber, keyCache) {
  let data = await fetchBuffer(segment.url, segment.byteRange);

  if (segment.key && /^AES-128$/i.test(segment.key.method)) {
    data = await decryptSegment(data, segment.key, sequenceNumber, keyCache);
  } else if (segment.key && segment.key.method && !/^NONE$/i.test(segment.key.method)) {
    throw new Error(`Desteklenmeyen sifreleme yontemi: ${segment.key.method}`);
  }

  return data;
}

async function decryptSegment(data, key, sequenceNumber, keyCache) {
  if (!key.uri) {
    throw new Error("AES-128 anahtar adresi playlist'te yok.");
  }

  let cryptoKey = keyCache.get(key.uri);
  if (!cryptoKey) {
    const rawKey = await fetchBuffer(key.uri);
    if (rawKey.byteLength !== 16) {
      throw new Error("AES-128 anahtari 16 bayt degil.");
    }
    cryptoKey = await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );
    keyCache.set(key.uri, cryptoKey);
  }

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

async function probeFirstSegment(mediaUrl, playlist) {
  const lines = [];
  const segment = playlist.segments[0];

  lines.push(`Cozulen parca sayisi: ${playlist.segments.length}`);
  lines.push(`Sifreleme: ${segment && segment.key ? segment.key.method : "yok"}`);
  lines.push(`Init (EXT-X-MAP): ${playlist.mapUrl || "yok"}`);

  try {
    const media = new URL(mediaUrl);
    lines.push(`m3u8 host : ${media.hostname}`);
    lines.push(`m3u8 path : ${media.pathname}`);
    lines.push(`m3u8 query: ${media.search || "(yok)"}`);
  } catch {
    lines.push(`m3u8 adresi cozulemedi: ${mediaUrl}`);
  }

  if (!segment) {
    return { ok: false, status: 0, report: lines.join("\n") };
  }

  try {
    const seg = new URL(segment.url);
    lines.push(`seg[0] host : ${seg.hostname}`);
    lines.push(`seg[0] path : ${seg.pathname}`);
    lines.push(`seg[0] query: ${seg.search || "(yok)"}`);
  } catch {
    lines.push(`seg[0] adresi cozulemedi: ${segment.url}`);
  }

  let ok = false;
  let status = 0;

  try {
    const response = await fetch(segment.url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      redirect: "follow"
    });
    status = response.status;
    ok = response.ok || response.status === 206;
    lines.push(`seg[0] HTTP cevabi  : ${response.status} ${response.statusText}`);
    lines.push(`seg[0] content-type : ${response.headers.get("content-type") || "(yok)"}`);
    lines.push(`seg[0] content-uzunluk: ${response.headers.get("content-length") || "(yok)"}`);

    if (ok) {
      lines.push("seg[0] ERISILEBILIR - tam indirme devam ediyor.");
    } else {
      const body = await response.text();
      lines.push(`seg[0] hata govdesi (ilk 350): ${body.slice(0, 350).replace(/\s+/g, " ").trim()}`);
    }
  } catch (error) {
    lines.push(`seg[0] FETCH HATASI: ${error && error.message ? error.message : error}`);
  }

  return { ok, status, report: lines.join("\n") };
}

async function fetchText(url) {
  const response = await fetchWithRetry(url);
  return response.text();
}

async function fetchBuffer(url, byteRange) {
  const headers = {};
  if (byteRange) {
    headers.Range = byteRange;
  }
  const response = await fetchWithRetry(url, headers);
  return response.arrayBuffer();
}

async function fetchWithRetry(url, headers) {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
    await waitForRateLimitCooldown();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        headers: headers || {},
        signal: controller.signal
      });

      if (!response.ok && response.status !== 206) {
        const retryable = isRetryableStatus(response.status);
        const retryDelay = getRetryDelay(response, attempt);
        const body = attempt === MAX_FETCH_ATTEMPTS - 1 || !retryable
          ? await readErrorSnippet(response)
          : "";

        lastError = new Error(
          `HTTP ${response.status}${body ? ` - ${body}` : ""}`
        );

        if (!retryable || attempt === MAX_FETCH_ATTEMPTS - 1) {
          break;
        }

        if (response.status === 429) {
          extendRateLimitCooldown(retryDelay);
        }

        await sleep(retryDelay);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_FETCH_ATTEMPTS - 1) {
        break;
      }
      await sleep(getRetryDelay(null, attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  const reason = lastError && lastError.message ? lastError.message : String(lastError);
  throw new Error(`Indirilemedi (${url.slice(0, 300)}): ${reason}`);
}

async function waitForRateLimitCooldown() {
  const delay = rateLimitCooldownUntil - Date.now();
  if (delay > 0) {
    await sleep(delay);
  }
}

function extendRateLimitCooldown(delay) {
  rateLimitCooldownUntil = Math.max(rateLimitCooldownUntil, Date.now() + delay);
}

function isRetryableStatus(status) {
  return status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504;
}

function getRetryDelay(response, attempt) {
  const retryAfter = response ? parseRetryAfter(response.headers.get("retry-after")) : 0;
  if (retryAfter > 0) {
    return retryAfter;
  }

  const isRateLimited = response && response.status === 429;
  const baseDelay = isRateLimited ? RATE_LIMIT_DELAY_MS : RETRY_BASE_DELAY_MS;
  const delay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(delay + jitter, MAX_RETRY_DELAY_MS);
}

function parseRetryAfter(value) {
  if (!value) {
    return 0;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.min(Math.max(seconds * 1000, 0), MAX_RETRY_DELAY_MS);
  }

  const dateTime = Date.parse(value);
  if (!Number.isNaN(dateTime)) {
    return Math.min(Math.max(dateTime - Date.now(), 0), MAX_RETRY_DELAY_MS);
  }

  return 0;
}

async function readErrorSnippet(response) {
  try {
    const body = await response.text();
    return body.slice(0, 220).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendDiagnostic() {} // Private playlist diagnostics are never broadcast.
