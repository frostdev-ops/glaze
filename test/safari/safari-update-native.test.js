const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const swift = require('./helpers/swift-native.cjs');
const run = (command, args, options = {}) => spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
const plist = (file) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', file]).stdout);

// Exercise the same stage helper used for the release; no signing or private keys.
test('DMG staging is repeatable and isolates Sparkle from the checked-in Mac/iOS project', { skip: process.platform !== 'darwin' }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-stage-test-'));
  const projectPath = path.join(root, 'safari/Glaze/Glaze.xcodeproj/project.pbxproj');
  const original = fs.readFileSync(projectPath);
  try {
    assert.equal(run('sh', ['package.sh']).status, 0);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = run('python3', ['scripts/stage-safari-dmg.py', temp], { env: { ...process.env, SAFARI_UPDATE_PUBLIC_KEY: 'REPLACE_WITH_SPARKLE_EDDSA_PUBLIC_KEY' } });
      assert.equal(result.status, 0, result.stderr);
    }
    const staged = path.join(temp, 'Glaze');
    const p = plist(path.join(staged, 'Glaze.xcodeproj/project.pbxproj'));
    const objects = Object.values(p.objects);
    const dependency = objects.find((o) => o.isa === 'XCRemoteSwiftPackageReference');
    assert.deepEqual(dependency.requirement, { kind: 'exactVersion', version: '2.10.0' });
    assert.equal(dependency.repositoryURL, 'https://github.com/sparkle-project/Sparkle');
    const mac = objects.find((o) => o.isa === 'PBXNativeTarget' && o.name === 'Glaze');
    assert.equal(mac.packageProductDependencies.length, 1);
    for (const target of objects.filter((o) => o.isa === 'PBXNativeTarget' && o !== mac)) {
      assert.equal(target.packageProductDependencies, undefined, target.name);
    }
    const info = plist(path.join(staged, 'Glaze/Info.plist'));
    assert.equal(info.SUPublicEDKey, 'REPLACE_WITH_SPARKLE_EDDSA_PUBLIC_KEY');
    assert.equal(info.SUFeedURL, 'https://frostdev.io/projects/glaze/appcast.xml');
    assert.equal(info.LSUIElement, true);
    assert.equal(info.SUSendProfileInfo, false);
    assert.equal(info.CFBundleURLTypes[0].CFBundleURLSchemes[0], 'io.frostdev.glaze-update');
    const storyboard = fs.readFileSync(path.join(staged, 'Glaze/Base.lproj/Main.storyboard'), 'utf8');
    assert.ok(!storyboard.includes('initialViewController='));
    assert.ok(storyboard.includes('storyboardIdentifier="GlazeWindow"'));
    // Agent access is the DMG build's alone: its sources in the Mac targets, the app group, the private URL.
    const refs = (name) => Object.keys(p.objects).filter((k) => p.objects[k].isa === 'PBXFileReference' && p.objects[k].path === name);
    const compiled = (name) => objects.find((o) => o.isa === 'PBXNativeTarget' && o.name === name).buildPhases.map((k) => p.objects[k])
      .filter((ph) => ph.isa === 'PBXSourcesBuildPhase').flatMap((ph) => ph.files.map((f) => p.objects[f].fileRef));
    const [bridge] = refs('GlazeAgentBridge.swift'), [host] = refs('GlazeAgentHost.swift');
    assert.deepEqual([refs('GlazeAgentBridge.swift').length, refs('GlazeAgentHost.swift').length], [1, 1]);
    assert.deepEqual([compiled('Glaze Extension').includes(bridge), compiled('Glaze Extension').includes(host)], [true, false]);
    assert.deepEqual([compiled('Glaze').includes(bridge), compiled('Glaze').includes(host)], [true, true]);
    for (const name of ['Glaze iOS', 'Glaze iOS Extension']) assert.ok(!compiled(name).some((r) => r === bridge || r === host), name);
    assert.deepEqual(fs.readFileSync(path.join(staged, 'Glaze/GlazeAgentHost.swift')), fs.readFileSync(path.join(root, 'safari/dmg/GlazeAgentHost.swift')));
    assert.ok(fs.existsSync(path.join(staged, 'Glaze Extension/GlazeAgentBridge.swift')));
    const scheme = /static let start = "([a-z.-]+):\/\/start"/.exec(fs.readFileSync(path.join(root, 'safari/Glaze/Glaze Extension/GlazeAgentBridge.swift'), 'utf8'))[1];
    assert.equal(scheme, 'io.frostdev.glaze-agent');
    assert.deepEqual(info.CFBundleURLTypes[1], { CFBundleURLName: scheme, CFBundleURLSchemes: [scheme] });
    const GROUPS = 'com.apple.security.application-groups';
    const appEntitlements = plist(path.join(staged, 'Glaze/Release.entitlements')), extensionEntitlements = plist(path.join(staged, 'Glaze Extension/Release.entitlements'));
    assert.deepEqual([appEntitlements[GROUPS], appEntitlements['com.apple.security.app-sandbox']], [['22AAZFMTV8.io.frostdev.Glaze'], undefined]);
    assert.deepEqual([extensionEntitlements[GROUPS], extensionEntitlements['com.apple.security.app-sandbox']], [['22AAZFMTV8.io.frostdev.Glaze'], true]);
    for (const f of ['safari/Glaze/Glaze/Release.entitlements', 'safari/Glaze/Glaze Extension/Release.entitlements']) {
      assert.equal(plist(path.join(root, f))[GROUPS], undefined, `${f}: the App Store build has no group`);
    }
    // What each staged Mac target compiles typechecks with its own settings (test/helpers/swift-native.cjs), Sparkle as a stand-in.
    if (swift.supported) {
      const sources = (name) => compiled(name).map((ref) => {
        const group = objects.find((o) => o.isa === 'PBXGroup' && o.children?.includes(ref));
        return path.join(staged, group.path, p.objects[ref].path);
      });
      const setting = (name, key) => p.objects[objects.find((o) => o.isa === 'PBXNativeTarget' && o.name === name).buildConfigurationList]
        .buildConfigurations.map((k) => p.objects[k]).find((c) => c.name === 'Release').buildSettings[key];
      for (const [name, flags] of [['Glaze Extension', []], ['Glaze', ['-parse-as-library', '-module-name', 'Glaze']]]) {
        assert.equal(setting(name, 'SWIFT_ACTIVE_COMPILATION_CONDITIONS'), '$(inherited) GLAZE_DMG');
        const r = swift.typecheck(swift.sparkleSources(sources(name), temp), [...flags, '-D', 'GLAZE_DMG', '-default-isolation', setting(name, 'SWIFT_DEFAULT_ACTOR_ISOLATION') || 'nonisolated']);
        assert.equal(r.status, 0, `${name}: ${r.stderr}`);
        assert.doesNotMatch(r.stderr, /warning:|error:/, name);
      }
    }
    assert.deepEqual(fs.readFileSync(projectPath), original);
    assert.ok(!original.includes(Buffer.from('Sparkle')));
    assert.ok(!fs.readFileSync(path.join(root, 'safari/Glaze/Glaze/AppDelegate.swift'), 'utf8').includes('Sparkle'));
    const fixture = path.join(temp, 'drift-fixture');
    fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
    fs.cpSync(path.join(root, 'safari/Glaze'), path.join(fixture, 'safari/Glaze'), { recursive: true });
    fs.copyFileSync(path.join(root, 'manifest.json'), path.join(fixture, 'manifest.json'));
    fs.copyFileSync(path.join(root, 'scripts/stage-safari-dmg.py'), path.join(fixture, 'scripts/stage-safari-dmg.py'));
    const fixtureProject = path.join(fixture, 'safari/Glaze/Glaze.xcodeproj/project.pbxproj');
    const source = plist(projectPath);
    source.objects[source.rootObject].packageReferences = ['existing-dependency'];
    fs.writeFileSync(fixtureProject, JSON.stringify(source));
    assert.equal(run('plutil', ['-convert', 'xml1', fixtureProject]).status, 0);
    const drift = run('python3', [path.join(fixture, 'scripts/stage-safari-dmg.py'), path.join(temp, 'drift')]);
    assert.notEqual(drift.status, 0);
    assert.match(drift.stderr, /project package references/);
    delete source.objects[source.rootObject].packageReferences;
    Object.values(source.objects).find((o) => o.isa === 'PBXFileReference' && o.path === 'AppDelegate.swift').path = 'MovedDelegate.swift';
    fs.writeFileSync(fixtureProject, JSON.stringify(source));
    assert.equal(run('plutil', ['-convert', 'xml1', fixtureProject]).status, 0);
    const moved = run('python3', [path.join(fixture, 'scripts/stage-safari-dmg.py'), path.join(temp, 'drift')]);
    assert.notEqual(moved.status, 0);
    assert.match(moved.stderr, /AppDelegate source reference/);
    Object.values(source.objects).find((o) => o.isa === 'PBXFileReference' && o.path === 'MovedDelegate.swift').path = 'AppDelegate.swift';
    source.objects.F17A00000000000000000099 = { isa: 'PBXFileReference', lastKnownFileType: 'sourcecode.swift', path: 'GlazeAgentBridge.swift', sourceTree: '<group>' };
    fs.writeFileSync(fixtureProject, JSON.stringify(source));
    assert.equal(run('plutil', ['-convert', 'xml1', fixtureProject]).status, 0);
    const listed = run('python3', [path.join(fixture, 'scripts/stage-safari-dmg.py'), path.join(temp, 'drift')]);
    assert.notEqual(listed.status, 0);
    assert.match(listed.stderr, /agent sources already in the project/, 'the checked-in project never compiles agent code');
    const invalidKey = run('python3', ['scripts/stage-safari-dmg.py', path.join(temp, 'bad')], {
      env: { ...process.env, SAFARI_UPDATE_PUBLIC_KEY: 'bad-key' },
    });
    assert.notEqual(invalidKey.status, 0);
    assert.match(invalidKey.stderr, /32-byte/);
    const foreign = path.join(temp, 'foreign');
    fs.mkdirSync(path.join(foreign, 'Glaze'), { recursive: true });
    const refused = run('python3', ['scripts/stage-safari-dmg.py', foreign]);
    assert.notEqual(refused.status, 0);
    assert.ok(fs.existsSync(path.join(foreign, 'Glaze')));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('appcast helper validates before key lookup and preserves older release enclosures', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-appcast-test-'));
  const version = '2.2.0';
  const publicKey = Buffer.alloc(32, 7).toString('base64');
  const signature = Buffer.alloc(64, 8).toString('base64');
  try {
    for (const folder of ['scripts', 'bin', 'release', 'fixture/Contents']) fs.mkdirSync(path.join(temp, folder), { recursive: true });
    fs.copyFileSync(path.join(root, 'scripts/safari-appcast.sh'), path.join(temp, 'scripts/safari-appcast.sh'));
    fs.writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify({ version }));
    const dmg = path.join(temp, `glaze-${version}-safari-macos.dmg`);
    fs.writeFileSync(dmg, 'fixture DMG');
    const values = { CFBundleIdentifier: 'io.frostdev.Glaze', CFBundleVersion: version, CFBundleShortVersionString: version,
      SUPublicEDKey: publicKey, SUFeedURL: 'https://frostdev.io/projects/glaze/appcast.xml' };
    const writeInfo = (overrides = {}) => fs.writeFileSync(path.join(temp, 'fixture/Contents/Info.plist'),
      '<?xml version="1.0"?><plist version="1.0"><dict>' + Object.entries({ ...values, ...overrides }).map(([k, v]) => `<key>${k}</key><string>${v}</string>`).join('') + '</dict></plist>');
    writeInfo();
    const stub = `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');\nconst args=process.argv.slice(2), name=path.basename(process.argv[1]);\nfs.appendFileSync(process.env.T17_LOG,name+' '+args.join(' ')+'\\n');\nif(name==='hdiutil'&&args[0]==='attach')fs.symlinkSync(process.env.T17_FIXTURE,path.join(args[args.indexOf('-mountpoint')+1],'Glaze.app'),'dir');\nif(name==='hdiutil'&&args[0]==='detach')fs.unlinkSync(path.join(args[args.length-1],'Glaze.app'));\nif(name==='generate_keys')console.log(${JSON.stringify(publicKey)});\nif(name==='sign_update')console.log(${JSON.stringify(signature)});\n`;
    for (const tool of ['xcrun', 'spctl', 'hdiutil', 'codesign', 'generate_keys', 'sign_update']) {
      fs.writeFileSync(path.join(temp, 'bin', tool), stub, { mode: 0o755 });
    }
    const log = path.join(temp, 'commands.log');
    const env = { ...process.env, PATH: path.join(temp, 'bin') + path.delimiter + process.env.PATH,
      T17_LOG: log, T17_FIXTURE: path.join(temp, 'fixture') };
    const invoke = () => run('sh', [path.join(temp, 'scripts/safari-appcast.sh'), dmg, path.join(temp, 'bin')], { env });
    const oldURL = 'https://github.com/frostdev-ops/glaze/releases/download/v2.1.4/glaze-2.1.4-safari-macos.dmg';
    fs.writeFileSync(path.join(temp, 'release/appcast.xml'), `<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Glaze</title><item><enclosure url="${oldURL}" sparkle:version="2.1.4"/></item></channel></rss>`);
    writeInfo({ SUPublicEDKey: 'REPLACE_WITH_SPARKLE_EDDSA_PUBLIC_KEY' });
    const refused = invoke();
    assert.notEqual(refused.status, 0);
    assert.ok(!fs.readFileSync(log, 'utf8').includes('generate_keys'));
    assert.ok(!fs.readFileSync(log, 'utf8').includes('sign_update'));
    writeInfo();
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = invoke();
      assert.equal(result.status, 0, result.stderr);
    }
    const xml = fs.readFileSync(path.join(temp, 'release/appcast.xml'), 'utf8');
    assert.ok(xml.includes(oldURL));
    assert.ok(xml.includes(`https://github.com/frostdev-ops/glaze/releases/download/v${version}/glaze-${version}-safari-macos.dmg`));
    assert.ok(xml.includes(signature));
    assert.equal((xml.match(/sparkle:version="2.2.0"/g) || []).length, 1);
    assert.ok(xml.includes(`length="${fs.statSync(dmg).size}"`));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

// Safari matches extensions by bundle id: unregistering any copy of Glaze (a build product, the release copy, the
// disk image's) marks the installed Glaze removed and Safari deletes its settings. Deleting or ejecting a copy is safe.
test('nothing that builds, packages or installs the Mac app unregisters a copy of Glaze', () => {
  for (const f of ['scripts/build-safari.sh', 'scripts/make-dmg.sh', 'scripts/appstore-safari.sh', 'safari/Glaze/Glaze/ViewController.swift']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8').split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l)).join('\n');
    assert.doesNotMatch(src, /lsregister\S*"?\s+[^\n]*-u\b|\$0\\?"\s+-u\b|pluginkit\s+-r\b|LSUnregister/, f);
  }
  // Xcode registers what it builds: that copy is only ever signed ad hoc, and the release is signed in a copy of it.
  const build = fs.readFileSync(path.join(root, 'scripts/build-safari.sh'), 'utf8');
  const xcode = build.slice(build.indexOf('xcodebuild -project'), build.indexOf(' build > '));
  assert.match(xcode, /CODE_SIGN_IDENTITY=- /);
  assert.ok(build.indexOf('ditto "$built" "$app"') > build.indexOf(' build > ') && build.indexOf('ditto "$built" "$app"') < build.indexOf('codesign --force'));
  assert.doesNotMatch(build, /ditto "\$app" "\$out\/build\/Glaze\.app"/, 'no unpacked app is left in release/');
  // Both Mac builds run under ids of their own, signed ad hoc; only the copy that ships gets Glaze's back.
  const store = fs.readFileSync(path.join(root, 'scripts/appstore-safari.sh'), 'utf8');
  assert.match(store.slice(store.indexOf('xcodebuild archive'), store.indexOf('appstore-build.log')), /CODE_SIGN_IDENTITY=- /);
  for (const [f, src, before, after] of [['build-safari.sh', build, 'xcodebuild -project', 'codesign --force'], ['appstore-safari.sh', store, 'xcodebuild archive', 'xcodebuild -exportArchive']]) {
    assert.ok(src.indexOf('safari-build-ids.py project') > 0 && src.indexOf('safari-build-ids.py project') < src.indexOf(before), `${f}: build ids before Xcode`);
    assert.ok(src.indexOf('safari-build-ids.py app') > src.indexOf(before) && src.indexOf('safari-build-ids.py app') < src.indexOf(after), `${f}: Glaze's ids back before signing`);
  }
});

test('the build-id helper swaps the project to build ids and a built app back', { skip: process.platform !== 'darwin' }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-build-ids-'));
  try {
    const project = path.join(temp, 'project.pbxproj');
    fs.copyFileSync(path.join(root, 'safari/Glaze/Glaze.xcodeproj/project.pbxproj'), project);
    assert.equal(run('python3', ['scripts/safari-build-ids.py', 'project', project]).status, 0);
    const ids = Object.values(plist(project).objects).map((o) => o.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER).filter(Boolean);
    assert.ok(ids.length >= 2);
    assert.ok(ids.every((i) => i === 'io.frostdev.GlazeBuild' || i === 'io.frostdev.GlazeBuild.Extension'), ids.join());
    const app = path.join(temp, 'Glaze.app');
    const appex = path.join(app, 'Contents/PlugIns/Glaze Extension.appex/Contents');
    fs.mkdirSync(appex, { recursive: true });
    const info = (file, id) => run('plutil', ['-create', 'xml1', file]).status === 0 && run('plutil', ['-insert', 'CFBundleIdentifier', '-string', id, file]);
    info(path.join(app, 'Contents/Info.plist'), 'io.frostdev.GlazeBuild');
    info(path.join(appex, 'Info.plist'), 'io.frostdev.GlazeBuild.Extension');
    assert.equal(run('python3', ['scripts/safari-build-ids.py', 'app', app]).status, 0);
    assert.equal(plist(path.join(app, 'Contents/Info.plist')).CFBundleIdentifier, 'io.frostdev.Glaze');
    assert.equal(plist(path.join(appex, 'Info.plist')).CFBundleIdentifier, 'io.frostdev.Glaze.Extension');
    assert.notEqual(run('python3', ['scripts/safari-build-ids.py', 'app', app]).status, 0, 'refuses a copy that already has Glaze ids');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('the build-id helper rejects an invalid extension before changing either plist', { skip: process.platform !== 'darwin' }, async (t) => {
  const info = (id) => `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string></dict></plist>`;
  for (const [name, contents] of [
    ['wrong id', info('io.frostdev.Other.Extension')],
    ['malformed plist', 'not a plist'],
    ['missing plist', null],
  ]) {
    await t.test(name, () => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-build-ids-invalid-'));
      try {
        // Only plist fixtures, with no executable or .app directory.
        const fixture = path.join(temp, 'fixture with spaces');
        const appInfo = path.join(fixture, 'Contents/Info.plist');
        const extensionInfo = path.join(fixture, 'Contents/PlugIns/Glaze Extension.appex/Contents/Info.plist');
        fs.mkdirSync(path.dirname(extensionInfo), { recursive: true });
        const original = info('io.frostdev.GlazeBuild');
        fs.writeFileSync(appInfo, original);
        if (contents !== null) fs.writeFileSync(extensionInfo, contents);
        const result = run('python3', ['scripts/safari-build-ids.py', 'app', fixture]);
        assert.notEqual(result.status, 0, result.stderr);
        assert.equal(plist(appInfo).CFBundleIdentifier, 'io.frostdev.GlazeBuild', 'a rejected extension must leave the app under its build id');
        assert.equal(fs.readFileSync(appInfo, 'utf8'), original);
        if (contents !== null) assert.equal(fs.readFileSync(extensionInfo, 'utf8'), contents);
        else assert.ok(!fs.existsSync(extensionInfo));
      } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    });
  }
});

test('the build-id helper gives a DMG project\'s entitlements the build group, and a built copy\'s signed ones Glaze\'s group back', { skip: process.platform !== 'darwin' }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-build-group-'));
  const GROUPS = 'com.apple.security.application-groups', SANDBOX = 'com.apple.security.app-sandbox';
  const write = (file, o) => { fs.writeFileSync(file, JSON.stringify(o)); assert.equal(run('plutil', ['-convert', 'xml1', file]).status, 0); };
  // Only plist fixtures in a project's layout, with no .app directory.
  const layout = (name, app, ext) => {
    const srcroot = path.join(temp, name), project = path.join(srcroot, 'Glaze.xcodeproj/project.pbxproj');
    fs.mkdirSync(path.dirname(project), { recursive: true });
    fs.copyFileSync(path.join(root, 'safari/Glaze/Glaze.xcodeproj/project.pbxproj'), project);
    const files = ['Glaze', 'Glaze Extension'].map((t) => path.join(srcroot, t, 'Release.entitlements'));
    files.forEach((f, n) => { fs.mkdirSync(path.dirname(f)); write(f, [app, ext][n]); });
    return { project, files };
  };
  const ids = (project) => run('python3', ['scripts/safari-build-ids.py', 'project', project]);
  try {
    const dmg = layout('dmg', { 'com.apple.security.network.client': true, [GROUPS]: ['22AAZFMTV8.io.frostdev.Glaze'] }, { [SANDBOX]: true, [GROUPS]: ['22AAZFMTV8.io.frostdev.Glaze'] });
    assert.equal(ids(dmg.project).status, 0);
    assert.deepEqual(plist(dmg.files[0]), { 'com.apple.security.network.client': true, [GROUPS]: ['22AAZFMTV8.io.frostdev.GlazeBuild'] });
    assert.deepEqual(plist(dmg.files[1]), { [SANDBOX]: true, [GROUPS]: ['22AAZFMTV8.io.frostdev.GlazeBuild'] }, 'a build copy never shares the installed Glaze\'s group');
    const store = layout('store', { [SANDBOX]: true, 'com.apple.security.network.client': true }, { [SANDBOX]: true });
    const before = store.files.map((f) => fs.readFileSync(f));
    assert.equal(ids(store.project).status, 0);
    assert.deepEqual(store.files.map((f) => fs.readFileSync(f)), before, 'the App Store build\'s entitlements stay as they are');
    const foreign = layout('foreign', {}, { [SANDBOX]: true, [GROUPS]: ['22AAZFMTV8.io.example.Other'] });
    const unchanged = fs.readFileSync(foreign.project), refused = ids(foreign.project);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /not Glaze's/);
    assert.deepEqual(fs.readFileSync(foreign.project), unchanged, 'refused before anything changes');

    const built = path.join(temp, 'built.plist'), out = path.join(temp, 'release.plist');
    const back = () => run('python3', ['scripts/safari-build-ids.py', 'entitlements', built, out]);
    write(built, { [SANDBOX]: true, [GROUPS]: ['22AAZFMTV8.io.frostdev.GlazeBuild'] });
    assert.equal(back().status, 0);
    assert.deepEqual(plist(out), { [SANDBOX]: true, [GROUPS]: ['22AAZFMTV8.io.frostdev.Glaze'] });
    for (const groups of [['22AAZFMTV8.io.frostdev.Glaze'], ['22AAZFMTV8.io.example.Other'], [], undefined]) {
      fs.rmSync(out, { force: true });
      write(built, { [SANDBOX]: true, ...(groups && { [GROUPS]: groups }) });
      const r = back();
      assert.notEqual(r.status, 0, JSON.stringify(groups));
      assert.match(r.stderr, /isn't a build-id copy's entitlements/);
      assert.ok(!fs.existsSync(out));
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('the DMG release signs its extension and app with Glaze\'s app group, from explicit entitlements; the App Store build has no group or agent URL', () => {
  const build = fs.readFileSync(path.join(root, 'scripts/build-safari.sh'), 'utf8');
  const loop = build.slice(build.indexOf('for bundle in "$sparkle/XPCServices/Downloader.xpc"'), build.indexOf('codesign --verify --deep'));
  assert.match(loop, /"\$extension" \| "\$app"\)\n\s+codesign -d --entitlements - --xml "\$bundle" > "\$stage\/built\.entitlements" 2>\/dev\/null\n\s+python3 scripts\/safari-build-ids\.py entitlements "\$stage\/built\.entitlements" "\$stage\/release\.entitlements"\n\s+set -- --entitlements "\$stage\/release\.entitlements" --preserve-metadata=flags ;;/);
  assert.match(loop, /codesign --force --sign "\$identity" --timestamp --options runtime --identifier "\$id" "\$@" \\/);
  assert.equal((loop.match(/--preserve-metadata=[a-z,]*entitlements/g) || []).length, 2, 'only Sparkle\'s keep the entitlements they came with');
  assert.match(build, /CFBundleURLTypes:1:CFBundleURLSchemes:0' "\$app\/Contents\/Info\.plist" \| grep -qx 'io\.frostdev\.glaze-agent'/);
  assert.match(build, /if entitlements\.get\('com\.apple\.security\.application-groups'\) != \[sys\.argv\[3\] \+ '\.io\.frostdev\.Glaze'\]:/);
  assert.match(build, /python3 - "\$stage\/entitlements\.plist" "\$bundle" "\$team" <<'PY'/);
  const store = fs.readFileSync(path.join(root, 'scripts/appstore-safari.sh'), 'utf8');
  assert.doesNotMatch(store, /stage-safari-dmg|application-groups|glaze-agent/);
});
