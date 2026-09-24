function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

export function renderDiscussionHtml(data) {
  const title=String(data.title||'课程讨论').trim()||'课程讨论';
  const metadata=Array.isArray(data.metadata)?data.metadata.filter(Boolean):[];
  const rows=metadata.map(item=>`<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join('');
  const description=String(data.description||'').trim();
  const content=String(data.content||'').trim();
  const body=[description&&`<section><h2>主题说明</h2><p>${escapeHtml(description)}</p></section>`,
    content&&`<section><h2>讨论主题</h2><p>${escapeHtml(content)}</p></section>`].filter(Boolean).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - 讨论主题</title>
<style>:root{color-scheme:light;font-family:"Microsoft YaHei",Arial,sans-serif;color:#20322f;background:#f5f7f5}*{box-sizing:border-box}body{max-width:960px;margin:0 auto;padding:36px 24px;line-height:1.7}header{padding:0 0 22px;border-bottom:2px solid #177366;margin-bottom:24px}h1{font-size:28px;line-height:1.3;margin:0 0 16px}.metadata{display:flex;flex-wrap:wrap;gap:8px 24px;margin:0;color:#52615e}.metadata div{display:flex;gap:6px}.metadata dt{font-weight:600}.metadata dd{margin:0}section{background:#fff;border:1px solid #dce5e1;border-radius:10px;padding:20px 22px;margin:16px 0;break-inside:avoid}h2{font-size:18px;margin:0 0 10px}p{white-space:pre-wrap;margin:0}footer{color:#75827e;font-size:12px;margin-top:28px}@media print{body{max-width:none;background:#fff;padding:0}header,section{break-inside:avoid}section{box-shadow:none;margin:10px 0;padding:14px 16px}}</style></head>
<body><header><h1>${escapeHtml(title)}</h1><dl class="metadata">${rows}</dl></header><main>${body||'<section><p>已保存讨论主题信息；小雅当前未返回主题说明正文。</p></section>'}</main><footer>由小雅课件下载扩展从课程讨论资源生成；只保存主题信息，不包含同学发言或评论。</footer></body></html>`;
}
