import test from 'node:test';
import assert from 'node:assert/strict';
import {renderDiscussionHtml} from '../extension/discussion.js';

test('renders an offline discussion topic and states that participant posts are omitted',()=>{
  const html=renderDiscussionHtml({title:'课堂讨论',description:'请结合课堂内容进行讨论。',content:'示例主题内容',metadata:[
    {label:'导出范围',value:'讨论主题与说明'},{label:'讨论内容',value:'不包含同学发言和评论'}
  ]});
  assert.match(html,/<title>课堂讨论 - 讨论主题<\/title>/);
  assert.match(html,/请结合课堂内容进行讨论。/);
  assert.match(html,/示例主题内容/);
  assert.match(html,/不包含同学发言和评论/);
});

test('escapes topic content instead of executing markup',()=>{
  const html=renderDiscussionHtml({title:'<img src=x>',content:'<script>alert(1)</script>'});
  assert.match(html,/&lt;img src=x&gt;/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script\b|<img\b/i);
});
