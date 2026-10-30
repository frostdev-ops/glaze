#!/usr/bin/env node
// What Safari's extension bundles: only what its Xcode project lists in the extension targets' resource phases (the Mac
// and the iOS one), as paths under "Glaze Extension/Resources"; a folder reference brings everything under it. The
// release scripts (build-safari.sh through stage-safari-dmg.py, appstore-safari.sh, appstore-ios.sh) unzip the Chrome
// package into that folder and build the project as it is checked in, so a file the package has and the project doesn't
// list would be left out of the app, silently. Run on the staged folder before a build, this fails when any staged file
// isn't bundled by both targets; test/safari-resources.test.js holds the project to everything the package ships.
//   node scripts/safari-resources.js "<stage>/Glaze/Glaze Extension/Resources"
const fs = require('fs');
const path = require('path');

const PROJECT = path.join(__dirname, '../safari/Glaze/Glaze.xcodeproj/project.pbxproj');
const TARGETS = ['Glaze Extension', 'Glaze iOS Extension'];

// { target: Set of paths under Resources, a folder's ending in '/' } from the project file, in Xcode's own text format
// (each file and build file on one line, each phase and target a block).
const bundled = (pbx = fs.readFileSync(PROJECT, 'utf8')) => {
  const refs = new Map();
  for (const m of pbx.matchAll(/^\t\t(\w{24}) \/\* .*? \*\/ = \{isa = PBXFileReference;(.*)\};$/gm)) {
    const p = m[2].match(/ path = ("[^"]*"|[^;]*);/)?.[1].replace(/^"|"$/g, '');
    if (p?.startsWith('Resources/')) refs.set(m[1], p.slice('Resources/'.length) + (/ lastKnownFileType = folder;/.test(m[2]) ? '/' : ''));
  }
  const builds = new Map([...pbx.matchAll(/^\t\t(\w{24}) \/\* .*? \*\/ = \{isa = PBXBuildFile; fileRef = (\w{24}) /gm)].map((m) => [m[1], m[2]]));
  const block = (id) => pbx.match(new RegExp(`^\\t\\t${id} /\\* .*? \\*/ = \\{\\n([\\s\\S]*?)\\n\\t\\t\\};$`, 'm'))?.[1] || '';
  const ids = (text, key) => [...(text.match(new RegExp(`\\b${key} = \\(([\\s\\S]*?)\\);`))?.[1] || '').matchAll(/\b(\w{24})\b/g)].map((m) => m[1]);
  const out = {};
  for (const m of pbx.matchAll(/^\t\t(\w{24}) \/\* (.*?) \*\/ = \{\n\t\t\tisa = PBXNativeTarget;/gm)) {
    if (!TARGETS.includes(m[2])) continue;
    const phases = ids(block(m[1]), 'buildPhases').map(block).filter((b) => b.includes('isa = PBXResourcesBuildPhase;'));
    out[m[2]] = new Set(phases.flatMap((b) => ids(b, 'files')).map((b) => refs.get(builds.get(b))).filter(Boolean));
  }
  return out;
};

// Whether `file` (a path under Resources) is bundled by `set`: listed itself, or under a listed folder.
const has = (set, file) => set.has(file) || [...set].some((p) => p.endsWith('/') && file.startsWith(p));
// What of `files` a target leaves out, as [target, file].
const missing = (files, sets = bundled()) => TARGETS.flatMap((t) => files.filter((f) => !sets[t] || !has(sets[t], f)).map((f) => [t, f]));
// Every file in a folder, by its path under it.
const walk = (dir, pre = '') => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), `${pre}${e.name}/`) : e.name === '.DS_Store' ? [] : [`${pre}${e.name}`]));

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error('usage: node scripts/safari-resources.js <staged "Glaze Extension/Resources" folder>');
    process.exit(2);
  }
  const files = walk(dir);
  const gaps = missing(files);
  if (!files.length || gaps.length) {
    console.error(`safari-resources: the Xcode project doesn't bundle:\n${gaps.map(([t, f]) => `  ${t}: ${f}`).join('\n') || '  (nothing staged)'}`);
    process.exit(1);
  }
  console.log(`safari-resources: all ${files.length} staged files are bundled by both extension targets`);
}

module.exports = { bundled, missing, walk, TARGETS };
