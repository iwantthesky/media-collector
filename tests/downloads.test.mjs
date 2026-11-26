import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const event=()=>({addListener(){},hasListener(){return false;},removeListener(){}});
async function background(){
  const context=vm.createContext({URL,console,setTimeout,clearTimeout,chrome:{runtime:{onMessage:event()},webRequest:{onBeforeRequest:event(),onHeadersReceived:event()},tabs:{onRemoved:event()},storage:{session:{get:async()=>({})}}}});
  vm.runInContext(await readFile(new URL('../format-utils.js',import.meta.url),'utf8'),context);
  vm.runInContext(await readFile(new URL('../background.js',import.meta.url),'utf8'),context);
  return context;
}
test('download pool overlaps work, respects the limit and visits every item once',async()=>{
  const context=await background(); let active=0,peak=0;const seen=[];
  await context.runDownloadPool([0,1,2,3,4,5,6,7],3,async item=>{
    active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,4));seen.push(item);active--;
  });
  assert.equal(peak,3);assert.deepEqual(seen.sort((a,b)=>a-b),[0,1,2,3,4,5,6,7]);
});
test('automatic video order prefers MP4 and retries later candidates',async()=>{
  const context=await background();
  const pin={url:'https://cdn.example/high.webm',candidates:[
    {url:'https://cdn.example/high.webm',score:9999},
    {url:'https://cdn.example/first.mp4',score:10},
    {url:'https://cdn.example/second.webm',score:5}
  ]};
  const urls=await context.chooseDownloadUrls(pin,false,'auto');
  assert.deepEqual(Array.from(urls),[
    'https://cdn.example/first.mp4',
    'https://cdn.example/high.webm',
    'https://cdn.example/second.webm'
  ]);
  const attempts=[];
  const result=await context.downloadFirstAvailable(urls,async url=>{
    attempts.push(url);
    if(url.endsWith('.mp4')) throw new Error('first candidate failed');
  });
  assert.equal(result.ok,true);
  assert.deepEqual(attempts,[urls[0],urls[1]]);
});
test('YouTube HTML and CDN fragments cannot enter the direct file downloader',async()=>{
  const context=await background();
  assert.equal(context.classifyNetworkMedia('https://r1.googlevideo.com/videoplayback?range=0-100','media'),'youtube');
  for(const url of ['https://www.youtube.com/watch?v=jNQXAC9IVRw','https://youtu.be/jNQXAC9IVRw','https://r1.googlevideo.com/videoplayback?range=0-100']) {
    await assert.rejects(context.downloadDirectUrls({urls:[url]}),/desteklenmiyor/);
  }
});

test("download tiers and previous custom values use the same worker range", async () => {
  const context = await background();
  assert.deepEqual([undefined, null, "1", "3", "6", "4", "600"].map(context.normalizeDownloadConcurrency),
    [3, 3, 1, 3, 6, 4, 6]);
  const markup = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  assert.match(markup, /id="downloadConcurrency" aria-describedby="downloadSpeedHelp downloadSpeedWarning"/);
  assert.match(markup, /Hızlı toplu indirme.*hesabını engellemesine/);
});

test("direct media access refusals do not try an alternate URL for the same item", async () => {
  const context = await background();
  const attempts = [];
  const result = await context.downloadFirstAvailable(["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"], async url => {
    attempts.push(url);
    throw context.downloadInterruptedError("SERVER_FORBIDDEN");
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "SERVER_FORBIDDEN");
  assert.deepEqual(attempts, ["https://cdn.example/a.mp4"]);
});

const mediaUrl = "https://cdn.example/stream.m3u8";
const hlsPlaylist = count => ["#EXTM3U", ...Array.from({ length: count }, (_, index) =>
  "#EXTINF:1,\npart" + index + ".ts"), "#EXT-X-ENDLIST"].join("\n");

async function hlsContext(fetch) {
  const context = vm.createContext({
    URL, Blob, AbortController, fetch, setTimeout, clearTimeout,
    chrome: { runtime: { onMessage: event(), sendMessage() {} } }
  });
  const source = await readFile(new URL("../offscreen.js", import.meta.url), "utf8");
  vm.runInContext(source, context);
  return context;
}

test("each HLS tier limits active segments and reuses the first response", async () => {
  for (const concurrency of [1, 3, 6]) {
    let active = 0;
    let peak = 0;
    const segments = [];
    const context = await hlsContext(async url => {
      if (url === mediaUrl) return new Response(hlsPlaylist(9));
      segments.push(url);
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return new Response(new Uint8Array([0x47]));
    });
    const result = await context.assembleHlsVideo(mediaUrl, concurrency);
    assert.equal(peak, concurrency);
    assert.equal(segments.length, 9);
    assert.equal(new Set(segments).size, 9);
    assert.equal(result.bytes, 9);
    URL.revokeObjectURL(result.blobUrl);
  }
});

test("HLS respects Retry-After in seconds or HTTP-date", async () => {
  const requested = [];
  const context = await hlsContext(async url => {
    if (url === mediaUrl) return new Response(hlsPlaylist(1));
    requested.push(Date.now());
    if (requested.length === 1) return new Response(null, { status: 429, headers: { "Retry-After": "1" } });
    return new Response(new Uint8Array([0x47]));
  });
  assert.equal(context.parseRetryAfter("120"), 120000);
  assert.equal(context.parseRetryAfter("Thu, 26 Nov 2026 10:00:15 GMT", Date.UTC(2026, 10, 26, 10, 0)), 15000);
  const result = await context.assembleHlsVideo(mediaUrl, 1);
  assert.equal(requested.length, 2);
  assert.ok(requested[1] - requested[0] >= 1000);
  URL.revokeObjectURL(result.blobUrl);
});

test("HLS stops on access refusal or a Retry-After beyond its automatic wait", async () => {
  for (const [status, headers, message] of [
    [401, {}, /HTTP 401/],
    [403, {}, /HTTP 403/],
    [429, { "Retry-After": "120" }, /120 saniye.*HTTP 429/]
  ]) {
    const segments = [];
    const context = await hlsContext(async url => {
      if (url === mediaUrl) return new Response(hlsPlaylist(5));
      segments.push(url);
      return new Response(null, { status, headers });
    });
    await assert.rejects(context.assembleHlsVideo(mediaUrl, 6), message);
    assert.deepEqual(segments, ["https://cdn.example/part0.ts"]);
  }
});
