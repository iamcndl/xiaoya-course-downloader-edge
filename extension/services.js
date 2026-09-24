import {courseFromUrl, normalizeResources, safeFileUrl, sanitizeName, uniqueCandidate} from './core.js';
import {pageRequest} from './page-api.js';
import {renderAssignmentHtml} from './assignment.js';
import {renderDiscussionHtml} from './discussion.js';
import {decodeUrl, unzipSync} from './vendor.js';
import {chooseHlsVariant, parseHlsPlaylist} from './hls.js';

export async function listCourses() {
  const tabs = await chrome.tabs.query({url:'https://*.ai-augmented.com/*'});
  const candidates = tabs.map(tab=>({tab,...courseFromUrl(tab.url)})).filter(x=>x.courseId);
  const details = await Promise.all(candidates.map(async x=>{
    let pageData={};
    try {
      const results=await chrome.scripting.executeScript({target:{tabId:x.tab.id},world:'ISOLATED',
        func:pageRequest,args:['title',{courseId:x.courseId}]});
      const result=results?.[0]?.result;
      if(result?.ok&&result.data&&typeof result.data==='object')pageData=result.data;
    } catch {}
    const pageName=String(x.tab.title||'').replace(/\s*\|\s*理工智课\s*$/,'').trim();
    const kind=pageData.kind==='assignment'?'assignment':'course';
    return {...x,pageData,pageName,kind};
  }));
  const courseNames=new Map();
  for(const item of details){
    const title=String(item.pageData.title||'').trim();
    if(item.kind!=='assignment'&&title&&!courseNames.has(item.courseId))courseNames.set(item.courseId,title);
  }
  return details.map(item=>{
    const courseName=String(item.pageData.title||courseNames.get(item.courseId)||'').trim();
    const breadcrumbs=Array.isArray(item.pageData.breadcrumbs)?item.pageData.breadcrumbs.map(value=>String(value||'').trim()).filter(value=>value&&value!=='我学的课程'):[];
    const assignmentTitle=String(item.pageData.assignmentTitle||'').trim();
    if(item.kind==='assignment'){
      const documentLabel=item.pageData.pageState==='作业任务页面'?'作业题目':'作业答卷';
      const displayParts=breadcrumbs.length?[...breadcrumbs]:courseName?[courseName]:[];
      if(assignmentTitle&&!displayParts.at(-1)?.includes(assignmentTitle))displayParts.push(`${assignmentTitle}${documentLabel}`);
      return {tabId:item.tab.id,courseId:item.courseId,origin:item.origin,url:item.url,kind:'assignment',
        courseName,title:displayParts.join(' / ')||documentLabel};
    }
    const chapterName=item.pageName&&!['课程内容','理工智课','我的课程'].includes(item.pageName)?item.pageName:'';
    const displayParts=breadcrumbs.length?[...breadcrumbs]:[];
    if(courseName&&displayParts[0]!==courseName)displayParts.unshift(courseName);
    if(!breadcrumbs.length&&chapterName&&chapterName!==courseName)displayParts.push(chapterName);
    const title=displayParts.join(' / ')||(courseName||'课程名称暂不可用');
    return {tabId:item.tab.id,courseId:item.courseId,origin:item.origin,url:item.url,kind:'course',courseName,title};
  });
}

async function request(course, action, resourceId) {
  let results;
  const resource=resourceId&&typeof resourceId==='object'?resourceId:{id:resourceId};
  try {
    results = await chrome.scripting.executeScript({target:{tabId:course.tabId},world:'ISOLATED',
      func:pageRequest,args:[action,{courseId:course.courseId,quoteId:resource.quoteId||resourceId,
        resourceId:resource.id||resourceId,taskId:resource.taskId||'',name:resource.name||''} ]});
  } catch {throw new Error('课程标签页已关闭或无访问权限，请保持小雅课程打开后重新读取。');}
  const result = results?.[0]?.result;
  if (!result?.ok) throw new Error(result?.error || '未收到课程数据，请重新读取。');
  return result.data;
}

export async function loadCourse(course) {
  if(course.kind==='assignment'){
    const data=await request(course,'assignment');
    const html=renderAssignmentHtml(data);
    if(new TextEncoder().encode(html).byteLength>16*1024*1024)throw new Error('作业内容超过 16 MB，已停止导出。');
    const isResultPage=data.pageState==='作业答卷页面';
    const outputLabel=isResultPage?'答卷':'题目';
    const name=sanitizeName(`${data.assignmentTitle||'课程作业'}${outputLabel}.html`);
    const file={id:`assignment-${course.tabId}`,quoteId:'',name,mime:'text/html',type:'assignment',size:0,
      folders:[isResultPage?'作业答卷':'作业题目'],folderIds:['assignment'],sort:[0],content:html};
    const title=course.courseName||'小雅课程';
    return {title,displayTitle:course.title,files:[file],videos:0,assignmentQuestions:data.questions.length,assignmentResult:isResultPage};
  }
  const data = await request(course,'list');
  return {title:data.title,...normalizeResources(data.nodes)};
}

function directVideoUrl(value){
  const path=new URL(value).pathname;
  return /\.(?:mp4|webm|mov|avi|mkv|m4v|mpeg|mpg|3gp|wmv|flv|ogv|vob|divx|rm|rmvb)$/i.test(path);
}

function videoOutputName(file,url){
  const path=new URL(url).pathname;
  const ext=path.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  const known=/\.(?:mp4|webm|mov|avi|mkv|m4v|mpeg|mpg|3gp|wmv|flv|ogv|vob|divx|rm|rmvb)$/i;
  return !known.test(file.name)&&ext?{...file,name:`${file.name}.${ext}`}:{...file};
}

export async function prepareFiles(course, files, onProgress, signal) {
  const ready = []; const failed = [];
  for (const [index,file] of files.entries()) {
    signal.throwIfAborted();
    try {
      if(file.type==='assignment'){
        let content=file.content;
        let outputFile=file;
        if(typeof content!=='string'||!content){
          const data=await request(course,'paper',file);
          content=renderAssignmentHtml(data);
          outputFile={...file,name:/\.html?$/i.test(file.name)?file.name:sanitizeName(`${file.name||'课程作业'}.html`)};
        }
        ready.push({file:outputFile,content,size:new TextEncoder().encode(content).byteLength});
      }else if(file.type==='discussion'){
        const data=await request(course,'discussion',file);
        const content=renderDiscussionHtml(data);
        const outputFile={...file,name:/\.html?$/i.test(file.name)?file.name:sanitizeName(`${file.name||'课程讨论'}.html`)};
        ready.push({file:outputFile,content,size:new TextEncoder().encode(content).byteLength});
      }else if(file.type==='video'){
        const meta=await request(course,'video',file.id);
        signal.throwIfAborted();
        if(!meta.url||typeof meta.url!=='string')throw new Error('平台未返回视频播放清单。');
        const url=safeFileUrl(meta.url);
        const direct=directVideoUrl(url);
        ready.push({file:direct?videoOutputName(file,url):file,url,size:Math.max(0,Number(meta.size)||0),mode:direct?'direct':'hls'});
      }else{
        const meta = await request(course,'file',file.quoteId);
        signal.throwIfAborted();
        if (!meta.url || typeof meta.url !== 'string') throw new Error('平台未返回原文件地址。');
        const encrypted = meta.is_encryption === true || meta.is_encryption === 1 || meta.is_encryption === '1';
        const url = safeFileUrl(encrypted ? decodeUrl(meta.url) : meta.url);
        ready.push({file,url,size:Math.max(0,Number(meta.size)||0)});
      }
    } catch(error) {
      if (signal.aborted) throw signal.reason;
      failed.push({id:file.id,name:file.name,state:'failed',error:error.message});
    }
    onProgress?.({done:index+1,total:files.length,name:file.name});
  }
  const origins=[...new Set(ready.filter(item=>item.url).map(item=>new URL(item.url).origin+'/*'))];
  const newlyGrantedOrigins=[];
  for(const origin of origins){
    if(!await chrome.permissions.contains({origins:[origin]}))newlyGrantedOrigins.push(origin);
  }
  return {ready,failed,origins,newlyGrantedOrigins};
}

// Must be called directly from the Start button's click to preserve user activation.
export function grantDownloadAccess(origins) {
  return origins.length ? chrome.permissions.request({origins}) : Promise.resolve(true);
}

export async function releaseDownloadAccess(origins) {
  const optional = origins.filter(value=>!/(^|\.)ai-augmented\.com$/.test(new URL(value).hostname));
  if (optional.length) await chrome.permissions.remove({origins:optional});
}

const MAX_HLS_PLAYLIST_BYTES=8*1024*1024;
const MAX_VIDEO_SEGMENT_BYTES=128*1024*1024;
const MAX_VIDEO_BYTES=4*1024*1024*1024;

async function checkFinalOrigin(response,requestedUrl,label){
  if(!response.url)return;
  const finalUrl=safeFileUrl(response.url);
  if(new URL(finalUrl).origin===new URL(requestedUrl).origin)return;
  const origin=mediaOriginPattern(finalUrl);
  if(!await chrome.permissions.contains({origins:[origin]})){
    await response.body?.cancel().catch(()=>{});
    const error=new Error(`${label}跳转到新的媒体域名，请授权后继续。`);
    error.missingOrigins=[origin];
    throw error;
  }
}

async function withMediaResponse(url,signal,headers,consume){
  signal.throwIfAborted();
  const controller=new AbortController();
  const timeout=AbortSignal.timeout(180000);
  const abort=()=>controller.abort(signal.aborted?signal.reason:timeout.reason);
  signal.addEventListener('abort',abort,{once:true});timeout.addEventListener('abort',abort,{once:true});
  try{
    const requestedUrl=safeFileUrl(url);
    const response=await fetch(requestedUrl,{headers,signal:controller.signal,credentials:'omit',
      referrerPolicy:'no-referrer',redirect:'follow'});
    await checkFinalOrigin(response,requestedUrl,'视频资源');
    if(!response.ok)throw new Error(`视频服务器返回 HTTP ${response.status}。`);
    return await consume(response);
  }catch(error){
    if(signal.aborted)throw signal.reason;
    if(timeout.aborted)throw new Error('视频分段下载超过 3 分钟，请重试。');
    if(error instanceof TypeError)throw new Error('无法访问视频服务器，请检查播放授权或媒体域名权限。');
    throw error;
  }finally{
    signal.removeEventListener('abort',abort);timeout.removeEventListener('abort',abort);
  }
}

async function fetchHlsText(url,signal){
  return withMediaResponse(url,signal,{},async response=>{
    const declared=Number(response.headers.get('content-length'))||0;
    if(declared>MAX_HLS_PLAYLIST_BYTES)throw new Error('视频播放清单超过 8 MB，已停止读取。');
    const reader=response.body?.getReader();
    if(!reader)throw new Error('视频服务器没有返回播放清单内容。');
    const decoder=new TextDecoder();let text='';let received=0;
    try{
      while(true){
        signal.throwIfAborted();
        const {value,done}=await reader.read();if(done)break;
        received+=value.byteLength;
        if(received>MAX_HLS_PLAYLIST_BYTES){await reader.cancel();throw new Error('视频播放清单超过 8 MB，已停止读取。');}
        text+=decoder.decode(value,{stream:true});
      }
      return text+decoder.decode();
    }finally{reader.releaseLock();}
  });
}

async function fetchHlsBytes(url,signal,range,maxBytes=MAX_VIDEO_SEGMENT_BYTES){
  const headers=range?{Range:`bytes=${range.start}-${range.start+range.length-1}`} : {};
  return withMediaResponse(url,signal,headers,async response=>{
    if(range&&response.status!==206)throw new Error('视频服务器不支持读取该分段范围。');
    const declared=Number(response.headers.get('content-length'))||0;
    if(declared>maxBytes)throw new Error(maxBytes===16?'视频密钥响应大小异常。':'单个视频分段超过 128 MB，已停止下载。');
    const reader=response.body.getReader();const chunks=[];let length=0;
    try{
      while(true){
        signal.throwIfAborted();
        const {value,done}=await reader.read();if(done)break;
        length+=value.length;if(length>maxBytes){await reader.cancel();throw new Error(maxBytes===16?'视频密钥响应大小异常。':'单个视频分段超过 128 MB，已停止下载。');}
        chunks.push(value);
      }
    }finally{reader.releaseLock();}
    if(range&&length!==range.length)throw new Error('视频分段范围长度不匹配。');
    const bytes=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const header=new TextDecoder().decode(bytes.slice(0,160)).trimStart();
    if(/^\s*(<!doctype html|<html|\{\s*"(?:error|code|message)")/i.test(header))
      throw new Error('视频服务器返回了错误页面。');
    return bytes;
  });
}

function mediaOriginPattern(value){return `${new URL(safeFileUrl(value)).origin}/*`;}

export async function resolveVideoPlaylist(item,signal){
  let playlistUrl=safeFileUrl(item.url);const visited=new Set();
  for(let depth=0;depth<8;depth++){
    signal.throwIfAborted();
    if(visited.has(playlistUrl))throw new Error('视频播放清单存在循环引用。');
    visited.add(playlistUrl);
    const origin=mediaOriginPattern(playlistUrl);
    if(!await chrome.permissions.contains({origins:[origin]}))return {plan:null,missingOrigins:[origin]};
    let source;
    try{source=await fetchHlsText(playlistUrl,signal);}
    catch(error){if(error.missingOrigins)return {plan:null,missingOrigins:error.missingOrigins};throw error;}
    const parsed=parseHlsPlaylist(source,playlistUrl);
    if(parsed.kind==='master'){playlistUrl=safeFileUrl(chooseHlsVariant(parsed));continue;}
    const assets=[parsed.playlistUrl,...parsed.maps.flatMap(map=>[map.url,map.key?.url]),
      ...parsed.segments.flatMap(segment=>[segment.url,segment.key?.url])].filter(Boolean);
    const origins=[...new Set(assets.map(mediaOriginPattern))];const missingOrigins=[];
    for(const assetOrigin of origins)
      if(!await chrome.permissions.contains({origins:[assetOrigin]}))missingOrigins.push(assetOrigin);
    return {plan:parsed,missingOrigins};
  }
  throw new Error('视频播放清单嵌套过深，无法安全解析。');
}

async function decryptHlsPart(bytes,keyInfo,keyCache,signal){
  if(!keyInfo)return bytes;
  let cryptoKey=keyCache.get(keyInfo.url);
  if(!cryptoKey){
    const raw=await fetchHlsBytes(keyInfo.url,signal,undefined,16);
    if(raw.length!==16)throw new Error('视频密钥长度无效。');
    try{cryptoKey=await crypto.subtle.importKey('raw',raw,{name:'AES-CBC'},false,['decrypt']);}
    catch{throw new Error('当前浏览器不支持此视频的 AES-128 解密。');}
    keyCache.set(keyInfo.url,cryptoKey);
  }
  try{
    return new Uint8Array(await crypto.subtle.decrypt({name:'AES-CBC',iv:keyInfo.iv},cryptoKey,bytes));
  }catch(error){
    if(signal.aborted)throw signal.reason;
    throw new Error('视频 AES-128 分段解密失败，播放授权可能已过期。');
  }
}

export async function saveHlsVideo(root,courseName,item,preserveFolders,signal,onProgress){
  const plan=item.hlsPlan;
  if(!plan?.segments?.length)throw new Error(item.hlsError||'视频播放清单尚未准备好。');
  const stem=String(item.file.name).replace(/\.[^./\\]+$/,'').trim()||'课程视频';
  const base=sanitizeName(`${stem}.${plan.container}`);
  const segments=[sanitizeName(courseName),...(preserveFolders?item.file.folders.map(name=>sanitizeName(name)):[])];
  let directory=root;for(const name of segments)directory=await directory.getDirectoryHandle(name,{create:true});
  let output;
  for(let index=0;index<10000;index++){
    output=uniqueCandidate(base,index);
    try{await directory.getFileHandle(output);}
    catch(error){if(error.name==='NotFoundError')break;throw error;}
    if(index===9999)throw new Error('同名视频太多，请选择其他文件夹。');
  }
  signal.throwIfAborted();
  const handle=await directory.getFileHandle(output,{create:true});
  let writer;let totalBytes=0;let completed=0;
  const parts=[];let previousMap=null;
  for(const segment of plan.segments){
    if(segment.map&&!sameHlsMap(previousMap,segment.map)){parts.push(segment.map);previousMap=segment.map;}
    parts.push(segment);
  }
  const keyCache=new Map();
  try{
    writer=await handle.createWritable({keepExistingData:false});
    for(const part of parts){
      signal.throwIfAborted();
      let bytes=await fetchHlsBytes(part.url,signal,part.range);
      bytes=await decryptHlsPart(bytes,part.key,keyCache,signal);
      totalBytes+=bytes.length;
      if(totalBytes>MAX_VIDEO_BYTES)throw new Error('视频超过 4 GB，已停止下载。');
      await writer.write(bytes);completed++;
      onProgress?.({doneSegments:completed,totalSegments:parts.length,bytes:totalBytes});
    }
    if(!totalBytes)throw new Error('视频下载到了空文件。');
    signal.throwIfAborted();await writer.close();
    return {path:[...segments,output].join('/'),name:output,bytes:totalBytes,parts:parts.length,container:plan.container};
  }catch(error){
    await writer?.abort().catch(()=>{});
    await directory.removeEntry(output).catch(()=>{});
    throw error;
  }
}

export async function saveProgressiveVideo(root,courseName,item,preserveFolders,signal,onProgress){
  signal.throwIfAborted();
  const segments=[sanitizeName(courseName),...(preserveFolders?item.file.folders.map(name=>sanitizeName(name)):[])];
  let directory=root;for(const name of segments)directory=await directory.getDirectoryHandle(name,{create:true});
  const base=sanitizeName(item.file.name);let output;
  for(let index=0;index<10000;index++){
    output=uniqueCandidate(base,index);
    try{await directory.getFileHandle(output);}
    catch(error){if(error.name==='NotFoundError')break;throw error;}
    if(index===9999)throw new Error('同名视频太多，请选择其他文件夹。');
  }
  const handle=await directory.getFileHandle(output,{create:true});let writer;
  const controller=new AbortController();const timeout=AbortSignal.timeout(180000);
  const abort=()=>controller.abort(signal.aborted?signal.reason:timeout.reason);
  signal.addEventListener('abort',abort,{once:true});timeout.addEventListener('abort',abort,{once:true});
  try{
    const requestedUrl=safeFileUrl(item.url);
    const response=await fetch(requestedUrl,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'follow'});
    await checkFinalOrigin(response,requestedUrl,'视频资源');
    if(!response.ok)throw new Error(`视频服务器返回 HTTP ${response.status}。`);
    const declared=Number(response.headers.get('content-length'))||0;
    if(declared>MAX_VIDEO_BYTES)throw new Error('视频超过 4 GB，已停止下载。');
    const mime=response.headers.get('content-type')||'';
    if(mime&&!/^video\//i.test(mime)&&!/(octet-stream|binary)/i.test(mime))throw new Error('平台返回的内容不是可下载的视频。');
    writer=await handle.createWritable({keepExistingData:false});
    const reader=response.body.getReader();let totalBytes=0;let prefix=new Uint8Array(0);
    try{
      while(true){
        signal.throwIfAborted();
        const {value,done}=await reader.read();if(done)break;
        totalBytes+=value.length;
        if(totalBytes>MAX_VIDEO_BYTES){await reader.cancel();throw new Error('视频超过 4 GB，已停止下载。');}
        if(prefix.length<200){const combined=new Uint8Array(Math.min(200,prefix.length+value.length));combined.set(prefix);combined.set(value.slice(0,combined.length-prefix.length),prefix.length);prefix=combined;
          const header=new TextDecoder().decode(prefix).trimStart();
          if(/^\s*(<!doctype html|<html|\{\s*"(?:error|code|message)")/i.test(header))throw new Error('视频服务器返回了错误页面。');}
        await writer.write(value);onProgress?.({bytes:totalBytes,totalBytes:declared});
      }
    }finally{reader.releaseLock();}
    if(!totalBytes)throw new Error('视频下载到了空文件。');
    signal.throwIfAborted();await writer.close();
    return {path:[...segments,output].join('/'),name:output,bytes:totalBytes};
  }catch(error){
    await writer?.abort().catch(()=>{});await directory.removeEntry(output).catch(()=>{});
    if(signal.aborted)throw signal.reason;
    if(timeout.aborted)throw new Error('视频下载超过 3 分钟，请重试。');
    if(error instanceof TypeError)throw new Error('无法访问视频服务器，请检查播放授权或媒体域名权限。');
    throw error;
  }finally{signal.removeEventListener('abort',abort);timeout.removeEventListener('abort',abort);}
}

function sameHlsMap(left,right){
  if(!left||!right)return left===right;
  return left.url===right.url&&JSON.stringify(left.range)===JSON.stringify(right.range)&&left.key?.url===right.key?.url&&
    JSON.stringify(left.key?.iv?Array.from(left.key.iv):null)===JSON.stringify(right.key?.iv?Array.from(right.key.iv):null);
}

export const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit=0;bit<8;bit++) crc = (crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^-1)>>>0;
}

export function verifyFile(bytes, name, expectedSize = 0) {
  if (!bytes.length) throw new Error('下载到了空文件。');
  if (expectedSize && bytes.length !== expectedSize) throw new Error(`文件不完整：收到 ${bytes.length} 字节，应为 ${expectedSize} 字节。`);
  const ext = name.split('.').pop().toLowerCase();
  const header = new TextDecoder().decode(bytes.slice(0,200)).trim();
  if (!/^(html?|txt|xml|svg)$/.test(ext) && /^\s*(<!doctype html|<html|\{\s*"(?:error|code|message)")/i.test(header))
    throw new Error('服务器返回了错误页面，未保存为课件。');
  if (ext === 'pdf' && !new TextDecoder().decode(bytes.slice(0,1024)).includes('%PDF-')) throw new Error('返回内容不是 PDF。');
  if (!/^(pptx|docx|xlsx)$/.test(ext)) return {bytes:bytes.length};
  try {
    // Read ZIP central directory before inflating to cap memory and verify CRCs.
    const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let eocd = -1;
    for (let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)
      if (view.getUint32(i,true)===0x06054b50 && i+22+view.getUint16(i+20,true)===bytes.length) {eocd=i;break;}
    if (eocd < 0 || view.getUint16(eocd+4,true)!==0 || view.getUint16(eocd+6,true)!==0) throw new Error();
    const count = view.getUint16(eocd+10,true); let cursor = view.getUint32(eocd+16,true); let expanded=0;
    const entries = [];
    for (let i=0;i<count;i++) {
      if (view.getUint32(cursor,true)!==0x02014b50) throw new Error();
      const len=view.getUint16(cursor+28,true); const extra=view.getUint16(cursor+30,true); const comment=view.getUint16(cursor+32,true);
      const entryName=new TextDecoder().decode(bytes.slice(cursor+46,cursor+46+len));
      const size=view.getUint32(cursor+24,true); expanded+=size;
      if (expanded>MAX_EXPANDED_BYTES || size===0xffffffff) throw new Error();
      entries.push({name:entryName,crc:view.getUint32(cursor+16,true),size});
      cursor+=46+len+extra+comment;
    }
    if (cursor>eocd || !count) throw new Error();
    const unpacked = unzipSync(bytes);
    for (const entry of entries) {
      if (entry.name.endsWith('/')) continue;
      const content=unpacked[entry.name];
      if (!content || content.length!==entry.size || crc32(content)!==entry.crc) throw new Error();
    }
    const main={pptx:'ppt/presentation.xml',docx:'word/document.xml',xlsx:'xl/workbook.xml'}[ext];
    if (!unpacked['[Content_Types].xml'] || !unpacked[main]) throw new Error();
    return {bytes:bytes.length,slides:ext==='pptx'?entries.filter(x=>/^ppt\/slides\/slide\d+\.xml$/.test(x.name)).length:undefined};
  } catch {throw new Error('Office 文件完整性检查失败，或解压后超过 512 MB，未保存。');}
}

export async function fetchFile(item, signal, onProgress) {
  signal.throwIfAborted();
  if (item.size > MAX_DOWNLOAD_BYTES) throw new Error('单文件超过 256 MB，请在小雅页面单独下载。');
  const timeout=AbortSignal.timeout(180000);
  // AbortSignal.any is not available on older supported Edge versions.
  const local=new AbortController();
  const abort=()=>local.abort(signal.aborted?signal.reason:timeout.reason);
  signal.addEventListener('abort',abort,{once:true}); timeout.addEventListener('abort',abort,{once:true});
  try {
    const requestedUrl=safeFileUrl(item.url);
    const response=await fetch(requestedUrl,{signal:local.signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'follow'});
    await checkFinalOrigin(response,requestedUrl,'文件资源');
    if (!response.ok) throw new Error(`文件下载失败（HTTP ${response.status}），请重新准备下载。`);
    const declared=Number(response.headers.get('content-length'))||0;
    if (declared>MAX_DOWNLOAD_BYTES) throw new Error('单文件超过 256 MB，请在小雅页面单独下载。');
    const reader=response.body.getReader(); const chunks=[];let received=0;
    while (true) {
      const {value,done}=await reader.read();if(done)break;
      received+=value.length;
      if(received>MAX_DOWNLOAD_BYTES){await reader.cancel();throw new Error('单文件超过 256 MB。');}
      chunks.push(value);onProgress?.(received,item.size||declared);
    }
    signal.throwIfAborted();
    const bytes=new Uint8Array(received);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return {bytes,validation:verifyFile(bytes,item.file.name,item.size)};
  } catch(error) {
    if(signal.aborted)throw signal.reason;
    if(timeout.aborted)throw new Error('文件下载超过 3 分钟，请重试。');
    if(error instanceof TypeError)throw new Error('无法访问文件服务器，请检查下载授权或重新准备下载。');
    throw error;
  } finally {
    signal.removeEventListener('abort',abort);timeout.removeEventListener('abort',abort);
  }
}

export async function saveFile(root, courseName, file, bytes, preserveFolders, signal) {
  signal.throwIfAborted();
  const segments=[sanitizeName(courseName),...(preserveFolders?file.folders.map(name=>sanitizeName(name)):[])];
  let directory=root;
  for(const name of segments)directory=await directory.getDirectoryHandle(name,{create:true});
  const base=sanitizeName(file.name);let output;
  for(let i=0;i<10000;i++){
    output=uniqueCandidate(base,i);
    try {await directory.getFileHandle(output);}
    catch(error){if(error.name==='NotFoundError')break;throw error;}
    if(i===9999)throw new Error('同名文件太多，请选择其他文件夹。');
  }
  signal.throwIfAborted();
  const handle=await directory.getFileHandle(output,{create:true});
  let writer;
  try {
    writer=await handle.createWritable({keepExistingData:false});
    await writer.write(bytes);signal.throwIfAborted();await writer.close();
  } catch(error) {
    await writer?.abort().catch(()=>{});
    await directory.removeEntry(output).catch(()=>{});
    throw error;
  }
  return [...segments,output].join('/');
}
