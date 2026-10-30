// CI supply chain: every action is pinned to a full commit SHA, checkout keeps no token, and only the job that attaches
// the release can write (and that job runs no repository code). Line-based on purpose: there is no YAML library to install.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '../.github/workflows');
const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

// The jobs of a workflow as { name, lines }, and a job's steps as arrays of lines (a step starts at "      - ").
const jobsOf = (yaml) => {
  const out = [];
  let inJobs = false, job;
  for (const line of yaml.split('\n')) {
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (!inJobs) continue;
    const m = line.match(/^  ([\w-]+):\s*$/);
    if (m) { job = { name: m[1], lines: [] }; out.push(job); } else if (job) job.lines.push(line);
  }
  return out;
};
const stepsOf = (job) => {
  const steps = [];
  for (const line of job.lines) {
    if (/^      - /.test(line)) steps.push([line]); else if (steps.length) steps.at(-1).push(line);
  }
  return steps;
};
const uses = (yaml) => [...yaml.matchAll(/^\s*(?:- )?uses:\s*(\S+)(?:[ \t]+#[ \t]*(.*))?$/gm)].map((m) => ({ ref: m[1], comment: m[2] || '' }));
// The permission lines that grant write access, from a block that starts at "permissions:".
const writes = (lines) => lines.filter((l) => /^\s+[\w-]+:\s*write\s*$/.test(l) || /write-all/.test(l));

test('there are workflows to check', () => {
  assert.ok(files.includes('package.yml') && files.includes('test.yml'), files.join(', '));
});

test('every action is pinned to a full 40-hex commit SHA, with its version in a comment', () => {
  let count = 0;
  for (const f of files) {
    for (const { ref, comment } of uses(read(f))) {
      if (ref.startsWith('./')) continue; // a local action is the repository's own code
      count++;
      assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${f}: ${ref} is not pinned by commit SHA`);
      assert.match(comment, /^v\d+(\.\d+){1,2}\b/, `${f}: ${ref} needs a "# vX.Y.Z" comment naming the tag it was resolved from`);
    }
  }
  assert.ok(count >= 5, `expected the checkout, setup-node, artifact and release actions, found ${count}`);
});

test('no action is referenced through a Docker tag or a branch', () => {
  for (const f of files) assert.doesNotMatch(read(f), /uses:\s*docker:\/\//, f);
});

test('checkout does not persist its token in the working tree', () => {
  let count = 0;
  for (const f of files) {
    for (const job of jobsOf(read(f))) {
      for (const step of stepsOf(job).filter((s) => /uses:\s*actions\/checkout@/.test(s.join('\n')))) {
        count++;
        assert.match(step.join('\n'), /^\s+persist-credentials:\s*false\s*$/m, `${f} job ${job.name}`);
      }
    }
  }
  assert.ok(count >= 2, `found ${count} checkouts`);
});

test('every job states its permissions, and no workflow grants write access to all of them', () => {
  for (const f of files) {
    const yaml = read(f), top = yaml.split(/^jobs:/m)[0];
    assert.deepEqual(writes(top.split('\n')), [], `${f}: workflow-level write permission applies to every job`);
    assert.match(top, /^permissions:/m, `${f}: set a workflow-level default (read-only or empty)`);
    for (const job of jobsOf(yaml)) {
      const block = job.lines.join('\n');
      assert.match(block, /^    permissions:/m, `${f}: job ${job.name} should state its own permissions`);
    }
  }
});

test('a job that can write runs no repository code', () => {
  let writers = 0;
  for (const f of files) {
    for (const job of jobsOf(read(f))) {
      if (!writes(job.lines).length) continue;
      writers++;
      const block = job.lines.join('\n');
      assert.doesNotMatch(block, /^\s*(?:- )?run:/m, `${f}: ${job.name} has write access and runs a shell step`);
      assert.doesNotMatch(block, /actions\/checkout@/, `${f}: ${job.name} has write access and checks the repository out`);
      assert.match(block, /^    needs:/m, `${f}: ${job.name} should wait for the job that built and tested the artifact`);
    }
  }
  assert.equal(writers, 1, 'exactly one job (the release attach) may write');
});

test('the packaging job still validates the tag and runs the suite before it builds', () => {
  const job = jobsOf(read('package.yml')).find((j) => /package\.sh/.test(j.lines.join('\n')));
  assert.ok(job, 'the job that builds the zip');
  const runs = job.lines.filter((l) => /^\s+run:/.test(l)).join('\n');
  assert.ok(runs.indexOf('node --test') > 0 && runs.indexOf('node --test') < runs.indexOf('package.sh'));
  assert.match(job.lines.join('\n'), /^      contents: read\s*$/m);
});

test('the release job attaches the zip built by the tested job and creates a draft', () => {
  const [release] = jobsOf(read('package.yml')).filter((j) => writes(j.lines).length);
  const block = release.lines.join('\n');
  assert.match(block, /actions\/download-artifact@/);
  assert.match(block, /softprops\/action-gh-release@/);
  assert.match(block, /^\s+draft:\s*true\s*$/m);
  assert.match(block, /^\s+files:\s*dist\/\*\.zip\s*$/m);
  const upload = jobsOf(read('package.yml')).flatMap(stepsOf).map((s) => s.join('\n')).find((s) => /upload-artifact@/.test(s));
  assert.match(upload, /^\s+name:\s*(\S+)\s*$/m);
  assert.equal(upload.match(/^\s+name:\s*(\S+)\s*$/m)[1], block.match(/^\s+name:\s*(\S+)\s*$/m)[1], 'uploaded and downloaded under one name');
});

// ---- the browser gate (browser.yml), called by test.yml on non-release pushes and pull requests and by package.yml before the zip ----
const browser = () => jobsOf(read('browser.yml'));
const runsOf = (job) => job.lines.join('\n').replace(/^\s*#.*$/gm, '');
const callers = (f) => jobsOf(read(f)).filter((j) => /^    uses:\s*\.\/\.github\/workflows\/browser\.yml\s*$/m.test(j.lines.join('\n')));

test('the browser gate runs only when called, on non-release pushes and pull requests', () => {
  const yaml = read('browser.yml'), on = yaml.split(/^jobs:/m)[0];
  assert.match(on, /^on:\s*\n  workflow_call:\s*$/m);
  assert.doesNotMatch(on, /^  (push|pull_request|schedule|workflow_dispatch):/m);
  const test = read('test.yml').split(/^jobs:/m)[0];
  assert.match(test, /^  push:/m);
  assert.match(test, /^  pull_request:/m);
  assert.equal(callers('test.yml').length, 1, 'test.yml calls the gate');
});

test('a release zip is built only after the browser gate passes', () => {
  const [gate] = callers('package.yml');
  assert.ok(gate, 'package.yml calls the gate');
  const job = jobsOf(read('package.yml')).find((j) => /package\.sh/.test(j.lines.join('\n')));
  const needs = (job.lines.join('\n').match(/^    needs:\s*(.+)$/m)?.[1] || '').replace(/[[\]'"\s]/g, '').split(',');
  assert.ok(needs.includes(gate.name), `the packaging job needs ${gate.name}`);
});

test('the browser job has a pinned runner image and a time limit of 15 minutes or less', () => {
  const [job] = browser(), block = job.lines.join('\n');
  assert.match(block, /^    runs-on:\s*ubuntu-\d+\.\d+\s*$/m, 'a named image, not ubuntu-latest, so its system libraries stay put');
  assert.ok(Number(block.match(/^    timeout-minutes:\s*(\d+)\s*$/m)?.[1]) <= 15);
});

test('the gate installs the pinned Playwright, checks it and its Chromium, and only then runs the checks', () => {
  const [job] = browser(), runs = runsOf(job);
  const version = job.lines.join('\n').match(/^      PLAYWRIGHT:\s*(\d+\.\d+\.\d+)\s*$/m)?.[1];
  assert.ok(version, 'PLAYWRIGHT names an exact version');
  const pins = require('../scripts/npm-integrity.js').parsePins(fs.readFileSync(path.join(__dirname, '../ci/playwright.pins'), 'utf8'));
  assert.ok(pins.has(`playwright@${version}`) && pins.has(`playwright-core@${version}`), 'ci/playwright.pins pins this version');
  const install = runs.match(/npm install[^\n]*/)?.[0] ?? '';
  for (const flag of ['--ignore-scripts', '--no-package-lock', '--registry https://registry.npmjs.org/', '"playwright@$PLAYWRIGHT"']) assert.ok(install.includes(flag), flag);
  assert.doesNotMatch(runs, /\bnpx\b|@latest/);
  const at = (s) => { const i = runs.indexOf(s); assert.ok(i >= 0, s); return i; };
  const order = [at('npm install'), at('scripts/npm-integrity.js "$RUNNER_TEMP/playwright/node_modules/.package-lock.json" ci/playwright.pins playwright playwright-core'),
    at('.bin/playwright" install --with-deps --no-shell chromium'), at('node scripts/ci-chromium.js'), at('node scripts/ci-browser-checks.js')];
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'install, verify, install Chromium, verify, run');
});

test('the gate keeps its logs and screenshots when it fails', () => {
  const [job] = browser(), steps = stepsOf(job).map((s) => s.join('\n'));
  const out = runsOf(job).match(/ci-browser-checks\.js "\$RUNNER_TEMP\/([\w-]+)"/)?.[1];
  assert.ok(out, 'the checks write to a directory under the runner temp');
  const upload = steps.find((s) => /upload-artifact@/.test(s));
  assert.ok(upload, 'an upload step');
  assert.match(upload, /^\s+if:\s*failure\(\)\s*$/m);
  assert.match(upload, new RegExp(`^\\s+path:\\s*\\$\\{\\{ runner\\.temp \\}\\}/${out}\\s*$`, 'm'));
});

test('the gate runs only checks that need no school, local LMS or network', () => {
  const { CHECKS } = require('../scripts/ci-browser-checks.js');
  assert.deepEqual(CHECKS.map((c) => c.script), ['settings-ia-check.js', 'backup-check.js', 'popup-check.js', 'sites-check.js', 'pointer-check.js', 'register-update-check.js']);
  for (const { script } of CHECKS) {
    const code = fs.readFileSync(path.join(__dirname, '../scripts', script), 'utf8');
    assert.doesNotMatch(code, /localhost:(8081|3000)|127\.0\.0\.1:(8081|3000)/, `${script} reaches a local LMS`);
    assert.match(code, /route\(/, `${script} answers or blocks the page's requests itself`);
  }
});


test('release tags run the browser gate once while other pushes keep their test workflow', () => {
  const trigger = read('test.yml').split(/^jobs:/m)[0];
  assert.match(trigger, /^    tags-ignore: \['v\*'\]$/m);
  assert.doesNotMatch(trigger, /^    (branches|branches-ignore|tags):/m);
  assert.match(read('package.yml'), /^    tags: \['v\*'\]$/m);
});

test('fork checks receive no secrets and release artifacts stay within the gated run', () => {
  for (const f of files) assert.doesNotMatch(read(f), /pull_request_target|workflow_run|secrets:|secrets\./, f);
  const release = jobsOf(read('package.yml')).find((j) => j.name === 'release').lines.join('\n');
  assert.doesNotMatch(release, /run-id:|repository:|github-token:|pattern:|merge-multiple:/);
  assert.match(release, /^          name: chrome-zip$/m);
  for (const job of jobsOf(read('package.yml'))) assert.doesNotMatch(job.lines.join('\n'), /^    if:/m, 'gate dependencies must not be overridden');
  assert.doesNotMatch(read('package.yml').split(/^jobs:/m)[0], /workflow_dispatch|pull_request/);
});
