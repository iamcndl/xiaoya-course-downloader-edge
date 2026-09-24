// Self-contained function executed in Chrome's ISOLATED world on the course tab.
// Never returns a cookie or bearer token to the extension or a file host.
export async function pageRequest(action, args) {
  try {
    const plainText=value=>{
      if(typeof value!=='string'&&typeof value!=='number')return '';
      return String(value).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(?:p|div|li|h[1-6])\s*>/gi,'\n')
        .replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&')
        .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
        .replace(/[ \t\r\f\v]+/g,' ').replace(/ *\n */g,'\n').trim();
    };
    const decodeDiscussionData=value=>{
      if(typeof value!=='string')return value;
      try{return JSON.parse(value)}catch{}
      try{
        const key='xiaoya-discuss';
        const bytes=Uint8Array.from(atob(value),character=>character.charCodeAt(0));
        const encodedText=new TextDecoder().decode(bytes);
        let decoded='',index=0;
        for(const character of encodedText){
          decoded+=String.fromCodePoint(character.codePointAt(0)^key.charCodeAt(index%key.length));
          index++;
        }
        return JSON.parse(decoded);
      }catch{return null}
    };
    const normalizePaperQuestions=paper=>{
      const input=Array.isArray(paper?.questions)?paper.questions:Object.values(paper?.questions||paper?._questionsObject||{});
      const letters='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      return input.slice(0,500).map((question,index)=>{
        const options=Array.isArray(question?.answer_items)?question.answer_items:[];
        const kind=plainText(question?.type_name||question?.type_text||question?.question_type_name||question?.type_label||'');
        const maxScore=Number(question?.score);
        const scoreText=Number.isFinite(maxScore)&&maxScore>0?`${maxScore} 分`:'';
        return {
          number:plainText(question?._renderIndex||question?.sequence||question?.number||String(index+1)),
          prompt:plainText(question?.title||question?.stem||question?.content||question?.question_content||question?.question_title||''),
          kind:[kind,scoreText].filter(Boolean).join(' · '),earned:'',
          choices:options.slice(0,100).map((option,optionIndex)=>({
            label:plainText(option?.sequence||option?.label||option?.name||letters[optionIndex]||String(optionIndex+1)),
            text:plainText(option?.title||option?.content||option?.text||option?.value||''),selected:false
          })).filter(option=>option.text),
          answers:[],order:[]
        };
      }).filter(question=>question.prompt||question.choices.length);
    };
    if (location.protocol !== 'https:' || !/(^|\.)ai-augmented\.com$/.test(location.hostname))
      throw new Error('请在小雅课程页面使用。');
    const paperMatch = location.pathname.match(/^\/app\/jx-web\/course_paper\/mycourse\/(\d{19})(?:\/|$)/);
    const courseMatch = location.pathname.match(/^\/app\/jx-web\/mycourse\/(\d{19})(?:\/|$)/);
    const current = paperMatch?.[1] || courseMatch?.[1];
    const isAssignmentPage = Boolean(paperMatch);
    if (current !== args.courseId) throw new Error('课程标签页已切换，请重新读取课程。');
    // Xiaoya's breadcrumb starts with the actual course, followed by chapters
    // and nested resource folders. The current tab title only names the last item.
    const breadcrumbs = Array.from(document.querySelectorAll('.header-title a, .header-title-path'))
      .map(node=>node.textContent?.trim()||'').filter(name=>name&&name!=='我学的课程');
    const courseTitle = breadcrumbs[0]||'';
    const assignmentTitle = document.querySelector('.ta_survey_title')?.textContent?.trim() || '';
    const visiblePaper = document.querySelector('.paper_computer_exam') || document.querySelector('.ta_paper');
    const visibleQuestions = Array.from(visiblePaper?.querySelectorAll('.ta_paper_questions .question') || []);
    const hasVisibleAssignment = Boolean(assignmentTitle && visibleQuestions.length);
    if (action === 'title') return {ok:true,data:{title:courseTitle,breadcrumbs,
      kind:isAssignmentPage||hasVisibleAssignment?'assignment':'course',assignmentTitle,
      pageState:isAssignmentPage?'作业答卷页面':hasVisibleAssignment?'作业任务页面':''}};
    if (action === 'assignment') {
      const paper = visiblePaper;
      const questionNodes = visibleQuestions.slice(0,500);
      if (!hasVisibleAssignment) throw new Error('当前页面没有可导出的作业内容；请在小雅打开作业题目或已提交答卷。');
      const metadata = [];
      const subtitle = paper.querySelector('.exam_paper_sub_title');
      if (subtitle) {
        for (const line of String(subtitle.innerText || '').split(/\n+/).map(value=>value.trim()).filter(Boolean)) {
          const pair = line.match(/^([^：:]+)[：:]\s*(.*)$/);
          if (pair) metadata.push({label:pair[1].trim(),value:pair[2].trim()});
        }
        const finalLabel = subtitle.querySelector('.strong_label')?.textContent?.trim();
        const finalValue = subtitle.querySelector('.strong_value')?.textContent?.trim();
        if (finalLabel && finalValue && !metadata.some(item=>item.label===finalLabel)) metadata.push({label:finalLabel,value:finalValue});
      }
      const questions = questionNodes.map((question,index)=>{
        const stem = question.querySelector('.stem_title') || question.querySelector('.exam_question_stem');
        const choices = Array.from(question.querySelectorAll('.question_single_subject label, .question_multiple_subject label')).map(label=>{
          const marker = label.querySelector('.exam_answer_item_sequence')?.textContent?.trim().replace(/[.。\s\u00a0]+$/,'') || '';
          const text = label.querySelector('.xy_rich_text_base')?.innerText?.trim() || '';
          const control = label.querySelector('input[type="radio"],input[type="checkbox"]');
          return {label:marker,text,selected:Boolean(control?.checked || label.classList.contains('ant-radio-wrapper-checked') || label.classList.contains('ant-checkbox-wrapper-checked'))};
        }).filter(choice=>choice.label || choice.text);
        const order = Array.from(question.querySelectorAll('.question_sort_subject .item')).map(item=>{
          const rank = item.querySelector('.radio')?.textContent?.trim() || '';
          const marker = item.querySelector('.item_sequence')?.textContent?.trim() || '';
          const text = item.querySelector('.xy_rich_text_base')?.innerText?.trim() || '';
          return [rank && `${rank}.`,marker,text].filter(Boolean).join(' ');
        }).filter(Boolean);
        const answers = [];
        for (const input of question.querySelectorAll('textarea,input[type="text"],[contenteditable="true"]')) {
          if (input.closest('.ext_question_operate')) continue;
          const value = String('value' in input ? input.value : input.innerText || input.textContent || '').trim();
          if (!value) continue;
          const label = input.closest('.ant-row-flex')?.querySelector('._label')?.textContent?.trim() || '';
          answers.push(`${label ? `${label} ` : ''}${value}`);
        }
        return {
          number:question.querySelector('.sequence')?.textContent?.replace(/[^\d]/g,'') || String(index+1),
          prompt:stem?.innerText?.trim() || '',
          kind:question.querySelector('.exam_question_stem .score')?.textContent?.replace(/[\[\]【】]/g,'').trim() || '',
          earned:question.querySelector('.checking_score')?.innerText?.trim() || '',
          choices,answers,order
        };
      });
      return {ok:true,data:{assignmentTitle,courseTitle,metadata,questions,exportMode:'visible-page',
        pageState:isAssignmentPage?'作业答卷页面':'作业任务页面'}};
    }
    const cookies = document.cookie.split(';').map(x=>x.trim());
    const entry = cookies.find(x=>x.slice(0,x.indexOf('=')).trim()==='prd-access-token');
    const token = entry?.slice(entry.indexOf('=')+1);
    if (!token) throw new Error('登录状态不可用，请回到小雅重新登录后重试。');
    const headers = {accept:'*/*','content-type':'application/json; charset=utf-8',
      Authorization:`Bearer ${token}`,'x-language':'zh-CN'};
    const apiJson = async (endpoint, init = {}) => {
      const response = await fetch(endpoint, {headers, credentials:'same-origin', redirect:'error',
        signal:AbortSignal.timeout(25000), ...init});
      if (response.status === 401 || response.status === 403)
        throw new Error('账号无权访问或登录已过期，请在小雅页面确认。');
      if (!response.ok) throw new Error(`小雅接口返回 HTTP ${response.status}，请稍后重试。`);
      return response.json();
    };
    const apiJsonWithCourseAccess = async (endpoint, init = {}) => {
      let json = await apiJson(endpoint, init);
      if (Number(json.code) !== 50007) return json;

      // Some courses require the short-lived course-access header in addition to
      // the normal account token. Keep both tokens inside this Xiaoya page.
      const visit = await apiJson('/api/jx-iresource/statistics/group/visit', {
        method:'POST', body:JSON.stringify({group_id:args.courseId, role_type:'normal'})});
      const siteId = visit.data?.site_id;
      if (!visit.success || siteId == null || String(siteId).length > 80)
        throw new Error('无法取得课程访问信息；请在小雅页面打开课程后重试。');
      const authorization = await apiJson(`/api/jx-iresource/group/access/authorization?site_id=${encodeURIComponent(siteId)}&role_type=4`);
      const courseAccess = authorization.data?.access_group_token;
      if (!authorization.success || typeof courseAccess !== 'string' || !courseAccess || courseAccess.length > 4096)
        throw new Error('小雅未授予此课程的访问权限，请确认账号有权访问该课程。');
      const retryHeaders = {...headers,'X-Course-Access':courseAccess};
      const retryResponse = await fetch(endpoint, {headers:retryHeaders, credentials:'same-origin', redirect:'error',
        signal:AbortSignal.timeout(25000), ...init});
      if (retryResponse.status === 401 || retryResponse.status === 403)
        throw new Error('课程访问授权已失效，请回到小雅课程页面后重试。');
      if (!retryResponse.ok) throw new Error(`小雅接口返回 HTTP ${retryResponse.status}，请稍后重试。`);
      return retryResponse.json();
    };
    if (action === 'video' && /^\d{1,30}$/.test(String(args.resourceId || ''))) {
      // XiaoyaDownloader also reads the active player element. Some lessons expose
      // a direct MP4 source here while play_auth succeeds without private_vod.
      // Use it only when the visible course route identifies this exact resource.
      const playerRoute=location.pathname.match(/\/mycourse\/(\d{19})\/resource\/(?:\d+\/)*(\d+)\/?$/);
      const playerPageMatches=playerRoute?.[1]===String(args.courseId)&&playerRoute?.[2]===String(args.resourceId);
      if(playerPageMatches){
        const playerUrls=Array.from(document.querySelectorAll('video')).flatMap(video=>[
          video.currentSrc,video.src,...Array.from(video.querySelectorAll('source')).flatMap(source=>[source.src,source.getAttribute('src')])
        ]).filter(value=>typeof value==='string'&&value);
        const playerUrl=playerUrls.find(value=>{
          try{return new URL(value,location.href).protocol==='https:';}catch{return false;}
        });
        if(playerUrl)return {ok:true,data:{url:new URL(playerUrl,location.href).href,source:'player'}};
      }
      // Follow XiaoyaDownloader's tested flow first: resolve the selected resource
      // node through queryResource, then request its play_auth private_vod URL.
      const readVideoId=json=>{
        const resource=json?.data?.resource||json?.data||{};
        const value=resource.video_id||resource.resource?.video_id||resource.videoId;
        return /^[\w-]{1,80}$/.test(String(value||''))?String(value):'';
      };
      const nodeId=encodeURIComponent(args.resourceId);
      let resourceJson=null; let resourceError=null; let videoId='';
      try {
        resourceJson=await apiJsonWithCourseAccess(`/api/jx-iresource/resource/queryResource?node_id=${nodeId}`);
        if(resourceJson.success)videoId=readVideoId(resourceJson);
      } catch(error) { resourceError=error; }
      if(!videoId){
        const resourceQuery=new URLSearchParams({node_id:String(args.resourceId),group_id:String(args.courseId)});
        try {
          resourceJson=await apiJsonWithCourseAccess(`/api/jx-iresource/resource/queryResource/v3?${resourceQuery}`);
          if(resourceJson.success)videoId=readVideoId(resourceJson);
        } catch(error) {
          if(!resourceError)resourceError=error;
        }
      }
      if(!videoId){
        if(resourceError)throw new Error(`无法从小雅读取视频信息：${resourceError.message}`);
        const code=String(resourceJson?.code??'未知').slice(0,20);
        throw new Error(`小雅视频信息接口未返回 video_id（代码 ${code}）。`);
      }
      const authJson = await apiJsonWithCourseAccess(`/api/jx-oresource/vod/video/play_auth/${encodeURIComponent(videoId)}`);
      const privateVod = authJson.data?.private_vod;
      const vodEntries=Array.isArray(privateVod)?privateVod:
        privateVod&&typeof privateVod==='object'?Object.values(privateVod):[];
      const url=vodEntries.find(item=>typeof item?.private_url==='string'&&item.private_url)?.private_url||'';
      if(!authJson.success){
        const code=String(authJson.code??'未知').slice(0,20);
        throw new Error(`小雅视频播放授权失败（代码 ${code}）。`);
      }
      if(!url){
        if(playerPageMatches)throw new Error('小雅播放授权没有返回地址，当前视频页也未检测到可用的播放器源；请等视频画面加载后重试。');
        throw new Error('小雅播放授权成功，但响应中没有 private_vod 播放地址；当前页未打开此视频或资源与播放器不匹配。请在小雅打开对应视频并等待播放器加载后重试。');
      }
      return {ok:true,data:{url}};
    }
    if (action === 'paper' && /^\d{1,30}$/.test(String(args.quoteId||''))) {
      const query=new URLSearchParams({paper_id:String(args.quoteId)});
      if (/^\d{1,30}$/.test(String(args.taskId||''))) query.set('task_id',String(args.taskId));
      const json=await apiJsonWithCourseAccess(`/api/jx-iresource/survey/queryPaper/v2?${query}`);
      if (!json.success) throw new Error(`小雅暂未提供此作业题目（代码 ${String(json.code??'未知').slice(0,20)}）。`);
      const paper=json.data||{};
      const questions=normalizePaperQuestions(paper);
      if (!questions.length) throw new Error('小雅返回的作业中没有可导出的题目内容。');
      return {ok:true,data:{assignmentTitle:String(args.name||paper.title||paper.name||'课程作业'),courseTitle,
        metadata:[{label:'导出范围',value:'题目与选项'},{label:'个人答案和成绩',value:'仅导出当前页面已经显示的内容'}],
        questions,exportMode:'paper'}};
    }
    if (action === 'discussion' && /^\d{1,30}$/.test(String(args.quoteId||''))) {
      const nodeQuery=new URLSearchParams({node_id:String(args.resourceId||''),group_id:String(args.courseId)});
      let node={};
      if (/^\d{1,30}$/.test(String(args.resourceId||''))) {
        try {
          const nodeJson=await apiJsonWithCourseAccess(`/api/jx-iresource/resource/queryResource/v3?${nodeQuery}`);
          node=nodeJson.data?.resource||nodeJson.data||{};
        } catch {}
      }
      const query=new URLSearchParams({discussion_id:String(args.quoteId),group_id:String(args.courseId),channel:'mycourse',
        page_index:'1',page_size:'0',sort_type:'1',sort_way:'0'});
      let details={};
      try {
        const discussionJson=await apiJsonWithCourseAccess(`/api/jx-iresource/discussion/queryDiscussion?${query}`);
        if (discussionJson.success) {
          const value=decodeDiscussionData(discussionJson.data);
          if (value&&typeof value==='object') details=value;
        }
      } catch {}
      const sources=[details,node,node.resource,node.property].filter(value=>value&&typeof value==='object');
      const readField=names=>{
        for (const source of sources) for (const name of names) {
          const value=plainText(source[name]);
          if (value) return value;
        }
        return '';
      };
      return {ok:true,data:{title:String(args.name||node.name||details.title||'课程讨论'),courseTitle,
        description:readField(['description','desc','prompt']),content:readField(['content','topic','body']),
        metadata:[
          {label:'导出范围',value:'讨论主题与说明'},
          {label:'讨论内容',value:'不包含同学发言和评论'}
        ]}};
    }
    let endpoint;
    if (action === 'list') endpoint = `/api/jx-iresource/resource/queryCourseResources/v2?group_id=${current}`;
    else if (action === 'file' && /^\d{1,30}$/.test(args.quoteId)) endpoint = `/api/jx-oresource/cloud/file_url/${args.quoteId}`;
    else throw new Error('不支持的请求。');
    const json = await apiJsonWithCourseAccess(endpoint);
    if (!json.success) {
      if (Number(json.code) === 50007) throw new Error('当前课程需要在小雅页面完成访问授权；完成后重新读取。');
      throw new Error(`小雅暂未提供此资源（代码 ${String(json.code ?? '未知').slice(0,20)}）。`);
    }
    if (action === 'file') return {ok:true, data:{url:json.data?.url,is_encryption:json.data?.is_encryption,size:json.data?.size}};
    const all = Array.isArray(json.data) ? json.data : Object.values(json.data || {});
    // Field allowlist: no user profiles, messages, answers, or access tokens.
    const nodes = all.filter(x=>x && typeof x==='object' && Number(x.del)!==2).map(x=>({id:x.id,name:x.name,quote_id:x.quote_id,
      mimetype:x.mimetype,type:x.type,path:x.path,parent_id:x.parent_id,sort_position:x.sort_position,size:x.size,
      task_id:x.task_id,task_type:x.task_type}));
    const title = courseTitle || nodes.find(x=>String(x.id)===current)?.name || '小雅课程';
    return {ok:true,data:{title,breadcrumbs,nodes}};
  } catch (error) {
    const message = error.name === 'TimeoutError' ? '小雅响应超时，请重试。' :
      error instanceof TypeError ? '无法连接小雅接口，请检查登录状态和网络。' : error.message;
    return {ok:false,error:message};
  }
}
