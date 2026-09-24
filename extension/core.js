export function courseFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !/(^|\.)ai-augmented\.com$/.test(url.hostname)) return null;
    const assignment = url.pathname.match(/^\/app\/jx-web\/course_paper\/mycourse\/(\d{19})(?:\/|$)/);
    const course = url.pathname.match(/^\/app\/jx-web\/mycourse\/(\d{19})(?:\/|$)/);
    const id = assignment?.[1] || course?.[1];
    return id ? {courseId:id, kind:assignment?'assignment':'course', origin:url.origin, url:url.href} : null;
  } catch { return null; }
}

export function sanitizeName(input, fallback = '未命名') {
  let name = String(input || '').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '').replace(/[ .]+$/g, '').trim();
  if (!name || /^\.+$/.test(name)) name = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  if (name.length > 100) {
    const ext = name.match(/\.[a-z0-9]{1,10}$/i)?.[0] || '';
    name = name.slice(0, 100 - ext.length) + ext;
  }
  return name;
}

export function fileType(name, mime = '') {
  const ext = String(name).split('.').pop().toLowerCase();
  const sourceTs=ext==='ts'&&/(typescript|javascript|text\/plain)/i.test(mime);
  if (/^video\//i.test(mime) || (!sourceTs&&/^(mp4|webm|mov|avi|mkv|m3u8|flv|wmv|m4v|mpeg|mpg|3gp|ts|vob|ogv|divx|rm|rmvb|f4v)$/.test(ext))) return 'video';
  if (/^(pptx?|ppsx?|odp)$/.test(ext) || /presentation|powerpoint/i.test(mime)) return 'ppt';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (/^(docx?|rtf|txt|odt)$/.test(ext)) return 'doc';
  if (/^(xlsx?|csv|ods)$/.test(ext)) return 'sheet';
  if (/^image\//.test(mime) || /^(png|jpe?g|gif|webp|svg|bmp|tiff?)$/.test(ext)) return 'image';
  if (/^(zip|rar|7z|tar|gz)$/.test(ext)) return 'archive';
  return 'other';
}

export function normalizeResources(data) {
  const raw = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.values(data) : []);
  const nodes = raw.filter(x => x && typeof x === 'object');
  const byId = new Map(nodes.filter(x => x.id != null).map(x => [String(x.id), x]));
  const folder = node => node && (node.type === 1 || String(node.type) === '1' || String(node.type).toLowerCase() === 'folder') && !node.quote_id;
  const files = []; const seen = new Set(); let videos = 0; let assignments = 0; let discussions = 0;
  for (const node of nodes) {
    if (!node.id || seen.has(String(node.id)) || folder(node) || !node.name) continue;
    const resourceType = String(node.type ?? '').toLowerCase();
    const type = node.type === 9 || resourceType === '9' || resourceType === 'video' ? 'video' :
      node.type === 7 || resourceType === '7' || resourceType === 'survey' || resourceType === 'assignment' ? 'assignment' :
      node.type === 8 || resourceType === '8' || resourceType === 'discuss' || resourceType === 'discussion' ? 'discussion' :
      fileType(node.name, node.mimetype || '');
    if (type !== 'video' && !node.quote_id) continue;
    seen.add(String(node.id));
    if (type === 'video') videos++;
    if (type === 'assignment') assignments++;
    if (type === 'discussion') discussions++;
    let ancestry = [];
    const visited = new Set([String(node.id)]);
    let parent = byId.get(String(node.parent_id));
    while (parent && !visited.has(String(parent.id)) && ancestry.length < 20) {
      visited.add(String(parent.id));
      if (folder(parent)) ancestry.unshift(parent);
      parent = byId.get(String(parent.parent_id));
    }
    if (!ancestry.length && typeof node.path === 'string') {
      ancestry = node.path.split('/').filter(Boolean).map(id => byId.get(id)).filter(folder).slice(0, 20);
    }
    const visibleAncestry=ancestry.filter((parent,index)=>!(index===0&&String(parent.name||'').trim().toLowerCase()==='root'));
    files.push({id:String(node.id), quoteId:String(node.quote_id || ''), taskId:String(node.task_id || node.task?.task_id || ''), name:String(node.name),
      mime:String(node.mimetype || ''), type, size:Math.max(0, Number(node.size) || 0),
      folders:visibleAncestry.map(p => String(p.name || '未命名章节')),
      folderIds:visibleAncestry.map(p => String(p.id)),
      sort:[...ancestry, node].map(n => Number(n.sort_position) || 0)});
  }
  files.sort((a,b) => {
    for (let i=0; i<Math.max(a.sort.length,b.sort.length); i++) {
      const difference = (a.sort[i] || 0) - (b.sort[i] || 0);
      if (difference) return difference;
    }
    return a.name.localeCompare(b.name, 'zh-CN', {numeric:true}) || a.id.localeCompare(b.id);
  });
  return {files, videos, assignments, discussions};
}

export function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}

export function safeFileUrl(value) {
  let url;
  try {url = new URL(value);} catch {throw new Error('文件地址解析失败，请重新准备下载。');}
  const host = url.hostname.toLowerCase().replace(/\.$/,'');
  const localSuffixes=['.localhost','.local','.internal','.intranet','.home','.lan'];
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      host === 'localhost' || localSuffixes.some(suffix=>host.endsWith(suffix)) ||
      host.startsWith('[') || /^[\d.]+$/.test(host) || !host.includes('.')) {
    throw new Error('平台返回了不支持的文件地址。');
  }
  return url.href;
}

export function uniqueCandidate(name, index) {
  if (!index) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0,dot)} (${index+1})${name.slice(dot)}` : `${name} (${index+1})`;
}
