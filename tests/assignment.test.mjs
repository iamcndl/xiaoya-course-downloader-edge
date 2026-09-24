import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAssignmentHtml} from '../extension/assignment.js';

test('renders an offline answer sheet with selected choices, written answers, and grades',()=>{
  const html=renderAssignmentHtml({assignmentTitle:'第一章作业',metadata:[
    {label:'答题人',value:'学生甲'},{label:'最终成绩',value:'45.83'}
  ],questions:[
    {number:'1',prompt:'选择题题干',kind:'单选题 2分',earned:'得分：2',choices:[
      {label:'A',text:'我的答案',selected:true},{label:'B',text:'其他选项',selected:false}
    ]},
    {number:'2',prompt:'填空题题干',kind:'填空题 2分',earned:'得分：1',answers:['填空1: 示例答案']}
  ]});
  assert.match(html,/<title>第一章作业 - 作业答卷<\/title>/);
  assert.match(html,/45\.83/);
  assert.match(html,/✓ 我的选择/);
  assert.match(html,/填空1: 示例答案/);
  assert.match(html,/得分：2/);
  assert.doesNotMatch(html,/<script\b/i);
});

test('escapes assignment text before putting it in the exported document',()=>{
  const html=renderAssignmentHtml({assignmentTitle:'<img src=x onerror=alert(1)>',questions:[
    {number:'1',prompt:'<script>alert(1)</script>',choices:[{label:'A',text:'<b>答案</b>',selected:true}]}
  ]});
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html,/<script\b|<img\b|<b>答案/i);
});

test('renders a paper-only export without implying an answer was missed',()=>{
  const html=renderAssignmentHtml({assignmentTitle:'课后作业',exportMode:'paper',metadata:[
    {label:'导出范围',value:'题目与选项'}
  ],questions:[{number:'1',prompt:'题目内容',kind:'单选题 · 2 分',choices:[
    {label:'A',text:'选项',selected:false}
  ]}]});
  assert.match(html,/<title>课后作业 - 作业题目<\/title>/);
  assert.match(html,/仅包含题目与选项/);
  assert.doesNotMatch(html,/未检测到已保存的作答内容/);
});
