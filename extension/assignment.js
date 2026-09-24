function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function renderChoice(choice) {
  const selected = choice.selected ? ' selected' : '';
  const marker = choice.selected ? '<strong class="answer-marker">✓ 我的选择</strong>' : '';
  return `<li class="choice${selected}"><span class="choice-label">${escapeHtml(choice.label)}</span><span>${escapeHtml(choice.text)}</span>${marker}</li>`;
}

export function renderAssignmentHtml(data) {
  const title = String(data.assignmentTitle || '作业答卷').trim() || '作业答卷';
  const metadata = Array.isArray(data.metadata) ? data.metadata.filter(Boolean) : [];
  const questions = Array.isArray(data.questions) ? data.questions : [];
  const isPaper = data.exportMode === 'paper';
  const sections = questions.map((question,index) => {
    const questionTitle = question.number ? `第 ${question.number} 题` : `第 ${index+1} 题`;
    const score = [question.kind, question.earned].filter(Boolean).join(' · ');
    const choices = Array.isArray(question.choices) ? question.choices : [];
    const answers = Array.isArray(question.answers) ? question.answers : [];
    const choiceList = choices.length ? `<ol class="choices">${choices.map(renderChoice).join('')}</ol>` : '';
    const answerBlock = answers.length ? `<div class="answer"><strong>我的作答</strong><div>${answers.map(value=>`<p>${escapeHtml(value)}</p>`).join('')}</div></div>` : '';
    const noAnswer = !isPaper && !choices.some(choice=>choice.selected) && !answers.length && !question.order?.length ? '<p class="no-answer">未检测到已保存的作答内容</p>' : '';
    const order = Array.isArray(question.order) && question.order.length
      ? `<div class="answer"><strong>我的排序</strong><ol>${question.order.map(value=>`<li>${escapeHtml(value)}</li>`).join('')}</ol></div>` : '';
    return `<section class="question"><div class="question-heading"><h2>${escapeHtml(questionTitle)}</h2><span>${escapeHtml(score)}</span></div><div class="prompt">${escapeHtml(question.prompt || '')}</div>${choiceList}${answerBlock}${order}${noAnswer}</section>`;
  }).join('\n');
  const meta = metadata.length ? `<dl class="metadata">${metadata.map(item=>`<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join('')}</dl>` : '';
  const documentType = isPaper ? '作业题目' : '作业答卷';
  const footer = isPaper
    ? '由小雅课件下载扩展从课程作业资源生成；仅包含题目与选项，不包含未在当前页面显示的个人答案或成绩。'
    : `由小雅课件下载扩展从当前已打开的${escapeHtml(data.pageState || '作业页面')}生成；仅包含页面上可见的题目、个人作答与成绩。`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - ${documentType}</title>
<style>
:root{color-scheme:light;font-family:"Microsoft YaHei",Arial,sans-serif;color:#20322f;background:#f5f7f5}*{box-sizing:border-box}body{max-width:960px;margin:0 auto;padding:36px 24px;line-height:1.7}header{padding:0 0 22px;border-bottom:2px solid #177366;margin-bottom:24px}h1{font-size:28px;line-height:1.3;margin:0 0 16px}.metadata{display:flex;flex-wrap:wrap;gap:8px 24px;margin:0;color:#52615e}.metadata div{display:flex;gap:6px}.metadata dt{font-weight:600}.metadata dd{margin:0}.question{background:#fff;border:1px solid #dce5e1;border-radius:10px;padding:20px 22px;margin:16px 0;break-inside:avoid}.question-heading{display:flex;justify-content:space-between;gap:16px;align-items:baseline;border-bottom:1px solid #edf0ee;padding-bottom:10px;margin-bottom:12px}.question-heading h2{font-size:18px;margin:0}.question-heading span{color:#63736e;white-space:nowrap}.prompt{white-space:pre-wrap;font-weight:600;margin-bottom:12px}.choices{padding-left:25px}.choice{padding:5px 8px;border-radius:5px}.choice.selected{background:#e9f5f1;color:#126b5d}.choice-label{font-weight:700;margin-right:8px}.answer-marker{display:inline-block;margin-left:10px;color:#126b5d;font-size:13px}.answer{display:flex;gap:12px;align-items:flex-start;margin-top:12px;padding:12px;background:#f6f8f7;border-radius:6px}.answer>strong{white-space:nowrap}.answer p{margin:0 0 4px;white-space:pre-wrap}.answer ol{margin:0;padding-left:24px}.no-answer{color:#737f7b;font-style:italic}footer{color:#75827e;font-size:12px;margin-top:28px}@media print{body{max-width:none;background:#fff;padding:0}header,.question{break-inside:avoid}.question{box-shadow:none;margin:10px 0;padding:14px 16px}a{color:inherit}}
</style></head><body><header><h1>${escapeHtml(title)} · ${documentType}</h1>${meta}</header><main>${sections || '<p>页面中没有读取到题目。</p>'}</main><footer>${footer}</footer></body></html>`;
}
