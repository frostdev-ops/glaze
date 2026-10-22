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
