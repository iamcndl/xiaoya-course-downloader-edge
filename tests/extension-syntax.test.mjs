import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const extensionDir=fileURLToPath(new URL('../extension/',import.meta.url));

test('all packaged extension scripts parse before they are loaded by Edge',async()=>{
  const files=(await readdir(extensionDir)).filter(name=>name.endsWith('.js'));
  assert.ok(files.includes('app.js'));
  for(const file of files)
    execFileSync(process.execPath,['--check',fileURLToPath(new URL(`../extension/${file}`,import.meta.url))],{stdio:'pipe'});
});
