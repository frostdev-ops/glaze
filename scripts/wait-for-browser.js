const { execFileSync } = require('node:child_process');

const browsers = () => {
  try { return execFileSync('pgrep', ['-x', 'chrome-headless-shell|Chromium|Google Chrome for Testing'], { encoding: 'utf8' }).trim(); }
  catch (e) { if (e.status === 1) return ''; throw e; }
};

module.exports = async () => {
  for (let i = 0; browsers(); i++) {
    if (i >= 120) throw Error('gave up waiting for another browser');
    if (i % 6 === 0) console.error('[browser-check] another browser is running; waiting');
    await new Promise((r) => setTimeout(r, 5000));
  }
};
