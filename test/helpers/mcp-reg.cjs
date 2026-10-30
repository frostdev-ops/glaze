// A Windows registry for the glaze-mcp tests, driven through the reg.exe argv setup, uninstall and doctor give the real
// one, and `node --version` answered. As reg.exe does: `delete <key> /ve` takes only the default value and leaves the
// key, `delete <key>` takes the key and its subkeys, and `export` writes the key's other values and subkeys too, in
// UTF-16. `keys` holds each key's default value (null once only that is deleted); `named` its other values.
const fs = require('node:fs');

const HOST = 'io.frostdev.glaze_mcp';
const K = (p) => `HKCU\\Software\\${p}\\NativeMessagingHosts\\${HOST}`;
const REG = 'C:\\Windows\\System32\\reg.exe';

const runner = ({ nodeVersion = 'v22.11.0' } = {}) => {
  const keys = new Map(), named = new Map(), calls = [];
  const ok = { stdout: 'The operation completed successfully.\r\n', stderr: '' };
  const missing = () => Object.assign(new Error('ERROR: The system was unable to find the specified registry key or value.'), { code: 1 });
  // The key itself (when it exists) and each subkey under it.
  const under = (key) => [...new Set([...keys.keys(), ...named.keys()])].filter((k) => k === key || k.startsWith(`${key}\\`)).sort();
  const esc = (v) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const section = (k) => [`[${k.replace(/^HKCU/, 'HKEY_CURRENT_USER')}]`,
    ...(typeof keys.get(k) === 'string' ? [`@="${esc(keys.get(k))}"`] : []),
    ...Object.entries(named.get(k) || {}).map(([n, v]) => `"${n}"="${esc(v)}"`), ''].join('\r\n');
  const run = async (file, args) => {
    calls.push([file, args]);
    if (/reg\.exe$/i.test(file)) {
      const [op, key] = args;
      const all = under(key);
      if (op === 'add') { keys.set(key, args[args.indexOf('/d') + 1]); return ok; }
      if (op === 'delete' && args.includes('/ve')) {
        if (typeof keys.get(key) !== 'string') throw missing();
        keys.set(key, null);
        return ok;
      }
      if (op === 'delete') {
        if (!all.length) throw missing();
        for (const k of all) { keys.delete(k); named.delete(k); }
        return ok;
      }
      if (op === 'export') {
        if (!all.length) throw missing();
        const text = `Windows Registry Editor Version 5.00\r\n\r\n${[...new Set([key, ...all])].map(section).join('\r\n')}\r\n`;
        fs.writeFileSync(args[2], Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
        return ok;
      }
    }
    if (args[0] === '--version') return { stdout: `${nodeVersion}\n`, stderr: '' };
    throw new Error(`unexpected run: ${file} ${args.join(' ')}`);
  };
  return { keys, named, calls, run, ops: (op) => calls.filter(([, a]) => a[0] === op).map(([, a]) => a) };
};

module.exports = { HOST, K, REG, runner };
