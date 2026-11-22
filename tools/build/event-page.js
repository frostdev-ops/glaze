#!/usr/bin/env node
// The background as an event page: every script background/background.js imports by name, in order and once, between
// background/event-page.js (importScripts as a no-op) and the worker itself, for Safari (Firefox's build makes the same
// list in tools/build/package-firefox.sh). Safari's service worker can't start again late in a long session: restarted
// in a web process without its page, its importScripts go to the network process, which can't load the extension's
// files (-1002), until Safari quits (WebKit main a4740a5a, WebLoaderStrategy::tryLoadingUsingURLSchemeHandler); a
// background page loads its scripts through its own view.
// A script an import imports in turn must be imported by background.js too (test/firefox/background-imports.test.js).
//   node tools/build/event-page.js <manifest.json> <background.js> [--non-persistent]   rewrites the manifest in place
const fs = require('fs');
const path = require('path');

const SHIM = 'background/event-page.js', WORKER = 'background/background.js';
// The scripts the worker names in its importScripts calls, as paths from the package root.
const imports = (source) => [...String(source).matchAll(/importScripts\(([^)]*)\)/g)]
  .flatMap(([, args]) => [...args.matchAll(/'([^']+)'/g)].map(([, f]) => path.posix.join('background', f)));
const scripts = (source) => [SHIM, ...new Set(imports(source).filter((f) => f !== SHIM && f !== WORKER)), WORKER];
const background = (source, { persistent } = {}) => ({ scripts: scripts(source), ...(persistent === false && { persistent: false }) });

if (require.main === module) {
  const [file, worker, flag] = process.argv.slice(2);
  if (!file || !worker || (flag && flag !== '--non-persistent')) {
    console.error('usage: node tools/build/event-page.js <manifest.json> <background.js> [--non-persistent]');
    process.exit(2);
  }
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  m.background = background(fs.readFileSync(worker, 'utf8'), { persistent: flag ? false : undefined });
  fs.writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);
}

module.exports = { SHIM, WORKER, imports, scripts, background };
