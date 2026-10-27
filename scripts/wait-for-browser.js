const { execFileSync } = require('node:child_process');

const browsers = () => {
  try { return execFileSync('pgrep', ['-x', 'chrome-headless-shell|Chromium|Google Chrome for Testing'], { encoding: 'utf8' }).trim(); }
  catch (e) { if (e.status === 1) return ''; throw e; }
};

module.exports = async (signal) => {
  signal?.throwIfAborted();
  for (let i = 0; browsers(); i++) {
    if (i >= 120) throw Error('gave up waiting for another browser');
    if (i % 6 === 0) console.error('[browser-check] another browser is running; waiting');
    await new Promise((resolve, reject) => {
      const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(done, 5000);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
};
