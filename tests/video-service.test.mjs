import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchFile,resolveVideoPlaylist,saveFile,saveHlsVideo,saveProgressiveVideo} from '../extension/services.js';

test('discovers each HLS host before the extension fetches resources from it',async t=>{
  const previousFetch=globalThis.fetch;
  const chromeDescriptor=Object.getOwnPropertyDescriptor(globalThis,'chrome');
  const granted=new Set(['https://playlist.example.edu/*']);
  globalThis.chrome={permissions:{contains:async({origins})=>origins.every(origin=>granted.has(origin))}};
  globalThis.fetch=async value=>{
    const url=String(value);
    if(url==='https://playlist.example.edu/master.m3u8')return new Response(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=500000
https://variant.example.edu/vod.m3u8
`,{status:200});
    if(url==='https://variant.example.edu/vod.m3u8')return new Response(`#EXTM3U
#EXTINF:4,
https://segments.example.edu/part-1.ts
#EXT-X-ENDLIST
`,{status:200});
    throw new Error(`Unexpected fetch: ${url}`);
  };
  t.after(()=>{
    globalThis.fetch=previousFetch;
    if(chromeDescriptor)Object.defineProperty(globalThis,'chrome',chromeDescriptor);
    else delete globalThis.chrome;
  });

  const item={url:'https://playlist.example.edu/master.m3u8'};
  const signal=new AbortController().signal;
  const first=await resolveVideoPlaylist(item,signal);
  assert.deepEqual(first.missingOrigins,['https://variant.example.edu/*']);
  granted.add('https://variant.example.edu/*');
  const second=await resolveVideoPlaylist(item,signal);
  assert.deepEqual(second.missingOrigins,['https://segments.example.edu/*']);
  assert.equal(second.plan.segments.length,1);
  granted.add('https://segments.example.edu/*');
  const third=await resolveVideoPlaylist(item,signal);
  assert.deepEqual(third.missingOrigins,[]);
  assert.equal(third.plan.container,'ts');
});

test('stops reading an HLS playlist as soon as its byte limit is exceeded',async t=>{
  const previousFetch=globalThis.fetch;
  const chromeDescriptor=Object.getOwnPropertyDescriptor(globalThis,'chrome');
  let emitted=0;let cancelled=false;
  globalThis.chrome={permissions:{contains:async()=>true}};
  globalThis.fetch=async()=>new Response(new ReadableStream({
    pull(controller){
      emitted++;
      controller.enqueue(new Uint8Array(1024*1024).fill(0x41));
    },
    cancel(){cancelled=true;}
  }));
  t.after(()=>{
    globalThis.fetch=previousFetch;
    if(chromeDescriptor)Object.defineProperty(globalThis,'chrome',chromeDescriptor);else delete globalThis.chrome;
  });
  await assert.rejects(resolveVideoPlaylist({url:'https://playlist.example.edu/oversized.m3u8'},new AbortController().signal),/播放清单超过 8 MB/);
  assert.ok(emitted>=9&&emitted<=10);
  assert.equal(cancelled,true);
});

test('streams video segments to the selected folder and adjusts the extension to the HLS container',async t=>{
  const previousFetch=globalThis.fetch;
  const stored=new Map();
  const directory={
    async getDirectoryHandle(){return this;},
    async getFileHandle(name,options={}){
      if(!options.create&&!stored.has(name))throw Object.assign(new Error('missing'),{name:'NotFoundError'});
      if(options.create&&!stored.has(name))stored.set(name,[]);
      return {async createWritable(){
        return {async write(bytes){stored.get(name).push(...bytes);},async close(){},async abort(){}};
      }};
    },
    async removeEntry(name){stored.delete(name);}
  };
  globalThis.fetch=async value=>{
    const url=String(value);
    if(url==='https://segments.example.edu/1.ts')return new Response(new Uint8Array([0x47,1]),{status:200});
    if(url==='https://segments.example.edu/2.ts')return new Response(new Uint8Array([0x47,2]),{status:200});
    throw new Error(`Unexpected fetch: ${url}`);
  };
  t.after(()=>{globalThis.fetch=previousFetch;});
  const item={file:{name:'课程视频.mp4',folders:['第一章']},hlsPlan:{container:'ts',segments:[
    {url:'https://segments.example.edu/1.ts',range:null,key:null},
    {url:'https://segments.example.edu/2.ts',range:null,key:null}
  ]}};
  const saved=await saveHlsVideo(directory,'示例课程',item,true,new AbortController().signal);
  assert.equal(saved.path,'示例课程/第一章/课程视频.ts');
  assert.equal(saved.bytes,4);
  assert.deepEqual(stored.get('课程视频.ts'),[0x47,1,0x47,2]);
});

test('rejects an ungranted final host before consuming its redirected response',async t=>{
  const previousFetch=globalThis.fetch;
  const chromeDescriptor=Object.getOwnPropertyDescriptor(globalThis,'chrome');
  let redirectMode='';
  globalThis.chrome={permissions:{contains:async()=>false}};
  globalThis.fetch=async(_url,init)=>{
    redirectMode=init.redirect;
    const response=new Response(new Uint8Array([1,2,3]),{status:200});
    Object.defineProperty(response,'url',{value:'https://cdn.example.edu/slides.pdf'});
    return response;
  };
  t.after(()=>{
    globalThis.fetch=previousFetch;
    if(chromeDescriptor)Object.defineProperty(globalThis,'chrome',chromeDescriptor);else delete globalThis.chrome;
  });
  await assert.rejects(fetchFile({url:'https://files.example.edu/slides.pdf',size:0,file:{name:'slides.pdf'}},new AbortController().signal),error=>{
    assert.deepEqual(error.missingOrigins,['https://cdn.example.edu/*']);
    return /跳转到新的媒体域名/.test(error.message);
  });
  assert.equal(redirectMode,'follow');
});

test('streams a direct video file to the selected folder without a memory-sized buffer',async t=>{
  const previousFetch=globalThis.fetch;
  const stored=new Map();
  const directory={async getDirectoryHandle(){return this;},async getFileHandle(name,options={}){
    if(!options.create&&!stored.has(name))throw Object.assign(new Error('missing'),{name:'NotFoundError'});
    if(options.create&&!stored.has(name))stored.set(name,[]);
    return {async createWritable(){return {async write(bytes){stored.get(name).push(...bytes);},async close(){},async abort(){}};}};
  },async removeEntry(name){stored.delete(name);}};
  let redirectMode='';
  globalThis.fetch=async(_url,init)=>{
    redirectMode=init.redirect;
    const response=new Response(new Uint8Array([0,0,0,1,0x66]),{status:200,headers:{'content-type':'video/mp4'}});
    Object.defineProperty(response,'url',{value:'https://media.example.edu/class.mp4'});
    return response;
  };
  t.after(()=>{globalThis.fetch=previousFetch;});
  const saved=await saveProgressiveVideo(directory,'示例课程',{url:'https://media.example.edu/class.mp4',file:{name:'示例视频.mp4',folders:['示例章节','示例子文件夹']}},true,new AbortController().signal);
  assert.equal(saved.path,'示例课程/示例章节/示例子文件夹/示例视频.mp4');
  assert.equal(saved.bytes,5);
  assert.deepEqual(stored.get('示例视频.mp4'),[0,0,0,1,0x66]);
  assert.equal(redirectMode,'follow');
});

test('removes an incomplete ordinary file when saving fails',async()=>{
  const files=new Map();
  const directory={
    async getDirectoryHandle(){return this;},
    async getFileHandle(name,options={}){
      if(!options.create&&!files.has(name))throw Object.assign(new Error('missing'),{name:'NotFoundError'});
      if(options.create)files.set(name,[]);
      return {async createWritable(){return {
        async write(){throw new Error('simulated disk failure');},
        async close(){},async abort(){}
      };}};
    },
    async removeEntry(name){files.delete(name);}
  };
  await assert.rejects(saveFile(directory,'示例课程',{name:'示例讲义.pdf',folders:[]},new Uint8Array([1]),true,new AbortController().signal),/simulated disk failure/);
  assert.equal(files.size,0);
});
