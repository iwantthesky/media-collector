(function initMediaCollectorFormat(globalScope) {
  const OUTPUT_FORMATS = new Set(["auto", "original", "mp4", "webm"]);

  function normalizeOutputFormat(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return OUTPUT_FORMATS.has(normalized) ? normalized : "auto";
  }

  function mediaFormatFromUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""));
      const match = url.pathname.match(/\.([a-z0-9]+)$/i);
      if (!match) {
        return "";
      }

      const extension = match[1].toLowerCase();
      if (extension === "m4v") {
        return "mp4";
      }
      return ["mp4", "webm", "mov"].includes(extension) ? extension : "";
    } catch {
      return "";
    }
  }

  function mediaFormatFromMimeType(mimeType) {
    const normalized = String(mimeType || "").toLowerCase();
    if (normalized.includes("video/mp4")) {
      return "mp4";
    }
    if (normalized.includes("video/webm")) {
      return "webm";
    }
    return "";
  }

  function preferredTarget(outputFormat) {
    const normalized = normalizeOutputFormat(outputFormat);
    if (normalized === "webm") {
      return "webm";
    }
    return normalized === "auto" || normalized === "mp4" ? "mp4" : "";
  }

  function orderVideoCandidates(candidates, outputFormat) {
    const target = preferredTarget(outputFormat);
    return (Array.isArray(candidates) ? candidates : [])
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate && typeof candidate.url === "string")
      .sort((left, right) => {
        const leftPreferred = target && mediaFormatFromUrl(left.candidate.url) === target ? 1 : 0;
        const rightPreferred = target && mediaFormatFromUrl(right.candidate.url) === target ? 1 : 0;
        if (leftPreferred !== rightPreferred) {
          return rightPreferred - leftPreferred;
        }

        const scoreDifference = (Number(right.candidate.score) || 0) - (Number(left.candidate.score) || 0);
        return scoreDifference || left.index - right.index;
      })
      .map(({ candidate }) => candidate);
  }

  function conversionDecision(rawUrl, outputFormat) {
    const normalized = normalizeOutputFormat(outputFormat);
    if (normalized !== "mp4" && normalized !== "webm") {
      return { needsConversion: false, targetFormat: "" };
    }

    return {
      needsConversion: mediaFormatFromUrl(rawUrl) !== normalized,
      targetFormat: normalized
    };
  }

  function selectedVideoAction(rawUrl, outputFormat) {
    const normalized = normalizeOutputFormat(outputFormat);
    if (rawUrl) {
      return conversionDecision(rawUrl, normalized).needsConversion ? "record" : "direct";
    }
    return normalized === "original" ? "fail" : "record";
  }

  function recorderMimeCandidates(outputFormat) {
    const webm = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];

    const normalized = normalizeOutputFormat(outputFormat);
    if (normalized === "original") {
      return [];
    }
    return webm;
  }

  function recorderBitrates(width, height) {
    const pixels = Math.max(0, Number(width) || 0) * Math.max(0, Number(height) || 0);
    let videoBitsPerSecond = 4_000_000;

    if (pixels > 1920 * 1080) {
      videoBitsPerSecond = 20_000_000;
    } else if (pixels > 1280 * 720) {
      videoBitsPerSecond = 12_000_000;
    } else if (pixels > 640 * 480) {
      videoBitsPerSecond = 8_000_000;
    }

    return {
      videoBitsPerSecond,
      audioBitsPerSecond: 192_000
    };
  }

  function outputFormatLabel(outputFormat) {
    return {
      auto: "Otomatik · MP4 öncelikli",
      original: "Orijinal",
      mp4: "MP4 öncelikli · WebM yedek",
      webm: "WebM · güvenli kayıt"
    }[normalizeOutputFormat(outputFormat)];
  }

  globalScope.MediaCollectorFormat = Object.freeze({
    conversionDecision,
    mediaFormatFromMimeType,
    mediaFormatFromUrl,
    normalizeOutputFormat,
    orderVideoCandidates,
    outputFormatLabel,
    recorderBitrates,
    recorderMimeCandidates,
    selectedVideoAction
  });
})(globalThis);
