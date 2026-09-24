import test from 'node:test';
import assert from 'node:assert/strict';
import {pageRequest} from '../extension/page-api.js';

function installPageMocks(t,{pathname='/app/jx-web/mycourse/1111111111111111111/resource',fetchImpl}={}){
  const priorLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
  const priorDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const priorFetch=globalThis.fetch;
  globalThis.location={protocol:'https:',hostname:'whut.ai-augmented.com',pathname};
  globalThis.document={cookie:'prd-access-token=account-token',querySelectorAll:()=>[],querySelector:()=>null};
  globalThis.fetch=fetchImpl;
  t.after(()=>{
    globalThis.fetch=priorFetch;
    if(priorLocation)Object.defineProperty(globalThis,'location',priorLocation);else delete globalThis.location;
    if(priorDocument)Object.defineProperty(globalThis,'document',priorDocument);else delete globalThis.document;
  });
}

test('follows XiaoyaDownloader video lookup and play-auth flow with course access grant',async t=>{
  const requests=[];
  const json=(value)=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  installPageMocks(t,{fetchImpl:async(url,init={})=>{
    requests.push({url:String(url),init});
    if(String(url).includes('/resource/queryResource?node_id=')){
      return requests.filter(item=>item.url.includes('/resource/queryResource?node_id=')).length===1
        ?json({success:false,code:50007})
        :json({success:true,data:{resource:{video_id:'video-42'}}});
    }
    if(String(url).includes('/statistics/group/visit'))return json({success:true,data:{site_id:'site-9'}});
    if(String(url).includes('/group/access/authorization'))return json({success:true,data:{access_group_token:'short-course-token'}});
    if(String(url).includes('/vod/video/play_auth/'))return json({success:true,data:{private_vod:[{private_url:'https://media.example.edu/lecture.m3u8'}]}});
    throw new Error(`Unexpected request ${url}`);
  }});
  const result=await pageRequest('video',{courseId:'1111111111111111111',resourceId:'222'});
  assert.deepEqual(result,{ok:true,data:{url:'https://media.example.edu/lecture.m3u8'}});
  const queryCalls=requests.filter(item=>item.url.includes('/resource/queryResource?node_id='));
  assert.equal(queryCalls.length,2);
  assert.equal(queryCalls[0].init.headers['X-Course-Access'],undefined);
  assert.equal(queryCalls[1].init.headers['X-Course-Access'],'short-course-token');
  assert.equal(requests.some(item=>item.url.includes('/resource/queryResource/v3?')),false);
  assert.ok(requests.some(item=>item.url.includes('/vod/video/play_auth/video-42')));
  assert.equal(requests.every(item=>item.init.headers.Authorization==='Bearer account-token'),true);
  assert.doesNotMatch(JSON.stringify(result),/account-token|short-course-token/);
});

test('does not treat a similarly named cookie as the Xiaoya login token',async t=>{
  const requests=[];
  installPageMocks(t,{fetchImpl:async(...args)=>{requests.push(args);throw new Error('should not fetch');}});
  globalThis.document.cookie='not-prd-access-token=spoofed-value';
  const result=await pageRequest('list',{courseId:'1111111111111111111'});
  assert.equal(result.ok,false);
  assert.match(result.error,/登录状态不可用/);
  assert.equal(requests.length,0);
});

test('uses the active player source for the matching Xiaoya video resource',async t=>{
  const courseId='1111111111111111111';
  installPageMocks(t,{pathname:`/app/jx-web/mycourse/${courseId}/resource/444/222`,fetchImpl:async()=>{
    throw new Error('player source should avoid API fallback');
  }});
  const player={currentSrc:'https://media.example.edu/lesson.mp4?signature=fixture',src:'',querySelectorAll:()=>[]};
  globalThis.document.querySelectorAll=selector=>selector==='video'?[player]:[];
  const result=await pageRequest('video',{courseId,resourceId:'222'});
  assert.deepEqual(result,{ok:true,data:{url:'https://media.example.edu/lesson.mp4?signature=fixture',source:'player'}});
});

test('does not reuse the active player source for a different selected video',async t=>{
  const courseId='1111111111111111111';
  const requests=[];
  const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  installPageMocks(t,{pathname:`/app/jx-web/mycourse/${courseId}/resource/444/222`,fetchImpl:async url=>{
    requests.push(String(url));
    if(String(url).includes('/resource/queryResource?node_id=223'))return json({success:true,data:{resource:{video_id:'target-video'}}});
    if(String(url).includes('/vod/video/play_auth/target-video'))return json({success:true,data:{private_vod:[{private_url:'https://media.example.edu/other.mp4'}]}});
    throw new Error(`Unexpected request ${url}`);
  }});
  const player={currentSrc:'https://media.example.edu/active.mp4',src:'',querySelectorAll:()=>[]};
  globalThis.document.querySelectorAll=selector=>selector==='video'?[player]:[];
  const result=await pageRequest('video',{courseId,resourceId:'223'});
  assert.deepEqual(result,{ok:true,data:{url:'https://media.example.edu/other.mp4'}});
  assert.ok(requests.some(url=>url.includes('node_id=223')));
  assert.ok(requests.some(url=>url.includes('/play_auth/target-video')));
});

test('falls back to the v3 resource endpoint and accepts keyed private_vod entries',async t=>{
  const requests=[];
  const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  installPageMocks(t,{fetchImpl:async(url,init={})=>{
    requests.push({url:String(url),init});
    if(String(url).includes('/resource/queryResource?node_id='))return json({success:false,code:404});
    if(String(url).includes('/resource/queryResource/v3?'))return json({success:true,data:{resource:{video_id:'video-43'}}});
    if(String(url).includes('/vod/video/play_auth/video-43'))return json({success:true,data:{private_vod:{hls:{private_url:'https://media.example.edu/lecture.m3u8'}}}});
    throw new Error(`Unexpected request ${url}`);
  }});
  const result=await pageRequest('video',{courseId:'1111111111111111111',resourceId:'223'});
  assert.deepEqual(result,{ok:true,data:{url:'https://media.example.edu/lecture.m3u8'}});
  assert.ok(requests[0].url.includes('/resource/queryResource?node_id=223'));
  assert.ok(requests[1].url.includes('/resource/queryResource/v3?'));
});

test('loads the v2 course resource list and preserves task metadata',async t=>{
  const requests=[];
  const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  installPageMocks(t,{fetchImpl:async(url,init={})=>{
    requests.push({url:String(url),init});
    if(String(url).includes('/resource/queryCourseResources/v2'))return json({success:true,data:[
      {id:'100',name:'课程作业',type:7,quote_id:'paper-7',task_id:'task-7',task_type:2,parent_id:'1'},
      {id:'101',name:'课堂讨论',type:8,quote_id:'discussion-8',task_id:'task-8',task_type:6,parent_id:'1'}
    ]});
    throw new Error(`Unexpected request ${url}`);
  }});
  const result=await pageRequest('list',{courseId:'1111111111111111111'});
  assert.equal(result.ok,true);
  assert.equal(result.data.nodes[0].task_id,'task-7');
  assert.equal(result.data.nodes[0].task_type,2);
  assert.equal(result.data.nodes[1].quote_id,'discussion-8');
  assert.match(requests[0].url,/queryCourseResources\/v2\?group_id=1111111111111111111/);
});

test('exports safe assignment prompts and choices from the paper API without answer keys',async t=>{
  let requestedUrl='';
  const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  installPageMocks(t,{fetchImpl:async url=>{
    requestedUrl=String(url);
    if(requestedUrl.includes('/survey/queryPaper/v2'))return json({success:true,data:{title:'第一章作业',questions:[
      {title:'<p>选择题题干</p>',type_name:'单选题',score:2,answer_items:[{content:'<p>选项甲</p>'},{content:'选项乙'}],correct_answer:'A',analysis:'不应导出'}
    ]}});
    throw new Error(`Unexpected request ${url}`);
  }});
  const result=await pageRequest('paper',{courseId:'1111111111111111111',quoteId:'222',taskId:'333',name:'作业'});
  assert.equal(result.ok,true);
  assert.match(requestedUrl,/paper_id=222/);
  assert.match(requestedUrl,/task_id=333/);
  assert.deepEqual(result.data.questions[0],{
    number:'1',prompt:'选择题题干',kind:'单选题 · 2 分',earned:'',
    choices:[{label:'A',text:'选项甲',selected:false},{label:'B',text:'选项乙',selected:false}],answers:[],order:[]
  });
  assert.doesNotMatch(JSON.stringify(result),/correct_answer|analysis|不应导出/);
});

test('exports discussion topic details but omits participant posts',async t=>{
  const requests=[];
  const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  const key='xiaoya-discuss';
  const discussionText=JSON.stringify({content:'讨论主题',points:[{content:'仅同学可见的发言正文'}]});
  let keyIndex=0;
  const encodedData=Buffer.from([...discussionText].map(character=>{
    const value=String.fromCodePoint(character.codePointAt(0)^key.charCodeAt(keyIndex%key.length));keyIndex++;return value;
  }).join(''),'utf8').toString('base64');
  installPageMocks(t,{fetchImpl:async url=>{
    requests.push(String(url));
    if(String(url).includes('/resource/queryResource/v3'))return json({success:true,data:{id:'444',name:'课堂讨论',type:8,resource:{description:'讨论说明'}}});
    if(String(url).includes('/discussion/queryDiscussion'))return json({success:true,data:encodedData});
    throw new Error(`Unexpected request ${url}`);
  }});
  const result=await pageRequest('discussion',{courseId:'1111111111111111111',resourceId:'444',quoteId:'555',name:'课堂讨论'});
  assert.equal(result.ok,true);
  assert.equal(result.data.title,'课堂讨论');
  assert.equal(result.data.content,'讨论主题');
  assert.equal(result.data.description,'讨论说明');
  assert.doesNotMatch(JSON.stringify(result),/仅同学可见的发言正文/);
  assert.match(requests.find(url=>url.includes('/discussion/queryDiscussion')),/page_size=0/);
});

test('labels an open submitted-paper page without relying on course breadcrumb text',async t=>{
  installPageMocks(t,{pathname:'/app/jx-web/course_paper/mycourse/1111111111111111111/123/456',fetchImpl:async()=>{throw new Error('not used');}});
  globalThis.document.querySelector=selector=>selector==='.ta_survey_title'?{textContent:'第一章作业'}:null;
  const result=await pageRequest('title',{courseId:'1111111111111111111'});
  assert.equal(result.ok,true);
  assert.equal(result.data.kind,'assignment');
  assert.equal(result.data.assignmentTitle,'第一章作业');
  assert.equal(result.data.pageState,'作业答卷页面');
});

test('recognizes a visible assignment resource page without opening or starting the task',async t=>{
  installPageMocks(t,{fetchImpl:async()=>{throw new Error('not used');}});
  globalThis.location.pathname='/app/jx-web/mycourse/1111111111111111111/resource/222/333';
  globalThis.document.querySelector=selector=>{
    if(selector==='.ta_survey_title')return {textContent:'第一章作业'};
    if(selector==='.paper_computer_exam')return {querySelectorAll:()=>[{}]};
    return null;
  };
  const result=await pageRequest('title',{courseId:'1111111111111111111'});
  assert.equal(result.ok,true);
  assert.equal(result.data.kind,'assignment');
  assert.equal(result.data.assignmentTitle,'第一章作业');
  assert.equal(result.data.pageState,'作业任务页面');
});

test('reads the course name from the second Xiaoya breadcrumb link',async t=>{
  installPageMocks(t,{fetchImpl:async()=>{throw new Error('not used');}});
  globalThis.document.querySelectorAll=selector=>selector==='.header-title a, .header-title-path'
    ?[{textContent:'我学的课程'},{textContent:'示例课程A'}]:[];
  const result=await pageRequest('title',{courseId:'1111111111111111111'});
  assert.equal(result.ok,true);
  assert.equal(result.data.title,'示例课程A');
  assert.deepEqual(result.data.breadcrumbs,['示例课程A']);
});

test('keeps the course name stable and returns nested breadcrumb labels from a folder page',async t=>{
  installPageMocks(t,{fetchImpl:async()=>{throw new Error('not used');}});
  globalThis.document.querySelectorAll=selector=>selector==='.header-title a, .header-title-path'
    ?[{textContent:'我学的课程'},{textContent:'示例课程A'},{textContent:'示例章节'},{textContent:'示例子文件夹'}]:[];
  const result=await pageRequest('title',{courseId:'1111111111111111111'});
  assert.equal(result.ok,true);
  assert.equal(result.data.title,'示例课程A');
  assert.deepEqual(result.data.breadcrumbs,['示例课程A','示例章节','示例子文件夹']);
});
