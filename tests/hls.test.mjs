import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseHlsVariant,parseHlsPlaylist} from '../extension/hls.js';

const base='https://media.example.edu/course/master.m3u8';

test('parses a finite MPEG-TS VOD playlist and advances media sequence numbers',()=>{
  const playlist=parseHlsPlaylist(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:41
#EXTINF:5.0,
segments/41.ts
#EXTINF:5.0,
segments/42.ts
#EXT-X-ENDLIST
`,base);
  assert.equal(playlist.kind,'media');
  assert.equal(playlist.container,'ts');
  assert.deepEqual(playlist.segments.map(segment=>segment.url),[
    'https://media.example.edu/course/segments/41.ts','https://media.example.edu/course/segments/42.ts'
  ]);
  assert.equal(playlist.segments[0].sequence,41n);
  assert.equal(playlist.segments[1].sequence,42n);
});

test('chooses the highest-bandwidth variant that includes its audio',()=>{
  const master=parseHlsPlaylist(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="external",NAME="audio",URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1200000,AUDIO="external"
video-only.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1.4d401f,mp4a.40.2"
combined.m3u8
`,base);
  assert.equal(master.kind,'master');
  assert.equal(chooseHlsVariant(master),'https://media.example.edu/course/combined.m3u8');
});

test('parses encrypted segments, explicit IVs, init maps, and byte ranges',()=>{
  const playlist=parseHlsPlaylist(`#EXTM3U
#EXT-X-MEDIA-SEQUENCE:9
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1
#EXT-X-MAP:URI="init.mp4",BYTERANGE="120@0"
#EXT-X-BYTERANGE:100@120
media.mp4
#EXT-X-BYTERANGE:100
media.mp4
#EXT-X-ENDLIST
`,base);
  assert.equal(playlist.container,'mp4');
  assert.deepEqual(playlist.map.range,{start:0,length:120});
  assert.deepEqual(playlist.segments.map(segment=>segment.range),[
    {start:120,length:100},{start:220,length:100}
  ]);
  assert.equal(playlist.segments[0].key.url,'https://media.example.edu/course/key.bin');
  assert.deepEqual([...playlist.segments[0].key.iv.slice(-2)],[0,1]);
  assert.deepEqual([...playlist.map.key.iv.slice(-2)],[0,1]);
});

test('tracks changing fMP4 initialization maps and rejects fragments with no init map',()=>{
  const playlist=parseHlsPlaylist(`#EXTM3U
#EXT-X-MAP:URI="init-a.mp4"
#EXTINF:4,
part-a.m4s
#EXT-X-MAP:URI="init-b.mp4"
#EXTINF:4,
part-b.m4s
#EXT-X-ENDLIST
`,base);
  assert.equal(playlist.container,'mp4');
  assert.equal(playlist.segments[0].map.url,'https://media.example.edu/course/init-a.mp4');
  assert.equal(playlist.segments[1].map.url,'https://media.example.edu/course/init-b.mp4');
  assert.throws(()=>parseHlsPlaylist('#EXTM3U\n#EXTINF:4,\npart.m4s\n#EXT-X-ENDLIST\n',base),/初始化片段/);
});

test('uses the media sequence as the default AES-128 IV and supports key rotation off',()=>{
  const playlist=parseHlsPlaylist(`#EXTM3U
#EXT-X-MEDIA-SEQUENCE:15
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:4,
one.ts
#EXT-X-KEY:METHOD=NONE
#EXTINF:4,
two.ts
#EXT-X-ENDLIST
`,base);
  assert.equal(playlist.segments[0].key.iv[15],15);
  assert.equal(playlist.segments[1].key,null);
});

test('rejects live playlists and unsupported encryption rather than saving a partial video',()=>{
  assert.throws(()=>parseHlsPlaylist('#EXTM3U\n#EXTINF:4,\none.ts\n',base),/尚未结束/);
  assert.throws(()=>parseHlsPlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"\n#EXTINF:4,\none.ts\n#EXT-X-ENDLIST\n',base),/不支持的加密方式/);
});

test('rejects master playlists requiring a separate external audio track',()=>{
  const master=parseHlsPlaylist(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="external",NAME="audio",URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="external"
video-only.m3u8
`,base);
  assert.throws(()=>chooseHlsVariant(master),/分离音轨/);
});
