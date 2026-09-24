function parseAttributes(value) {
  const result = {};
  const pattern = /(?:^|,)\s*([A-Z0-9-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^,]*)/g;
  for (const match of value.matchAll(pattern)) {
    const raw = match[2].trim();
    result[match[1]] = raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1).replace(/\\"/g, '"') : raw;
  }
  return result;
}

function resolveUri(value, baseUrl) {
  try { return new URL(value.trim(), baseUrl).href; }
  catch { throw new Error('视频播放清单包含无效地址。'); }
}

function parseIv(value) {
  const hex = String(value || '').replace(/^0x/i, '');
  if (!/^[\da-f]{1,32}$/i.test(hex)) throw new Error('视频加密参数不受支持。');
  const padded = hex.padStart(32, '0');
  return Uint8Array.from({length:16}, (_, index) => Number.parseInt(padded.slice(index * 2, index * 2 + 2), 16));
}

function sequenceIv(sequence) {
  const iv = new Uint8Array(16);
  let value = sequence;
  for (let index = 15; index >= 0; index--) {
    iv[index] = Number(value & 255n);
    value >>= 8n;
  }
  return iv;
}

function byteRange(value, url, previous, allowImplicitZero = false) {
  const match = String(value || '').match(/^(\d+)(?:@(\d+))?$/);
  if (!match) throw new Error('视频播放清单包含不受支持的分段范围。');
  const length = Number(match[1]);
  const start = match[2] !== undefined ? Number(match[2]) :
    previous?.url === url ? previous.next : allowImplicitZero ? 0 : NaN;
  if (!Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(start) || start < 0)
    throw new Error('视频播放清单包含无效的分段范围。');
  return {start, length, next:start + length};
}

export function chooseHlsVariant(master) {
  const variants = master.variants.filter(variant => !variant.audioGroup || !master.externalAudioGroups.has(variant.audioGroup));
  if (!variants.length) throw new Error('此视频采用分离音轨，当前版本无法合并下载。');
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return variants[0].url;
}

export function parseHlsPlaylist(input, baseUrl) {
  const source = String(input || '').replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines[0] !== '#EXTM3U') throw new Error('小雅返回的内容不是 HLS 视频播放清单。');

  const variants = [];
  const externalAudioGroups = new Set();
  let pendingVariant = null;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-SESSION-KEY:'))
      throw new Error('此视频的主播放清单使用了当前版本不支持的会话密钥。');
    else if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
      if (attrs.TYPE === 'AUDIO' && attrs.URI && attrs['GROUP-ID']) externalAudioGroups.add(attrs['GROUP-ID']);
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pendingVariant = parseAttributes(line.slice(line.indexOf(':') + 1));
    } else if (pendingVariant && !line.startsWith('#')) {
      variants.push({
        url:resolveUri(line, baseUrl),
        bandwidth:Number(pendingVariant.BANDWIDTH) || 0,
        audioGroup:pendingVariant.AUDIO || ''
      });
      pendingVariant = null;
    }
  }
  if (variants.length) return {kind:'master', variants, externalAudioGroups};

  let sequence = 0n;
  let keyState = null;
  let map = null;
  let pendingRange = null;
  let previousRange = null;
  let endList = false;
  const segments = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      const raw = line.slice(line.indexOf(':') + 1);
      if (!/^\d+$/.test(raw)) throw new Error('视频播放清单的分段序号无效。');
      sequence = BigInt(raw);
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
      if (attrs.METHOD === 'NONE') keyState = null;
      else if (attrs.METHOD === 'AES-128' && (!attrs.KEYFORMAT || attrs.KEYFORMAT === 'identity') && attrs.URI) {
        keyState = {url:resolveUri(attrs.URI, baseUrl), explicitIv:attrs.IV ? parseIv(attrs.IV) : null};
      } else throw new Error('视频使用了当前版本不支持的加密方式。');
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line.slice(line.indexOf(':') + 1));
      if (!attrs.URI) throw new Error('视频播放清单缺少初始化分段地址。');
      const url = resolveUri(attrs.URI, baseUrl);
      const parsedRange = attrs.BYTERANGE ? byteRange(attrs.BYTERANGE, url, null, true) : null;
      const range = parsedRange ? {start:parsedRange.start,length:parsedRange.length} : null;
      if (keyState && !keyState.explicitIv) throw new Error('视频初始化分段缺少解密参数。');
      map = {url, range, key:keyState ? {url:keyState.url, iv:keyState.explicitIv} : null};
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = line.slice(line.indexOf(':') + 1);
    } else if (line.startsWith('#EXT-X-SKIP:')) {
      throw new Error('视频播放清单是增量更新片段，无法保证视频完整。');
    } else if (line === '#EXT-X-ENDLIST') {
      endList = true;
    } else if (!line.startsWith('#')) {
      const url = resolveUri(line, baseUrl);
      let range = null;
      if (pendingRange) {
        const parsed = byteRange(pendingRange, url, previousRange);
        range = {start:parsed.start, length:parsed.length};
        previousRange = {url, next:parsed.next};
      } else previousRange = null;
      segments.push({url, range, sequence, map, key:keyState ? {
        url:keyState.url, iv:keyState.explicitIv || sequenceIv(sequence)
      } : null});
      sequence++;
      pendingRange = null;
    }
  }
  if (!endList) throw new Error('视频播放清单尚未结束，无法保证保存完整视频。');
  if (!segments.length) throw new Error('视频播放清单中没有可下载的分段。');
  const maps=segments.map(segment=>segment.map).filter(Boolean);
  const mp4Segments=segments.some(segment => /\.(?:m4s|mp4|cmfv|cmfa)(?:$|[?#])/i.test(segment.url));
  if(mp4Segments&&!maps.length)throw new Error('视频使用分段 MP4，但播放清单未提供初始化片段。');
  return {kind:'media', playlistUrl:baseUrl, map:maps[0]||null, maps, segments, container:maps.length?'mp4':'ts'};
}
