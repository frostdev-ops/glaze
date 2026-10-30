const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../extension/lib/download.js');

test('download URLs permit HTTPS and only the exact scratch development origin', () => {
  assert.equal(D.url('https://files.example/file?token=a%2Fb'), 'https://files.example/file?token=a%2Fb');
  for (const url of ['http://files.example/file', 'https://user:pass@files.example/file', 'javascript:alert(1)', 'https://canvas.example/login', 'https://canvas.example/login/canvas', 'bad']) assert.equal(D.url(url), null);
  assert.equal(D.url('http://localhost:3000/file', 'http://localhost:3000'), 'http://localhost:3000/file');
  assert.equal(D.url('http://localhost:3001/file', 'http://localhost:3000'), null);
  assert.equal(D.url('https://files.example/login-notes.html'), 'https://files.example/login-notes.html');
});
test('only our content script on a course Modules page, or in a frame of one on its own site, can start a download port', () => {
  const s = { id: 'ours', tab: { id: 1 }, frameId: 0, url: 'https://canvas.example/courses/25/modules' };
  assert.equal(D.sender(s, 'ours'), true);
  assert.equal(D.sender({...s,url:'https://canvas.school.edu/courses/25'}, 'ours'), true);
  for (const patch of [{id:'other'}, {tab:null}, {url:'https://canvas.example/'}, {url:'bad'}]) assert.equal(D.sender({...s,...patch}, 'ours'), false);
  // A course tab's frame (features/coursetabs.js): the page around it is the same site's, and its own address passes the path check.
  const frame = { ...s, frameId: 3, tab: { id: 1, url: 'https://canvas.example/' } };
  assert.equal(D.sender(frame, 'ours'), true);
  assert.equal(D.sender({ ...frame, url: 'https://canvas.example/courses/25' }, 'ours'), true);
  for (const patch of [{ tab: { id: 1 } }, { tab: { id: 1, url: 'https://canvas.school.edu/' } }, { tab: { id: 1, url: 'bad' } }, { url: 'https://canvas.school.edu/courses/25/modules' },
    { url: 'https://canvas.example/courses/25/settings' }, { frameId: undefined }, { frameId: -1 }, { frameId: 1.5 }, { url: 'about:blank', tab: { id: 1, url: 'about:blank' } }]) assert.equal(D.sender({ ...frame, ...patch }, 'ours'), false, JSON.stringify(patch));
});
test('Open in Glaze reads one file through the same port from a course page that shows or links one, and nowhere else', () => {
  const s = { id: 'ours', tab: { id: 1 }, frameId: 0 };
  for (const p of ['/courses/25/files', '/courses/25/files/21', '/courses/25/files/folder/week%203', '/courses/25/modules/items/272', '/courses/25/pages/week-3', '/courses/25/wiki',
    '/courses/25/assignments/7', '/courses/25/assignments/syllabus', '/courses/25/discussion_topics/9', '/courses/25/announcements'])
    assert.equal(D.sender({ ...s, url: `https://canvas.example${p}?preview=21` }, 'ours'), true, p);
  for (const p of ['/courses/25/settings', '/courses/25/grades', '/courses/25/gradebook', '/courses/25/users', '/files/21', '/courses/25/files/21/download', '/courses/x/files'])
    assert.equal(D.sender({ ...s, url: `https://canvas.example${p}` }, 'ours'), false, p);
});
test('the byte budget counts actual chunks across files and stops at 250 MiB', () => {
  assert.equal(D.bytes(0, 0), 0);
  assert.equal(D.bytes(D.bytes(0, 100), D.MAX - 100), D.MAX);
  for (const n of [1, -1, NaN, 0.5]) assert.throws(() => D.bytes(D.MAX, n), /limit/);
});
