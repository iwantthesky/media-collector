import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const event=()=>({addListener(){},hasListener(){return false;},removeListener(){}});
async function background(){
  const context=vm.createContext({URL,console,setTimeout,clearTimeout,chrome:{runtime:{onMessage:event()},webRequest:{onBeforeRequest:event()},tabs:{onRemoved:event()},storage:{session:{get:async()=>({})}}}});
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
