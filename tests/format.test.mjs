import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../format-utils.js", import.meta.url), "utf8");
const context = vm.createContext({ URL });
vm.runInContext(source, context, { filename: "format-utils.js" });
const format = context.MediaCollectorFormat;

test("output format values are normalized safely", () => {
  assert.equal(format.normalizeOutputFormat("MP4"), "mp4");
  assert.equal(format.normalizeOutputFormat("webm"), "webm");
  assert.equal(format.normalizeOutputFormat("original"), "original");
  assert.equal(format.normalizeOutputFormat("invalid"), "auto");
});

test("media formats are read from URL paths without query or hash noise", () => {
  assert.equal(format.mediaFormatFromUrl("https://cdn.example/video.MP4?token=1#part"), "mp4");
  assert.equal(format.mediaFormatFromUrl("https://cdn.example/video.m4v?token=1"), "mp4");
  assert.equal(format.mediaFormatFromUrl("https://cdn.example/video.webm"), "webm");
  assert.equal(format.mediaFormatFromUrl("https://cdn.example/video"), "");
});

test("automatic mode prefers MP4 before higher-scored WebM and stays stable", () => {
  const candidates = [
    { url: "https://cdn.example/high.webm", score: 9000 },
    { url: "https://cdn.example/first.mp4", score: 100 },
    { url: "https://cdn.example/second.mp4", score: 100 }
  ];
  assert.deepEqual(
    Array.from(format.orderVideoCandidates(candidates, "auto"), (item) => item.url),
    ["https://cdn.example/first.mp4", "https://cdn.example/second.mp4", "https://cdn.example/high.webm"]
  );
});

test("explicit WebM mode prefers WebM and original mode follows score", () => {
  const candidates = [
    { url: "https://cdn.example/a.mp4", score: 10 },
    { url: "https://cdn.example/b.webm", score: 1 }
  ];
  assert.equal(format.orderVideoCandidates(candidates, "webm")[0].url, candidates[1].url);
  assert.equal(format.orderVideoCandidates(candidates, "original")[0].url, candidates[0].url);
});

test("conversion decisions never confuse renaming with conversion", () => {
  assert.deepEqual(
    { ...format.conversionDecision("https://cdn.example/a.webm", "mp4") },
    { needsConversion: true, targetFormat: "mp4" }
  );
  assert.deepEqual(
    { ...format.conversionDecision("https://cdn.example/a.mp4", "mp4") },
    { needsConversion: false, targetFormat: "mp4" }
  );
  assert.equal(format.conversionDecision("https://cdn.example/a.webm", "auto").needsConversion, false);
});

test("selected-video delivery never silently transcodes Original mode", () => {
  assert.equal(format.selectedVideoAction("https://cdn.example/a.mp4", "original"), "direct");
  assert.equal(format.selectedVideoAction("", "original"), "fail");
  assert.equal(format.selectedVideoAction("https://cdn.example/a.webm", "mp4"), "record");
  assert.equal(format.selectedVideoAction("https://cdn.example/a.mp4", "mp4"), "direct");
  assert.equal(format.selectedVideoAction("", "auto"), "record");
});

test("recorder candidates use only the requested container in forced modes", () => {
  assert.ok(format.recorderMimeCandidates("mp4").every((type) => type.startsWith("video/mp4")));
  assert.ok(format.recorderMimeCandidates("webm").every((type) => type.startsWith("video/webm")));
  assert.ok(format.recorderMimeCandidates("auto")[0].startsWith("video/mp4"));
});
