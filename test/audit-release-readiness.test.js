const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');
const S = require('../scripts/safari-resources.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const resources = path.join(root, 'safari/Glaze/Glaze Extension/Resources');

// This checks the direct-development project. Release staging has separate passing coverage.
test('GZ-05: a direct Xcode resource bundle has the canonical extension version', () => {
  for (const [target, files] of Object.entries(S.bundled())) {
    assert.ok(files.has('manifest.json'), `${target} must bundle its manifest`);
  }
  const direct = JSON.parse(fs.readFileSync(path.join(resources, 'manifest.json'), 'utf8'));
  assert.equal(direct.version, manifest.version,
    'the checked-in project currently bundles old resources unless a release staging script is used');
});

test('GZ-05: direct Xcode resources include the current eager entry points', () => {
  const eager = [...new Set(manifest.content_scripts.flatMap((s) => [...(s.js || []), ...(s.css || [])]))];
  const missing = eager.filter((file) => !fs.existsSync(path.join(resources, file)));
  assert.deepEqual(missing, [], 'direct development builds must not silently omit current extension entry points');
});

// Only the executed run bodies count; action names and YAML comments cannot satisfy validation.
const jobs = (yaml) => {
  const out = new Map();
  let active = false, job;
  for (const line of yaml.split('\n')) {
    if (/^jobs:\s*$/.test(line)) { active = true; continue; }
    if (!active) continue;
    const m = line.match(/^  ([\w-]+):\s*$/);
    if (m) { job = []; out.set(m[1], job); }
    else if (job) job.push(line);
  }
  return new Map([...out].map(([name, lines]) => [name, lines.join('\n')]));
};
const runs = (body) => {
  const lines = body.split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)run:\s*(.*)$/);
    if (!m) continue;
    let command = m[2];
    if (/^[|>]/.test(command)) {
      command = '';
      for (; i + 1 < lines.length && lines[i + 1].search(/\S/) > m[1].length; i++) command += '\n' + lines[i + 1].trim();
    }
    out.push(command.replace(/^\s*#.*$/gm, ''));
  }
  return out.join('\n');
};

test('GZ-06: tag packaging is gated on the existing suite before attaching its artifact', () => {
  const workflow = jobs(read('.github/workflows/package.yml'));
  const packaging = [...workflow].find(([, body]) => /package\.sh/.test(runs(body)));
  assert.ok(packaging, 'locate the job that actually builds the artifact');
  const [, body] = packaging, commands = runs(body);
  const ownGate = commands.indexOf('node --test') >= 0 && commands.indexOf('node --test') < commands.indexOf('package.sh');
  const needs = (body.match(/^    needs:\s*(.+)$/m)?.[1] || '').replace(/[\[\]'"\s]/g, '').split(',');
  const dependencyGate = needs.some((name) => /\bnode\s+--test\b/.test(runs(workflow.get(name) || '')));
  assert.ok(ownGate || dependencyGate, 'a separate independently triggered test workflow does not gate this artifact job');
});

test('GZ-06: the packaging job pins the runtime used by the validation workflow', () => {
  const validationVersion = read('.github/workflows/test.yml').match(/node-version:\s*([^\n#]+)/)?.[1].trim();
  const workflow = jobs(read('.github/workflows/package.yml'));
  const [, body] = [...workflow].find(([, b]) => /package\.sh/.test(runs(b)));
  assert.match(body, /uses:\s*actions\/setup-node@/, 'the packaging runtime must be selected explicitly');
  assert.equal(body.match(/node-version:\s*([^\n#]+)/)?.[1].trim(), validationVersion);
});

const firefoxFixture = (branch, check) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-audit-firefox-'));
  try {
    const seed = path.join(dir, 'seed'), scripts = path.join(dir, 'scripts');
    fs.mkdirSync(path.join(seed, 'lib'), { recursive: true }); fs.mkdirSync(scripts);
    fs.writeFileSync(path.join(seed, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(seed, 'lib/background.js'), '// offline fixture\n');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    fs.copyFileSync(path.join(root, 'scripts/package-firefox.sh'), path.join(scripts, 'package-firefox.sh'));
    const zip = path.join(dir, 'input.zip'), marker = path.join(dir, 'packager-called');
    execFileSync('zip', ['-qr', zip, '.'], { cwd: seed });
    fs.writeFileSync(path.join(dir, 'package.sh'), '#!/bin/sh\nset -eu\nmkdir -p "$DIST"\nprintf called > "$GZ_AUDIT_PACKAGER_MARKER"\ncp "$GZ_AUDIT_CHROME_ZIP" "$DIST/glaze-v' + manifest.version + '.zip"\n', { mode: 0o755 });
    const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' });
    git('init', '--initial-branch=' + branch);
    git('add', 'manifest.json', 'package.sh', 'scripts/package-firefox.sh');
    git('-c', 'user.name=Glaze fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Create offline packaging fixture');
    const dist = path.join(dir, 'dist');
    const result = spawnSync('sh', ['scripts/package-firefox.sh'], { cwd: dir, encoding: 'utf8',
      env: { ...process.env, DIST: dist, GZ_AUDIT_CHROME_ZIP: zip, GZ_AUDIT_PACKAGER_MARKER: marker } });
    check({ result, called: fs.existsSync(marker), artifact: path.join(dist, `glaze-v${manifest.version}-firefox.zip`) });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('GZ-06: Firefox packaging rejects main before invoking the package builder', () => {
  firefoxFixture('main', ({ result, called }) => {
    assert.ifError(result.error);
    assert.equal(called, false, 'main is not the permanent Firefox compatibility source required by RELEASING.md');
    assert.notEqual(result.status, 0, 'wrong-source packaging must stop before making an upload ZIP');
  });
});

test('GZ-06 control: the permanent Firefox branch can still package an offline fixture', () => {
  firefoxFixture('dev/firefox', ({ result, called, artifact }) => {
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(called, true);
    assert.ok(fs.existsSync(artifact));
    execFileSync('unzip', ['-tq', artifact], { stdio: 'pipe' });
  });
});
