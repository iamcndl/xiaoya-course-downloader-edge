import test from 'node:test';
import assert from 'node:assert/strict';
import {courseFromUrl,fileType,normalizeResources,safeFileUrl} from '../extension/core.js';

test('recognizes opened Xiaoya answer pages as course tabs',()=>{
  const course=courseFromUrl('https://whut.ai-augmented.com/app/jx-web/course_paper/mycourse/1111111111111111111/2222222222222222222/3333333333333333333/4444444444444444444');
  assert.equal(course.courseId,'1111111111111111111');
  assert.equal(course.kind,'assignment');
  assert.equal(courseFromUrl('https://example.com/app/jx-web/course_paper/mycourse/1111111111111111111'),null);
});

test('rejects insecure, credential-bearing, and local file hosts',()=>{
  for(const value of [
    'http://cdn.example.edu/file.pdf',
    'https://user:password@cdn.example.edu/file.pdf',
    'https://127.0.0.1/file.pdf',
    'https://localhost./file.pdf',
    'https://[::1]/file.pdf',
    'https://printer.internal/file.pdf',
    'https://machine.localhost/file.pdf'
  ])assert.throws(()=>safeFileUrl(value),/不支持的文件地址/);
  assert.equal(safeFileUrl('https://cdn.example.edu/file.pdf?signature=sample'),'https://cdn.example.edu/file.pdf?signature=sample');
});

test('recognizes common Xiaoya video filename and MIME types',()=>{
  assert.equal(fileType('lecture.mp4','application/octet-stream'),'video');
  assert.equal(fileType('lecture.flv',''),'video');
  assert.equal(fileType('lecture','video/mp4'),'video');
  assert.equal(fileType('video.m3u8','application/vnd.apple.mpegurl'),'video');
  assert.equal(fileType('transport.ts','video/mp2t'),'video');
  assert.equal(fileType('source.ts','text/plain'),'other');
});

test('keeps video resource nodes even when they have no ordinary file quote id',()=>{
  const result=normalizeResources([
    {id:'folder',name:'第一章',type:'folder'},
    {id:'video-1',name:'示例视频.mp4',mimetype:'video/mp4',type:'video',parent_id:'folder',size:0},
    {id:'file-1',name:'讲义.pdf',mimetype:'application/pdf',quote_id:'quote-1',parent_id:'folder'}
  ]);
  assert.equal(result.videos,1);
  assert.equal(result.files.length,2);
  assert.equal(result.files.find(file=>file.type==='video').quoteId,'');
  assert.deepEqual(result.files.find(file=>file.type==='video').folders,['第一章']);
});

test('removes the synthetic root and keeps chapter and subfolder ancestry',()=>{
  const result=normalizeResources([
    {id:'root',name:'root',type:1},
    {id:'chapter',name:'示例章节',type:1,parent_id:'root'},
    {id:'video-folder',name:'示例子文件夹',type:1,parent_id:'chapter'},
    {id:'video-1',name:'示例视频.mp4',type:9,parent_id:'video-folder'}
  ]);
  const video=result.files.find(file=>file.id==='video-1');
  assert.deepEqual(video.folders,['示例章节','示例子文件夹']);
  assert.deepEqual(video.folderIds,['chapter','video-folder']);
});

test('maps the current Xiaoya resource node types to video, assignment, and discussion downloads',()=>{
  const result=normalizeResources([
    {id:'chapter',name:'第一章',type:1},
    {id:'v1',name:'示例视频',type:9,parent_id:'chapter',task_id:'task-1'},
    {id:'a1',name:'课后作业',type:7,quote_id:'paper-1',task_id:'task-2',parent_id:'chapter'},
    {id:'d1',name:'课堂讨论',type:8,quote_id:'discussion-1',task_id:'task-3',parent_id:'chapter'},
    {id:'f1',name:'讲义.pdf',type:6,mimetype:'application/pdf',quote_id:'quote-1',parent_id:'chapter'}
  ]);
  assert.equal(result.videos,1);
  assert.equal(result.assignments,1);
  assert.equal(result.discussions,1);
  assert.deepEqual(result.files.map(file=>file.type).sort(),['assignment','discussion','pdf','video']);
  assert.equal(result.files.find(file=>file.id==='a1').taskId,'task-2');
  assert.equal(result.files.find(file=>file.id==='d1').taskId,'task-3');
});
