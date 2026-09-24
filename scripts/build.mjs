import {build, transform} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {zipSync, strToU8, zlibSync} from 'fflate';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
await build({entryPoints:['src/vendor-entry.js'],bundle:true,format:'esm',platform:'browser',target:'chrome110',
  outfile:'extension/vendor.js',minify:true,legalComments:'eof'});
await fs.mkdir('extension/licenses',{recursive:true});
await fs.copyFile('node_modules/crypto-js/LICENSE','extension/licenses/crypto-js.txt');
await fs.copyFile('node_modules/fflate/LICENSE','extension/licenses/fflate.txt');

// Small original geometric download glyph; PNG generated without external tools.
function crc32(bytes){let c=-1;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^-1)>>>0;}
function chunk(type,data){const tag=Buffer.from(type);const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);tag.copy(out,4);Buffer.from(data).copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([tag,Buffer.from(data)])),out.length-4);return out;}
await fs.mkdir('extension/icons',{recursive:true});
for(const size of [16,32,48,128]){
  const scan=Buffer.alloc((size*4+1)*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const nx=x/size,ny=y/size;
    const glyph=(nx>.45&&nx<.55&&ny>.2&&ny<.59)||
      (ny>.44&&ny<.69&&Math.abs(nx-.5)<(ny-.42)*.8&&Math.abs(nx-.5)>(ny-.52)*.8)||
      (ny>.73&&ny<.8&&nx>.24&&nx<.76)||
      ((nx>.24&&nx<.3||nx>.7&&nx<.76)&&ny>.65&&ny<.8);
    const i=y*(size*4+1)+1+x*4;scan.set(glyph?[255,255,255,255]:[24,104,91,255],i);
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlibSync(scan)),chunk('IEND',new Uint8Array())]);
  await fs.writeFile(`extension/icons/${size}.png`,png);
}
await fs.mkdir('dist',{recursive:true});
async function collect(dir,prefix=''){const out={};for(const item of await fs.readdir(dir,{withFileTypes:true})){const rel=prefix+item.name;if(item.isDirectory())Object.assign(out,await collect(path.join(dir,item.name),rel+'/'));else out[rel]=new Uint8Array(await fs.readFile(path.join(dir,item.name)));}return out;}
const files=await collect('extension');
const expectedFiles=new Set([
  'app.css','app.html','app.js','assignment.js','background.js','core.js','discussion.js','hls.js',
  'manifest.json','page-api.js','services.js','vendor.js',
  'icons/16.png','icons/32.png','icons/48.png','icons/128.png',
  'licenses/crypto-js.txt','licenses/fflate.txt','licenses/xiaoya-downloader.txt'
]);
const unexpected=Object.keys(files).filter(name=>!expectedFiles.has(name));
const missing=[...expectedFiles].filter(name=>!files[name]);
if(unexpected.length||missing.length)
  throw new Error(`扩展发布文件清单不匹配。意外文件：${unexpected.join(', ')||'无'}；缺少文件：${missing.join(', ')||'无'}`);
for(const[name,data]of Object.entries(files))if(name.endsWith('.js'))
  await transform(new TextDecoder().decode(data),{loader:'js',target:'chrome110',sourcefile:name});
for(const filename of ['manifest.json','app.html','app.css','app.js','services.js','vendor.js'])if(!files[filename])throw new Error('缺少 '+filename);
const manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));
const bundle={};for(const[name,data]of Object.entries(files))bundle['小雅课件下载/'+name]=data;
bundle['安装与使用.txt']=strToU8(await fs.readFile('docs/安装与使用.txt','utf8'));
await fs.writeFile(`dist/小雅课件下载-Edge-v${manifest.version}.zip`,zipSync(bundle,{level:6}));
await fs.writeFile(`dist/小雅课件下载-商店提交-v${manifest.version}.zip`,zipSync(files,{level:6}));
console.log(JSON.stringify({version:manifest.version,files:Object.keys(files).length,packages:await fs.readdir('dist')},null,2));
