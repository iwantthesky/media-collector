import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

function eventStub() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    hasListener(listener) { return listeners.has(listener); }
  };
}

function sessionStorageStub() {
  return {
    async get() { return {}; },
    async set() {},
    async remove() {}
  };
}

async function loadClassicScript(name, extras = {}, dependencies = []) {
  const source = await readFile(new URL(name, root), "utf8");
  const context = vm.createContext({
    URL,
    console,
    setTimeout,
    clearTimeout,
    ...extras
  });
  for (const dependency of dependencies) {
    const dependencySource = await readFile(new URL(dependency, root), "utf8");
    vm.runInContext(dependencySource, context, { filename: dependency });
  }
  vm.runInContext(source, context, { filename: name });
  return context;
}

test("manifest is MV3, versioned, and references every required surface", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.ok(manifest.permissions.includes("downloads"));
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.deepEqual(Object.keys(manifest.icons).sort(), ["128", "16", "32", "48"]);
  for (const relativePath of Object.values(manifest.icons)) {
    await access(new URL(relativePath, root));
  }
});

test("popup markup contains every element used by popup.js", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("popup.html", root), "utf8"),
    readFile(new URL("popup.js", root), "utf8")
  ]);
  const ids = [...script.matchAll(/^\s{4}"([A-Za-z][A-Za-z0-9]+)",?$/gm)].map((match) => match[1]);
  assert.ok(ids.length >= 15);
  for (const id of ids) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `popup.html is missing #${id}`);
  }
});

test("popup offers the complete video format selector beside click selection", async () => {
  const html = await readFile(new URL("popup.html", root), "utf8");
  assert.match(html, /class="pick-launch-row"[\s\S]*id="pickBtn"[\s\S]*id="outputFormat"/);
  assert.deepEqual(
    [...html.matchAll(/<option value="(auto|original|mp4|webm)"/g)].map((match) => match[1]),
    ["auto", "original", "mp4", "webm"]
  );
  assert.match(html, /<option value="auto" selected>/);
});

test("conversion progress stays visible in the wider page toolbar", async () => {
  const source = await readFile(new URL("contentScript.js", root), "utf8");
  assert.match(source, /updatePickToolbar\(`%\$\{percent\} · Video/);
  assert.match(source, /width: min\(960px, calc\(100vw - 24px\)\) !important/);
  assert.match(source, /flex: 1 1 420px !important/);
  assert.doesNotMatch(source, /\.pin-downloader-pick-message \{[\s\S]{0,160}max-width: 280px/);
});

test("background URL and filename helpers reject noise and sanitize paths", async () => {
  const chrome = {
    runtime: { onMessage: eventStub(), lastError: null },
    webRequest: { onBeforeRequest: eventStub() },
    tabs: { onRemoved: eventStub() },
    storage: { session: sessionStorageStub() }
  };
  const context = await loadClassicScript("background.js", { chrome }, ["format-utils.js"]);

  assert.equal(context.sanitizePathPart('  A<B>:C/  ', "fallback"), "A B C");
  assert.equal(context.extensionFromUrl("https://cdn.example/image.png?x=1", "bin"), "png");
  assert.equal(context.classifyNetworkMedia("https://cdn.example/master.m3u8?token=1", "xmlhttprequest"), "hls");
  assert.equal(context.classifyNetworkMedia("https://cdn.example/chunk.m4s", "xmlhttprequest"), "segment");
  assert.equal(context.classifyNetworkMedia("not-a-url", "media"), "");
  assert.deepEqual(
    Array.from(context.normalizeMediaUrls(["https://cdn.example/a.mp4", "javascript:alert(1)", "https://cdn.example/a.mp4"])),
    ["https://cdn.example/a.mp4"]
  );
});

test("popup helpers validate URLs, clamp settings, and format sizes", async () => {
  const chrome = { runtime: { onMessage: eventStub() } };
  const document = { addEventListener() {} };
  const context = await loadClassicScript("popup.js", { chrome, document }, ["format-utils.js"]);

  assert.deepEqual(
    Array.from(context.parseMediaUrlList("https://a.example/x.mp4\nftp://bad.example/x\nhttps://a.example/x.mp4")),
    ["https://a.example/x.mp4"]
  );
  assert.deepEqual(
    Array.from(context.parseUrlList("https://tr.pinterest.com/user/board/ https://example.com/nope")),
    ["https://tr.pinterest.com/user/board/"]
  );
  assert.equal(context.numberValue({ value: "9999" }, 500, 1, 1200), 1200);
  assert.equal(context.numberValue({ value: "oops" }, 900, 250, 5000), 900);
  assert.equal(context.formatBytes(10 * 1024 * 1024), "10 MB");
  assert.equal(context.formatBytes(1536), "2 KB");
});

test("download completion helper waits for Chrome's final state", async () => {
  let changeListener;
  const chrome = {
    runtime: { onMessage: eventStub(), lastError: null },
    webRequest: { onBeforeRequest: eventStub() },
    tabs: { onRemoved: eventStub() },
    storage: { session: sessionStorageStub() },
    downloads: {
      download(_options, callback) { callback(17); },
      search(_query, callback) { callback([{ id: 17, state: "in_progress" }]); },
      onChanged: {
        addListener(listener) { changeListener = listener; },
        removeListener() {}
      }
    }
  };
  const context = await loadClassicScript("background.js", { chrome }, ["format-utils.js"]);
  let settled = false;
  const result = context.chromeDownloadAwaitComplete({ url: "https://cdn.example/a.jpg" }, 1000)
    .then((value) => {
      settled = true;
      return value;
    });

  await Promise.resolve();
  assert.equal(settled, false);
  changeListener({ id: 17, state: { current: "complete" } });
  assert.equal(await result, 17);
});

test("recorded blobs keep their real MP4 or WebM container extension", async () => {
  const downloads = [];
  const chrome = {
    runtime: { onMessage: eventStub(), lastError: null },
    webRequest: { onBeforeRequest: eventStub() },
    tabs: { onRemoved: eventStub() },
    storage: { session: sessionStorageStub() },
    downloads: {
      download(options, callback) { downloads.push(options); callback(downloads.length); },
      search(query, callback) { callback([{ id: query.id, state: "complete" }]); },
      onChanged: eventStub()
    }
  };
  const context = await loadClassicScript("background.js", { chrome }, ["format-utils.js"]);

  await context.downloadRecordedBlob({
    url: "blob:https://example.test/one",
    filename: "clip.mp4",
    mimeType: "video/mp4;codecs=avc1",
    options: { outputFormat: "mp4" }
  });
  await context.downloadRecordedBlob({
    url: "blob:https://example.test/two",
    filename: "clip.webm",
    mimeType: "video/webm;codecs=vp9",
    options: { outputFormat: "webm" }
  });

  assert.match(downloads[0].filename, /\.mp4$/);
  assert.match(downloads[1].filename, /\.webm$/);
});

test("network capture listener is opt-in and removed after opt-out", async () => {
  const beforeRequest = eventStub();
  const stored = {};
  const chrome = {
    runtime: { onMessage: eventStub(), lastError: null },
    webRequest: { onBeforeRequest: beforeRequest },
    tabs: { onRemoved: eventStub() },
    storage: {
      session: {
        async get() { return { ...stored }; },
        async set(items) { Object.assign(stored, items); },
        async remove(key) { delete stored[key]; }
      }
    }
  };
  const context = await loadClassicScript("background.js", { chrome }, ["format-utils.js"]);

  assert.equal(beforeRequest.hasListener(context.handleMediaRequest), false);
  assert.equal(await context.setCaptureEnabled(9, true), true);
  assert.equal(beforeRequest.hasListener(context.handleMediaRequest), true);
  assert.equal(stored.capture_enabled_9, true);
  assert.equal(await context.setCaptureEnabled(9, false), false);
  assert.equal(beforeRequest.hasListener(context.handleMediaRequest), false);
  assert.equal(stored.capture_enabled_9, undefined);
});

test("unsupported pages stay disabled after a busy operation", async () => {
  const chrome = { runtime: { onMessage: eventStub() } };
  const document = { addEventListener() {} };
  const context = await loadClassicScript("popup.js", { chrome, document }, ["format-utils.js"]);
  const disabledState = vm.runInContext(`
    Object.assign(elements, {
      scanBtn: {}, videoBtn: {}, scrollBtn: {}, pickBtn: {}, captureToggleBtn: {}, refreshCapturedBtn: {},
      directUrlBtn: {}, downloadBtn: {}, status: { dataset: {} }
    });
    state.pageSupported = false;
    state.pins = [{ id: "one" }];
    setBusy(true);
    setBusy(false);
    ({ scan: elements.scanBtn.disabled,
       direct: elements.directUrlBtn.disabled, download: elements.downloadBtn.disabled });
  `, context);

  assert.deepEqual({ ...disabledState }, { scan: true, direct: false, download: true });
});
