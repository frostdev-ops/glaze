const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../lib/download.js');

test('download URLs permit HTTPS and only the exact scratch development origin', () => {
  assert.equal(D.url('https://files.example/file?token=a%2Fb'), 'https://files.example/file?token=a%2Fb');
  for (const url of ['http://files.example/file', 'https://user:pass@files.example/file', 'javascript:alert(1)', 'https://canvas.example/login', 'https://canvas.example/login/canvas', 'bad']) assert.equal(D.url(url), null);
  assert.equal(D.url('http://localhost:3000/file', 'http://localhost:3000'), 'http://localhost:3000/file');
  assert.equal(D.url('http://localhost:3001/file', 'http://localhost:3000'), null);
  assert.equal(D.url('https://files.example/login-notes.html'), 'https://files.example/login-notes.html');
});
test('only our top-frame course Modules content script can start a download port', () => {
  const s = { id: 'ours', tab: { id: 1 }, frameId: 0, url: 'https://canvas.example/courses/25/modules' };
  assert.equal(D.sender(s, 'ours'), true);
  assert.equal(D.sender({...s,url:'https://canvas.school.edu/courses/25'}, 'ours'), true);
  for (const patch of [{id:'other'}, {tab:null}, {frameId:1}, {url:'https://canvas.example/'}, {url:'bad'}]) assert.equal(D.sender({...s,...patch}, 'ours'), false);
});
test('the byte budget counts actual chunks across files and stops at 250 MiB', () => {
  assert.equal(D.bytes(0, 0), 0);
  assert.equal(D.bytes(D.bytes(0, 100), D.MAX - 100), D.MAX);
  for (const n of [1, -1, NaN, 0.5]) assert.throws(() => D.bytes(D.MAX, n), /limit/);
});
