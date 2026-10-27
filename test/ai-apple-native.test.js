// Exercise the native boundary with Swift's interpreter, never an app bundle or an inference request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const nativeFile = path.join(root, 'safari/Glaze/Glaze Extension/GlazeAI.swift');
const flags = ['-swift-version', '5', '-enable-upcoming-feature', 'MemberImportVisibility', '-enable-upcoming-feature', 'NonisolatedNonsendingByDefault', '-enable-upcoming-feature', 'InferIsolatedConformances', '-strict-concurrency=complete'];
const supported = process.platform === 'darwin'
  && Number(spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout?.split('.')[0]) >= 27
  && Number(spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], { encoding: 'utf8' }).stdout?.split('.')[0]) >= 27;
let result, diagnostics;
test.before(() => {
  if (!supported) return;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ai-native-test-'));
  try {
    const source = fs.readFileSync(nativeFile, 'utf8') + `
@available(macOS 27.0, *)
extension Native {
    static func checkSchema(_ schema: [String: Any]) -> Bool {
        do { _ = try GenerationSchema(root: Schema().node(schema, name: "Answer", depth: 0), dependencies: []); return true }
        catch { return false }
    }
}
if #available(macOS 27.0, *) {
    var out: [String: Any] = [:]
    out["unknown"] = Native.failure(NSError(domain: "PRIVATE SYLLABUS TEXT", code: 1046))
    out["refusal"] = Native.failure(LanguageModelError.refusal(.init(explanation: "PRIVATE", debugDescription: "PRIVATE")))
    out["guardrail"] = Native.failure(LanguageModelError.guardrailViolation(.init(debugDescription: "PRIVATE")))
    out["rate"] = Native.failure(LanguageModelError.rateLimited(.init(resetDate: nil, debugDescription: "PRIVATE")))
    out["cancelled"] = Native.failure(CancellationError())
    out["cloud"] = await Native.status(["model": "private-cloud"])
    out["earlyCancel"] = Native.cancel(["id": "cancel-before-registration"])
    out["earlyRun"] = await Native.run(["id": "cancel-before-registration"])
    out["emptyCancel"] = Native.cancel(["id": ""])
    out["release"] = Native.release()
    out["warm"] = Native.warmCount()
    out["nullSchema"] = Native.checkSchema(["type": "object", "properties": ["answer": ["anyOf": [["type": "string"], ["type": "null"]]]], "required": ["answer"]])
    print(String(data: try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]), encoding: .utf8)!)
}
`;
    const file = path.join(temp, 'Native.swift');
    fs.writeFileSync(file, source);
    const run = spawnSync('xcrun', ['swift', ...flags, file], { encoding: 'utf8', timeout: 30000 });
    assert.equal(run.status, 0, run.stderr);
    result = JSON.parse(run.stdout.trim()); diagnostics = run.stderr;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('native errors carry only fixed categories and reasons', { skip: !supported }, () => {
  assert.deepEqual(result.unknown, { ok: false, error: 'provider-unavailable', reason: 'unknown' });
  for (const k of ['refusal', 'guardrail']) assert.equal(result[k].error, 'refusal');
  assert.deepEqual(result.rate, { ok: false, error: 'request-rejected', reason: 'rate', status: 429 });
  assert.deepEqual(result.cancelled, { ok: false, error: 'cancelled' });
});
test('the native side refuses any model but the one on this device', { skip: !supported }, () => {
  assert.deepEqual(result.cloud, { ok: false, error: 'request-rejected', reason: 'model' });
});
test('native cancellation arriving before registration prevents the run', { skip: !supported }, () => {
  assert.deepEqual(result.earlyRun, { ok: false, error: 'cancelled' });
  assert.equal(result.emptyCancel.error, 'request-rejected');
});
test('native schema conversion accepts null branches in an object', { skip: !supported }, () => {
  assert.equal(result.nullSchema, true);
});
test('ai.release drops the warm sessions; none are made until a run', { skip: !supported }, () => {
  assert.deepEqual(result.release, { ok: true });
  assert.equal(result.warm, 0);
});
test('native tasks pass complete sendability checking', { skip: !supported }, () => {
  assert.doesNotMatch(diagnostics, /warning:|error:/);
});
test('the native handler never logs native message bodies, including malformed AI messages', () => {
  const source = fs.readFileSync(path.join(root, 'safari/Glaze/Glaze Extension/SafariWebExtensionHandler.swift'), 'utf8');
  assert.doesNotMatch(source, /String\(describing: message\)/);
});
