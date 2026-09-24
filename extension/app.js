import {formatSize,sanitizeName} from './core.js';
import {fetchFile,grantDownloadAccess,loadCourse,listCourses,prepareFiles,releaseDownloadAccess,resolveVideoPlaylist,saveFile,saveHlsVideo,saveProgressiveVideo} from './services.js';

const $=id=>document.getElementById(id);
const ui=Object.fromEntries(['course-select','refresh-courses','load-course','course-title','course-meta','search','type-filter',
  'visible-count','select-visible','clear-videos','clear-selection','file-list','empty-state','selected-count','choose-folder','folder-name',
  'preserve-folders','prepare-download','start-download','cancel-download','retry-failed','permissions-note','permission-domains',
  'busy-note','progress','progress-label','status','activity-list','export-report'].map(id=>[id,$(id)]));
const state={courses:[],course:null,title:'',files:[],selected:new Set(),root:null,prepared:null,failed:[],records:[],controller:null,
  busy:false,runId:0,reportAvailable:false};
const typeLabel={ppt:'PPT',pdf:'PDF',doc:'DOC',sheet:'表格',image:'图片',video:'视频',assignment:'作业',discussion:'讨论',archive:'压缩',other:'文件'};

function status(message){ui.status.textContent=message;}
function busy(value){state.busy=value;for(const id of ['refresh-courses','load-course','select-visible','clear-videos','clear-selection','prepare-download'])ui[id].disabled=value;
  ui['course-select'].disabled=value;ui.search.disabled=value;ui['type-filter'].disabled=value;
  ui['file-list'].querySelectorAll('input[type="checkbox"]').forEach(box=>box.disabled=value);}
function showPermissionOrigins(origins){ui['permission-domains'].replaceChildren();
  for(const origin of origins){const row=document.createElement('span');row.className='permission-domain';row.textContent=new URL(origin).hostname;ui['permission-domains'].append(row);}
  ui['permissions-note'].hidden=!origins.length;}
function displayError(error){status(error instanceof Error?error.message:String(error));}
function clearFailedRecords(ids){const selected=new Set(ids.map(String));
  state.records=state.records.filter(record=>record.state!=='failed'||!selected.has(String(record.id)));
  for(const row of [...ui['activity-list'].children])
    if(row.dataset.state==='failed'&&selected.has(row.dataset.fileId))row.remove();
  ui['export-report'].disabled=!state.records.length;}
function showPreparationFailures(failures){for(const item of failures){
    const existing=state.records.find(record=>record.state==='failed'&&String(record.id)===String(item.id));
    if(existing)Object.assign(existing,item);else state.records.unshift({...item});
    const row=[...ui['activity-list'].children].find(entry=>entry.dataset.phase==='prepare'&&entry.dataset.fileId===String(item.id));
    if(row)row.querySelector('.activity-detail').textContent=item.error;
    else addActivity(item,'failed',item.error,'prepare');
  }
  ui['export-report'].disabled=!state.records.length;}
function selectedFiles(){return state.files.filter(file=>state.selected.has(file.id));}
function matches(file){const q=ui.search.value.trim().toLocaleLowerCase();const kind=ui['type-filter'].value;
  return (!q||`${file.name} ${file.folders.join(' ')}`.toLocaleLowerCase().includes(q))&&(kind==='all'||file.type===kind);}

function typeIcon(file){const span=document.createElement('span');span.className=`type-badge ${file.type}`;span.dataset.type=file.type;span.textContent=typeLabel[file.type]||'文件';span.setAttribute('aria-hidden','true');return span;}
function renderFiles(){
  const visible=state.files.filter(matches);ui['visible-count'].textContent=String(visible.length);
  ui['selected-count'].textContent=String(state.selected.size);
  ui['file-list'].replaceChildren();ui['empty-state'].hidden=visible.length>0;
  if(!visible.length){ui['empty-state'].querySelector('h2').textContent=state.files.length?'没有符合条件的资源':'课程中没有可下载的资源';
    ui['empty-state'].querySelector('p').textContent=state.files.length?'试试更短的关键词或切换资源类型。':'此课程暂未提供可下载的附件、视频、作业或讨论。';return;}
  const chapters=new Map();
  for(const file of visible){const key=file.folders.map((name,i)=>`${file.folderIds[i]||i}:${name}`).join('/');
    let group=chapters.get(key);if(!group){group={label:file.folders.at(-1)||'课程附件',parents:file.folders.slice(0,-1),files:[]};chapters.set(key,group);}group.files.push(file);}
  for(const group of chapters.values()){
    if(!group.label&&chapters.size===1){for(const file of group.files)ui['file-list'].append(renderRow(file));continue;}
    const details=document.createElement('details');details.className='chapter';details.open=true;
    const summary=document.createElement('summary');const name=document.createElement('span');name.textContent=[...group.parents,group.label].filter(Boolean).join(' / ');
    const count=document.createElement('span');count.className='muted';count.textContent=`${group.files.length} 个文件`;summary.append(name,count);details.append(summary);
    for(const file of group.files)details.append(renderRow(file));ui['file-list'].append(details);
  }
}
function renderRow(file){
  const row=document.createElement('label');row.className='file-row';
  const box=document.createElement('input');box.type='checkbox';box.checked=state.selected.has(file.id);box.disabled=state.busy;box.setAttribute('aria-label',`选择 ${file.name}`);
  box.addEventListener('change',()=>{if(box.checked)state.selected.add(file.id);else state.selected.delete(file.id);ui['selected-count'].textContent=String(state.selected.size);});
  const main=document.createElement('span');main.className='file-main';
  const title=document.createElement('span');title.className='file-name';title.textContent=file.name;title.title=file.name;
  const path=document.createElement('span');path.className='file-path';path.textContent=file.folders.join(' / ')||state.title;path.title=path.textContent;
  main.append(title,path);const size=document.createElement('span');size.className='file-size';size.textContent=file.type==='video'&&!file.size?'视频流':formatSize(file.size);row.append(box,typeIcon(file),main,size);return row;
}

async function refreshCourses(){busy(true);try{const old=ui['course-select'].value;state.courses=await listCourses();ui['course-select'].replaceChildren();
    if(!state.courses.length){ui['course-select'].add(new Option('请先打开小雅课程页面',''));status('没有检测到已打开的小雅课程页。请先进入小雅的一门课程，再点刷新课程。');return;}
    for(const course of state.courses)ui['course-select'].add(new Option(course.title,String(course.tabId)));
    const source=new URLSearchParams(location.search).get('source');const value=state.courses.some(c=>String(c.tabId)===source)?source:
      state.courses.some(c=>String(c.tabId)===old)?old:String(state.courses[0].tabId);
    ui['course-select'].value=value;status(`找到 ${state.courses.length} 个已打开的小雅课程页。`);
  }catch(error){displayError(error);}finally{busy(false);}}

async function readCourse(){const course=state.courses.find(c=>String(c.tabId)===ui['course-select'].value);if(!course){status('先选择一个小雅课程页面。');return;}
  busy(true);state.course=course;state.prepared=null;state.failed=[];state.records=[];ui['start-download'].hidden=true;ui['retry-failed'].hidden=true;ui['prepare-download'].hidden=false;
  ui['activity-list'].replaceChildren();ui['export-report'].disabled=true;
  try{const result=await loadCourse(course);state.title=result.title;state.files=result.files;state.selected.clear();
    ui['course-title'].textContent=result.displayTitle||result.title;
    const resourceSummary=[`${result.files.length} 个资源`,result.videos?`${result.videos} 个视频`:'',
      result.assignments?`${result.assignments} 个作业`:'',result.discussions?`${result.discussions} 个讨论`:''
    ].filter(Boolean).join(' · ');
    ui['course-meta'].textContent=result.assignmentQuestions!=null
      ?`1 份${result.assignmentResult?'作业答卷':'作业题目'} · ${result.assignmentQuestions} 道题${result.assignmentResult?'，包含页面上可见的个人答案与成绩':'，不含未显示的个人答案或成绩'}`
      :resourceSummary;
    renderFiles();status(`已读取 ${result.files.length} 个资源。可按章节、文件名或类型筛选后勾选保存。`);
  }catch(error){state.files=[];state.selected.clear();renderFiles();displayError(error);}finally{busy(false);}}

async function chooseFolder(){if(state.busy)return;
  try{if(!window.showDirectoryPicker)throw new Error('当前 Edge 版本不支持选择保存文件夹，请更新浏览器。');
    state.root=await window.showDirectoryPicker({id:'xiaoya-course-download',mode:'readwrite'});
    ui['folder-name'].textContent=state.root.name;ui['folder-name'].title=state.root.name;status(`保存位置已选为“${state.root.name}”。`);
  }catch(error){if(error.name!=='AbortError')displayError(error);}}

async function prepare(){const files=selectedFiles();if(!state.course){status('请先读取一门课程。');return;}
  if(!files.length){status('请先勾选需要下载的资源。');return;}
  if(!state.root){status('请先选择保存文件夹。');return;}
  busy(true);state.controller=new AbortController();const run=++state.runId;
  ui['prepare-download'].disabled=true;ui['cancel-download'].hidden=false;ui['progress'].value=0;ui['progress-label'].textContent='正在获取地址';
  ui['permissions-note'].hidden=true;ui['permission-domains'].replaceChildren();ui['start-download'].hidden=true;status(`正在准备 ${files.length} 个文件的下载地址…`);
  try{state.prepared=await prepareFiles(state.course,files,p=>{if(run===state.runId){ui['progress'].value=p.total?Math.round(p.done/p.total*100):0;ui['progress-label'].textContent=`${p.done}/${p.total}`;}},state.controller.signal);
    if(run!==state.runId)return;state.failed=state.prepared.failed;
    clearFailedRecords(files.map(file=>file.id));showPreparationFailures(state.failed);
    const needs=state.prepared.newlyGrantedOrigins;
    showPermissionOrigins(needs);
    ui['progress'].value=100;ui['progress-label'].textContent=`${state.prepared.ready.length}/${files.length} 可下载`;
    if(state.prepared.ready.length){ui['start-download'].hidden=false;status(state.failed.length?`已准备 ${state.prepared.ready.length} 个，${state.failed.length} 个地址获取失败；可开始已准备的文件。`:`${state.prepared.ready.length} 个文件已就绪，点击“开始下载”。`);}
    else status('没有文件准备成功。请检查失败原因后重试。');
    ui['retry-failed'].hidden=!state.failed.length;
  }catch(error){if(run===state.runId){if(!state.controller.signal.aborted)displayError(error);ui['progress-label'].textContent=state.controller.signal.aborted?'已取消':'准备失败';}}
  finally{if(run===state.runId){ui['cancel-download'].hidden=true;ui['prepare-download'].disabled=false;state.controller=null;busy(false);}}
}

function addActivity(file,stateName,detail,phase='download'){const row=document.createElement('div');row.className='activity-row';row.dataset.state=stateName;
  row.dataset.fileId=String(file.id||'');row.dataset.phase=phase;
  const name=document.createElement('div');name.className='activity-name';name.textContent=file.name;const info=document.createElement('div');info.className='activity-detail';info.textContent=detail;
  row.append(name,info);ui['activity-list'].prepend(row);return info;}

async function runDownloads(batch){if(state.busy)return;
  if(!state.root){status('请先选择保存文件夹。');return;}
  const run=++state.runId;state.controller=new AbortController();const signal=state.controller.signal;
  // Permission prompt must run in this direct click handler, before any await.
  const requestedOrigins=[...(batch.newlyGrantedOrigins||[])];
  const accessRequest=grantDownloadAccess(requestedOrigins);
  let waitingForAccess=false;
  busy(true);ui['start-download'].hidden=true;ui['retry-failed'].hidden=true;ui['cancel-download'].hidden=false;
  ui['permissions-note'].hidden=true;
  try{
    const granted=await accessRequest;
    if(!granted){
      const partiallyGranted=[];
      for(const origin of requestedOrigins)if(await chrome.permissions.contains({origins:[origin]}))partiallyGranted.push(origin);
      batch.grantedOrigins=[...new Set([...(batch.grantedOrigins||[]),...partiallyGranted])];
      ui['start-download'].hidden=false;waitingForAccess=true;showPermissionOrigins(requestedOrigins);
      status('未获媒体站点访问授权；点击“开始下载”并在 Edge 提示中允许列出的域名后继续。');return;}
    batch.grantedOrigins=[...new Set([...(batch.grantedOrigins||[]),...requestedOrigins])];
    batch.newlyGrantedOrigins=[];
    const missingOrigins=new Set();
    for(const item of batch.ready.filter(entry=>entry.file.type==='video'&&entry.mode!=='direct')){
      item.hlsPlan=null;item.hlsError='';
      try{
        const resolved=await resolveVideoPlaylist(item,signal);
        item.hlsPlan=resolved.plan;
        for(const origin of resolved.missingOrigins)missingOrigins.add(origin);
      }catch(error){if(signal.aborted)throw error;item.hlsError=error.message;}
    }
    if(missingOrigins.size){
      batch.newlyGrantedOrigins=[...new Set([...(batch.grantedOrigins||[]),...missingOrigins])];
      showPermissionOrigins(batch.newlyGrantedOrigins);
      ui['start-download'].hidden=false;waitingForAccess=true;
      status('视频播放清单引用了其他媒体域名。请点击“开始下载”，授权列表中的域名后继续。');return;
    }
    for(const [index,item] of batch.ready.entries()){
      if(signal.aborted)break;
      const record={id:item.file.id,name:item.file.name,state:'downloading'};state.records.unshift(record);
      const info=addActivity(item.file,'downloading','正在下载');ui['progress-label'].textContent=`${index+1}/${batch.ready.length}`;
      status(`正在下载 ${item.file.name}…`);
      try{
        if(item.file.type==='video'&&item.mode==='direct'){
          const saved=await saveProgressiveVideo(state.root,state.title,item,ui['preserve-folders'].checked,signal,progress=>{
            const fraction=progress.totalBytes?progress.bytes/progress.totalBytes:0;
            ui['progress'].value=Math.min(99,Math.round((index+fraction)/batch.ready.length*100));
            ui['progress-label'].textContent=`${formatSize(progress.bytes)}${progress.totalBytes?` / ${formatSize(progress.totalBytes)}`:''}`;
            info.textContent=ui['progress-label'].textContent;
          });
          record.state='complete';record.path=saved.path;record.bytes=saved.bytes;record.outputName=saved.name;
          ui['activity-list'].querySelector('.activity-row[data-state="downloading"]')?.setAttribute('data-state','complete');
          info.textContent=`已保存为 ${saved.name} · ${formatSize(saved.bytes)}`;
        }else if(item.file.type==='video'){
          if(item.hlsError)throw new Error(item.hlsError);
          const saved=await saveHlsVideo(state.root,state.title,item,ui['preserve-folders'].checked,signal,progress=>{
            const fraction=progress.totalSegments?progress.doneSegments/progress.totalSegments:0;
            ui['progress'].value=Math.min(99,Math.round((index+fraction)/batch.ready.length*100));
            ui['progress-label'].textContent=`${progress.doneSegments}/${progress.totalSegments} 段`;
            info.textContent=`${formatSize(progress.bytes)} · ${progress.doneSegments}/${progress.totalSegments} 段`;
          });
          record.state='complete';record.path=saved.path;record.bytes=saved.bytes;record.outputName=saved.name;
          ui['activity-list'].querySelector('.activity-row[data-state="downloading"]')?.setAttribute('data-state','complete');
          info.textContent=`已保存为 ${saved.name} · ${formatSize(saved.bytes)}`;
        }else if(item.file.type==='assignment'||item.file.type==='discussion'){
          const bytes=new TextEncoder().encode(item.content);
          const saved=await saveFile(state.root,state.title,item.file,bytes,ui['preserve-folders'].checked,signal);
          record.state='complete';record.path=saved;record.bytes=bytes.byteLength;
          ui['activity-list'].querySelector('.activity-row[data-state="downloading"]')?.setAttribute('data-state','complete');
          info.textContent=`${item.file.type==='discussion'?'讨论主题':'作业内容'}已保存 · ${formatSize(bytes.byteLength)}`;
        }else{
          const result=await fetchFile(item,signal,(received,total)=>{if(!signal.aborted){const fraction=total?received/total:0;
            ui['progress'].value=Math.min(99,Math.round((index+fraction)/batch.ready.length*100));info.textContent=`${formatSize(received)}${total?` / ${formatSize(total)}`:''}`;}});
          signal.throwIfAborted();const saved=await saveFile(state.root,state.title,item.file,result.bytes,ui['preserve-folders'].checked,signal);
          record.state='complete';record.path=saved;record.bytes=result.validation.bytes;record.slides=result.validation.slides;
          ui['activity-list'].querySelector('.activity-row[data-state="downloading"]')?.setAttribute('data-state','complete');
          info.textContent=`已保存 · ${formatSize(result.validation.bytes)}${result.validation.slides?` · ${result.validation.slides} 张`:''}`;
        }
      }catch(error){if(error.missingOrigins?.length){
          state.records=state.records.filter(itemRecord=>itemRecord!==record);
          ui['activity-list'].querySelector('.activity-row[data-state="downloading"]')?.remove();
          batch.newlyGrantedOrigins=[...new Set([...(batch.grantedOrigins||[]),...(batch.newlyGrantedOrigins||[]),...error.missingOrigins])];
          showPermissionOrigins(batch.newlyGrantedOrigins);ui['start-download'].hidden=false;waitingForAccess=true;
          status('媒体服务器跳转到了新的域名。请点击“开始下载”，授权列表中的域名后继续。');break;
        }
        if(signal.aborted){record.state='failed';record.error=signal.reason?.message||'下载已取消';
          ui['activity-list'].querySelector('.activity-row[data-state="downloading"]')?.setAttribute('data-state','failed');info.textContent=record.error;break;}
        record.state='failed';record.error=error.message;
        ui['activity-list'].querySelector('.activity-row[data-state="downloading"]')?.setAttribute('data-state','failed');info.textContent=error.message;}
      if(run!==state.runId)break;
    }
  }catch(error){if(!signal.aborted)status(error.message);}
  finally{
    if(run===state.runId){state.controller=null;ui['cancel-download'].hidden=true;busy(false);
      if(waitingForAccess)ui['progress-label'].textContent='等待授权';
      else{
        ui['progress'].value=100;ui['progress-label'].textContent=signal.aborted?'已停止':'本轮完成';
        state.failed=state.records.filter(x=>x.state==='failed').map(x=>({...x}));
        ui['retry-failed'].hidden=!state.failed.length;ui['export-report'].disabled=!state.records.length;
        const done=state.records.filter(x=>x.state==='complete').length;
        status(signal.aborted?`已停止。${done} 个完成，${state.failed.length} 个失败。`:`本轮已完成：${done} 个成功，${state.failed.length} 个失败。`);
      }
    }
    if(batch.grantedOrigins?.length){
      const granted=[...batch.grantedOrigins];
      if(waitingForAccess)batch.newlyGrantedOrigins=[...new Set([...granted,...(batch.newlyGrantedOrigins||[])])];
      batch.grantedOrigins=[];
      await releaseDownloadAccess(granted).catch(()=>{});
    }
  }
}

async function startPrepared(){if(!state.prepared?.ready.length)return;
  const prepared=state.prepared;await runDownloads(prepared);
  if(!ui['start-download'].hidden)return;
  state.prepared=null;}
async function retryFailed(){if(!state.failed.length||!state.course)return;
  const failed=[...state.failed];const selected=new Set(failed.map(x=>x.id));const files=state.files.filter(x=>selected.has(x.id));
  busy(true);state.controller=new AbortController();const run=++state.runId;ui['cancel-download'].hidden=false;
  try{const batch=await prepareFiles(state.course,files,undefined,state.controller.signal);
    if(run!==state.runId)return;
    clearFailedRecords([...selected]);state.failed=batch.failed;showPreparationFailures(state.failed);
    if(batch.ready.length){state.prepared=batch;status(`重试后已准备 ${batch.ready.length} 个文件${batch.failed.length?`，${batch.failed.length} 个仍失败`:''}，点“开始下载”。`);ui['start-download'].hidden=false;}
    else{status('失败文件的地址仍无法获取，具体原因见下方记录。');ui['retry-failed'].hidden=false;}
  }catch(error){if(!state.controller?.signal.aborted)displayError(error);}
  finally{if(run===state.runId){state.controller=null;ui['cancel-download'].hidden=true;busy(false);}}
}

function exportReport(){if(!state.records.length)return;
  const byType={};for(const file of state.files)byType[file.type]=(byType[file.type]||0)+1;
  const report={formatVersion:2,course:state.title,createdAt:new Date().toISOString(),
    inventory:{total:state.files.length,byType,selected:selectedFiles().map(file=>({name:file.name,type:file.type,chapter:file.folders.join(' / ')}))},
    files:state.records.map(({name,state,path,bytes,slides,error})=>({name,state,path,bytes,slides,error}))};
  const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`${sanitizeName(state.title)}-下载报告.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

ui['refresh-courses'].addEventListener('click',refreshCourses);
ui['load-course'].addEventListener('click',readCourse);
ui['course-select'].addEventListener('change',()=>{state.prepared=null;ui['start-download'].hidden=true;});
ui.search.addEventListener('input',renderFiles);ui['type-filter'].addEventListener('change',renderFiles);
ui['select-visible'].addEventListener('click',()=>{for(const file of state.files.filter(matches))state.selected.add(file.id);renderFiles();});
ui['clear-videos'].addEventListener('click',()=>{for(const file of state.files)if(file.type==='video')state.selected.delete(file.id);renderFiles();});
ui['clear-selection'].addEventListener('click',()=>{state.selected.clear();renderFiles();});
ui['choose-folder'].addEventListener('click',chooseFolder);
ui['prepare-download'].addEventListener('click',prepare);ui['start-download'].addEventListener('click',startPrepared);
ui['cancel-download'].addEventListener('click',()=>{state.controller?.abort(new DOMException('用户已取消下载。','AbortError'));});
ui['retry-failed'].addEventListener('click',retryFailed);ui['export-report'].addEventListener('click',exportReport);
renderFiles();refreshCourses();
