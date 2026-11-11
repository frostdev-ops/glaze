// The share relay's image: the Node major CI tests on, pinned by digest so a moved tag can't change what runs on the
// server, with a health check on the relay's own /health so Docker can tell a hung relay from a running one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const dockerfile = read('server/Dockerfile');
const instructions = dockerfile.replace(/\\\n/g, ' ').split('\n').filter((line) => line.trim() && !line.startsWith('#'));

test('the base image is the Node major CI uses, pinned by digest', () => {
  const major = read('.github/workflows/test.yml').match(/node-version:\s*(\d+)\s*$/m)[1];
  const from = instructions.filter((line) => /^FROM\s/.test(line));
  assert.equal(from.length, 1);
  assert.match(from[0], new RegExp(`^FROM node:${major}-alpine@sha256:[0-9a-f]{64}$`), from[0]);
});

test('the Dockerfile says how to move the pin', () => {
  assert.match(dockerfile, /docker buildx imagetools inspect node:26-alpine/);
});

test('a health check asks the relay\'s /health on the port it listens on', () => {
  const check = instructions.find((line) => /^HEALTHCHECK\s/.test(line));
  assert.ok(check, 'HEALTHCHECK is missing');
  assert.match(check, /--interval=\S+/);
  assert.match(check, /--timeout=\S+/);
  assert.match(check, /\/health/);
  assert.match(check, /process\.env\.PORT/, 'follows the PORT the relay is started with');
  assert.match(read('server/relay.js'), /url\.pathname === '\/health'/, 'the relay answers it');
});
