const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const resources = path.join(root, 'safari/Glaze/Glaze Extension/Resources');
const project = fs.readFileSync(path.join(root, 'safari/Glaze/Glaze.xcodeproj/project.pbxproj'), 'utf8');

test('GZ-05: both direct extension targets execute the freshness check before copying resources', () => {
  for (const target of ['Glaze Extension', 'Glaze iOS Extension']) {
    const body = [...project.matchAll(/^\t\t(\w+) \/\* (.*?) \*\/ = \{\n([\s\S]*?)^\t\t\};/gm)]
      .find(([, , name, b]) => name === target && b.includes('isa = PBXNativeTarget;'))?.[3];
    assert.ok(body, target);
    const phases = [...body.match(/buildPhases = \(([\s\S]*?)\);/)[1].matchAll(/\b(\w{24})\b/g)].map((m) => m[1]);
    const phaseBodies = phases.map((id) => project.match(new RegExp(`^\\t\\t${id} /\\* .*? \\*/ = \\{\\n([\\s\\S]*?)^\\t\\t\\};`, 'm'))[1]);
    const check = phaseBodies.findIndex((b) => /sync-safari-resources\.sh/.test(b));
    assert.ok(check >= 0 && check < phaseBodies.findIndex((b) => /isa = PBXResourcesBuildPhase;/.test(b)), target);
    const script = JSON.parse(phaseBodies[check].match(/shellScript = ("(?:\\.|[^"\\])*");/)[1]);
    const result = spawnSync('bash', ['-c', script], { cwd: root, encoding: 'utf8', env: { ...process.env, SRCROOT: path.join(root, 'safari/Glaze') } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /match all \d+ current Safari package files/);
  }
});

test('GZ-05: freshness validation rejects changed, missing and obsolete generated files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-stale-safari-'));
  try {
    fs.cpSync(resources, dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'content-ultra.js'), '\n// stale generated script\n');
    fs.rmSync(path.join(dir, 'lib/nav.js'));
    fs.writeFileSync(path.join(dir, 'obsolete.js'), '// no longer shipped\n');
    const result = spawnSync('bash', ['scripts/sync-safari-resources.sh', '--check', dir], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    for (const file of ['content-ultra.js', 'lib/nav.js', 'obsolete.js']) assert.ok(result.stderr.includes(file), file);
    assert.match(result.stderr, /resources are stale.*--refresh/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
