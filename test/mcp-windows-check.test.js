// Refusal is exercised before any real filesystem or registry operation, even on a Windows developer machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const script = path.join(__dirname, '../scripts/mcp-windows-check.js');

test('the Windows native-host check requires CI or explicit registry consent, including in dry mode', () => {
  const probe = `
    const fs = require('node:fs');
    Object.defineProperty(process, 'platform', { value: process.argv[1] });
    delete process.env.CI;
    if (process.argv[2]) process.env.CI = process.argv[2];
    const flag = process.argv[3];
    process.argv = [process.execPath, ${JSON.stringify(script)}, '/unused-evidence', '--dry', flag];
    fs.mkdirSync = fs.mkdtempSync = () => { throw Error('SIDE EFFECT BEFORE CI GUARD'); };
    require(${JSON.stringify(script)});
  `;
  for (const [platform, ci, flag, allowed] of [
    ['win32', '', '', false], ['win32', 'false', '', false], ['win32', '0', '', false],
    ['win32', 'true', '', true], ['win32', '1', '', true], ['win32', '', '--allow-registry', true],
    ['linux', '', '', true], ['darwin', '', '', true],
  ]) {
    const r = spawnSync(process.execPath, ['-e', probe, platform, ci, flag], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, allowed ? /SIDE EFFECT BEFORE CI GUARD/ : /refusing.*HKCU.*CI.*--allow-registry/i, `${platform}, CI=${ci}, ${flag}: ${r.stderr}`);
    if (!allowed) assert.doesNotMatch(r.stderr, /SIDE EFFECT BEFORE CI GUARD/);
  }
});
