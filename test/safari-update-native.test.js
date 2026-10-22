const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
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
    const stub = `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');\nconst args=process.argv.slice(2), name=path.basename(process.argv[1]);\nfs.appendFileSync(process.env.T17_LOG,name+' '+args.join(' ')+'\\n');\nif(name==='hdiutil'&&args[0]==='attach')fs.cpSync(process.env.T17_FIXTURE,path.join(args[args.indexOf('-mountpoint')+1],'Glaze.app'),{recursive:true});\nif(name==='generate_keys')console.log(${JSON.stringify(publicKey)});\nif(name==='sign_update')console.log(${JSON.stringify(signature)});\n`;
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
  assert.match(build, /'io\.frostdev\.GlazeBuild' \+ i\[/, 'Xcode builds under ids of its own');
  assert.match(build, /plutil -replace CFBundleIdentifier -string io\.frostdev\.Glaze "\$app\/Contents\/Info\.plist"/);
  assert.ok(build.indexOf('ditto "$built" "$app"') > build.indexOf(' build > ') && build.indexOf('ditto "$built" "$app"') < build.indexOf('codesign --force'));
  assert.doesNotMatch(build, /ditto "\$app" "\$out\/build\/Glaze\.app"/, 'no unpacked app is left in release/');
});
