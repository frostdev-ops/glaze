// Google sign-in for Drive, in the worker only (background/background.js 'glaze:google'), optional: nothing runs until the student
// presses Connect in Settings → Writer → Papers, whose click asks the browser for the identity permission first. Scopes:
// drive.file, openid and email (background/google-config.js). The access token never leaves the worker and is never stored:
// Chrome's own cache (getAuthToken) or this worker's memory (launchWebAuthFlow). storage.local google holds { email, sub, flow,
// at }: the account connected, by its email and Google's id for it (userinfo sub). A token is used only once its userinfo
// names that same account: if the browser's account changes (Chrome's default one, Google's session), Drive refuses
// (why: 'account') until the student connects again. Glaze never revokes a grant: Disconnect is this device only.
// Flows (flowOf):
//   chrome  Google Chrome and Chromium: getAuthToken with the browser's Google account and the "Chrome extension" client
//           (the packaged manifest's oauth2). With no Google account in the browser, Connect takes the web flow.
//   web     Edge, Brave, other Chromium browsers and Firefox: launchWebAuthFlow, the "Web application" client's implicit flow
//           (response_type=token) for Drive's scopes alone (no include_granted_scopes: the token the Picker page gets carries
//           nothing else), its state checked (background/oauth.js reply), renewed silently (prompt=none, interactive:false).
//   native  Safari: the extension's handler (safari/Glaze/Glaze Extension/GlazeGoogle.swift) holds the refresh token in the
//           Keychain and mints tokens; the sign-in page runs in the Glaze app, opened by the handler (macOS) or by a tab
//           the student taps (iOS, env.open). Connect answers why: 'pending' until the app has answered; Settings then asks
//           finish() until it has. The handler holds the sign-in under way, not this worker, so one Safari unloaded the
//           worker during (the app's page, or iOS switching apps) finishes from the next message (nativeGrant). Calendar
//           sync signs in the same way with a grant of its own (feature 'calendar': background/background.js).
// API: status(), connect() (from a click), finish() (Safari: the sign-in under way), token({ interactive }), drop(token) (one
// Google refused), account(), disconnect(), pick(); Safari's Picker in a tab: picked(state) (the asking page, again), back(url,
// tab) (Glaze's return page), closed(tab). The Picker (pick): Google's Picker on Glaze's picker page, frostdev.io's, else
// its GitHub Pages copy, opened with launchWebAuthFlow, the access token and a state in the fragment; the page comes back to
// the redirect URL with the state and the files picked (picked()). Safari: the same page in a tab of the worker's, coming
// back to documents/picked.html. Requests carry no cookies, follow no redirect and skip the cache.
// env: { config, flow, firefox, identity() (chrome.identity, which exists once the permission is held), permissions, manifest(),
// storage (storage.local), fetch, native(message), tab() → a blank tab's id, show(tab, url), shut(tab), back() → the return
// page's address, hold { get, set } (Safari's pick under way: storage.session), keep() (Calendar sync shares Chrome's
// cache and identity: Disconnect leaves them), now() }.
// Classic script; module.exports for node.
var GZ_GOOGLE = globalThis.GZ_GOOGLE || (() => {
  // The build-time switch, on since 4.0.1. Off: the worker refuses every operation, Settings shows no Google Drive row, and
  // the packages carry no oauth2 key or identity for Drive (tools/build/oauth-manifest.js).
  const ON = true;
  const O = typeof GZ_OAUTH !== 'undefined' ? GZ_OAUTH : require('./oauth.js');
  const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
  const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
  const DRIVE = 'https://www.googleapis.com/auth/drive.file';
  const APP = 'io.frostdev.Glaze'; // Safari's native handler
  const EARLY = 60e3; // a held token is renewed this long before Google's expiry

  class Fail extends Error { constructor(why) { super(why); this.why = why; } }

  // The client each flow signs in with; the Picker also needs its key and the project number (pickable).
  const NEEDS = { chrome: 'chrome', web: 'web', native: 'ios' };
  const real = (v) => typeof v === 'string' && /\S/.test(v) && !v.includes('PLACEHOLDER');
  const ready = (c, flow) => !!c && Object.hasOwn(NEEDS, flow) && real(c[NEEDS[flow]]) && Array.isArray(c.scopes) && c.scopes.includes(DRIVE)
    && (flow !== 'native' || c.native === true);
  const pickable = (c) => !!c && real(c.apiKey) && real(c.appId) && Array.isArray(c.picker) && c.picker.length > 0;

  // getAuthToken signs in with the browser's own Google account only in Google Chrome and Chromium: Edge refuses it and Brave
  // has no Google sign-in, so those (and anything that doesn't say) take the web flow.
  const CHROME = /^(Google Chrome|Chromium|HeadlessChrome)$|Not.?A.?Brand/i;
  const flowOf = ({ protocol, brands }) => (protocol === 'safari-web-extension:' ? 'native'
    : protocol === 'chrome-extension:' && Array.isArray(brands) && brands.length > 0 && brands.every((b) => CHROME.test(b?.brand)) ? 'chrome' : 'web');

  const authUrl = (c, { redirect, state, prompt, hint }) => `${AUTH}?${new URLSearchParams({
    client_id: c.web, response_type: 'token', redirect_uri: redirect, scope: c.scopes.join(' '), state,
    ...(prompt && { prompt }), ...(hint && { login_hint: hint }),
  })}`;
  // Safari's handler for one feature's grant ('drive', or 'calendar' for Calendar sync), Drive's and Calendar's alike.
  // env: { native(message) (sendNativeMessage), open(url) (iOS: the worker's tab), now() }. Nothing about a sign-in is held
  // here: the handler keeps it (ten minutes), so start() and finish() work across workers. The access token from mint() is
  // held in this worker's memory only, until a minute before Google's expiry, so a run's requests don't each ask the
  // handler (whose process Safari may have ended, and which would ask Google again). → { status, start, finish, mint,
  // drop, forget, disconnect }; mint(sub) → the handler's answer ({ ok, token } or { ok: false, why }).
  const nativeGrant = (env, feature) => {
    const now = env.now || Date.now;
    const ask = (m) => Promise.resolve().then(() => env.native(feature === 'drive' ? m : { ...m, feature })).catch(() => null);
    let held = null, epoch = 0;
    const status = () => ask({ type: 'google.status' });
    // A new sign-in: the app's page opened (macOS: by the handler; iOS: a tab the student taps).
    const start = async () => {
      epoch++; held = null;
      const r = await ask({ type: 'google.connect' });
      if (r?.ok !== true || typeof r.open !== 'string') throw new Fail(r?.why === 'setup' ? 'setup' : 'auth');
      if (!r.opened) await Promise.resolve().then(() => env.open(r.open)).catch(() => { throw new Fail('auth'); });
    };
    // The sign-in under way, waited on up to wait ms: → { email, sub }, or Fail 'pending' (ask again), 'signin' (none under
    // way, or it expired), 'cancel', 'state', 'scope', 'network' or 'auth'.
    const finish = async (wait = 15000) => {
      const r = await ask({ type: 'google.finish', wait });
      if (r?.why === 'pending') throw new Fail('pending');
      if (r?.ok !== true || typeof r.email !== 'string' || typeof r.sub !== 'string') throw new Fail(['cancel', 'state', 'scope', 'network', 'signin'].includes(r?.why) ? r.why : 'auth');
      epoch++; held = null;
      return { email: r.email, sub: r.sub };
    };
    const mint = async (sub) => {
      if (held && held.sub === sub && held.exp - EARLY > now()) return { ok: true, token: held.token };
      const at = epoch;
      const r = await ask({ type: 'google.token', ...(sub && { sub }) });
      if (r?.ok === true && typeof r.token === 'string' && r.token && at === epoch) {
        const exp = Number(r.expiresAt);
        // Only the handler knows the token's lifetime. An absent or expired timestamp cannot extend it here.
        held = Number.isFinite(exp) && exp > now() ? { token: r.token, sub, exp } : null;
      }
      return r;
    };
    const forget = () => { epoch++; held = null; };
    const drop = async (token) => {
      // A mint already awaiting the handler can still answer with this refused token after its replacement arrives.
      epoch++;
      if (held?.token === token) held = null;
      await ask({ type: 'google.drop', token });
    };
    const disconnect = async () => {
      forget();
      const r = await ask({ type: 'google.disconnect' });
      if (r?.ok !== true) throw new Fail('network');
      return r;
    };
    return { status, start, finish, mint, drop, forget, disconnect };
  };

  const pickerUrl = (base, { token, state, redirect, key, appId }) => `${base}#${new URLSearchParams({ access_token: token, state, redirect_uri: redirect, key, app_id: appId })}`;

  // The implicit flow's answer, from the fragment only: our state, a bearer token and the Drive scope (the consent screen
  // lets a student untick it). → { token, exp }
  const grant = (url, state, now) => {
    let r;
    try { r = O.reply(url, state, 'hash'); } catch (e) { throw new Fail(e.error === 'state' ? 'state' : e.error === 'access_denied' ? 'cancel' : 'auth'); }
    if (typeof r.access_token !== 'string' || !r.access_token || !/^bearer$/i.test(r.token_type || '')) throw new Fail('auth');
    if (!String(r.scope || '').split(/\s+/).includes(DRIVE)) throw new Fail('scope');
    const s = Number(r.expires_in);
    return { token: r.access_token, exp: now + (s > 0 ? Math.min(s, 86400) : 3600) * 1000 };
  };

  // The picker page's answer, from the fragment only: our state, then action=cancel, or action=picked with files, a JSON list
  // of at most 100 { id, name, mimeType }. Anything else is 'picker'.
  const ID = /^[\w-]{1,256}$/, MIME = /^[\w.+-]{1,127}\/[\w.+-]{1,127}$/;
  const picked = (url, state) => {
    let r;
    try { r = O.reply(url, state, 'hash'); } catch (e) { throw new Fail(e.error === 'state' ? 'state' : 'picker'); }
    if (r.action === 'cancel') return [];
    let list = null;
    try { list = r.action === 'picked' ? JSON.parse(r.files) : null; } catch { /* not JSON */ }
    if (!Array.isArray(list) || !list.length || list.length > 100) throw new Fail('picker');
    return list.map((f) => {
      if (typeof f?.id !== 'string' || !ID.test(f.id) || typeof f.name !== 'string' || !f.name || f.name.length > 1000 || !MIME.test(f.mimeType)) throw new Fail('picker');
      return { id: f.id, name: f.name, mimeType: f.mimeType };
    });
  };

  const create = (env) => {
    const c = () => env.config;
    const on = env.on ?? ON; // tests switch it on
    const now = env.now || Date.now;
    const id = () => env.identity();
    let held = null; // the web flow's { token, exp }: this worker's memory only
    const checked = new Map(); // token → the account (sub) its userinfo named: this worker's memory only
    let gen = 0; // moves on at each Connect and Disconnect: a Pick that started before one stops
    const current = (at) => { if (gen !== at) throw new Fail('connect'); };
    let queue = Promise.resolve();
    const turn = (f) => { const p = queue.then(f); queue = p.catch(() => {}); return p; };
    const send = (url, init = {}) => env.fetch(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    const saved = async () => {
      const g = (await env.storage.get('google')).google;
      return typeof g?.email === 'string' && typeof g.sub === 'string' && g.sub && Object.hasOwn(NEEDS, g.flow) ? g : null;
    };
    // Chrome signs in with its own client only when the manifest holds it; a copy with another (a dev build) uses the web flow.
    const usable = (flow) => ready(c(), flow) && (flow !== 'chrome' || env.manifest()?.oauth2?.client_id === c().chrome);
    const flowNow = () => (env.flow === 'chrome' && !usable('chrome') && usable('web') ? 'web' : env.flow);
    const fails = (f) => async (...a) => {
      try { return await f(...a); } catch (e) { if (e instanceof Fail) return { ok: false, why: e.why }; throw e; }
    };
    // A sign-in that failed while the browser knows it is offline: 'network', never a reason to connect again.
    const offline = () => globalThis.navigator?.onLine === false;

    // Safari's handler (nativeGrant), Drive's grant.
    const drive = nativeGrant(env, 'drive');
    const nativeToken = async (g) => {
      const at = gen;
      const r = await drive.mint(g.sub);
      current(at);
      if (r?.ok === true && typeof r.token === 'string' && r.token) return r.token;
      if (r?.why === 'revoked') await env.storage.remove('google');
      throw new Fail(r?.why === 'account' ? 'account' : r?.why === 'revoked' || r?.why === 'signin' ? 'connect' : 'network');
    };
    // The account a native sign-in connected, kept as the other flows keep theirs.
    const nativeSave = async ({ email, sub }) => {
      gen++;
      await env.hold?.set(null);
      await env.storage.set({ google: { email, sub, flow: 'native', at: now() } });
      return { ok: true, email };
    };
    const launch = async (url, interactive) => {
      const i = id();
      if (typeof i?.launchWebAuthFlow !== 'function') throw new Fail('permission');
      // Firefox's schema takes only these two keys, and reads the redirect from the url's redirect_uri.
      const details = { url, interactive };
      // Google's prompt=none answer can take a page or two: Chromium waits for it rather than giving up at the first load.
      if (!env.firefox && !interactive) Object.assign(details, { abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 10000 });
      try { return await i.launchWebAuthFlow(details); } catch { throw new Fail(offline() ? 'network' : interactive ? 'cancel' : 'auth'); }
    };
    // The browser's redirect URL; the identity API is gone with its permission.
    const own = () => {
      const i = id();
      if (typeof i?.getRedirectURL !== 'function') throw new Fail('permission');
      return i.getRedirectURL();
    };
    // Google accepts no redirect on Firefox's own domain; Firefox's loopback form for this add-on is the one it allows.
    const redirect = () => {
      const r = own();
      return env.firefox ? `http://127.0.0.1/mozoauth2/${new URL(r).hostname.split('.')[0]}` : r;
    };

    const chromeToken = async (interactive) => {
      const i = id();
      if (typeof i?.getAuthToken !== 'function') throw new Fail('permission');
      let r;
      // 'signin': no Google account signed in to the browser, or browser sign-in turned off (Chrome closes its own sign-in
      // prompt with the same answer).
      try { r = await i.getAuthToken({ interactive, scopes: c().scopes }); } catch (e) {
        const m = String(e?.message || e);
        throw new Fail(/support/i.test(m) ? 'unsupported' : /not signed in|browser ?sign-?in/i.test(m) ? 'signin' : offline() ? 'network' : interactive ? 'cancel' : 'auth');
      }
      const token = typeof r === 'string' ? r : r?.token;
      if (typeof token !== 'string' || !token) throw new Fail('auth');
      if (Array.isArray(r?.grantedScopes) && !r.grantedScopes.includes(DRIVE)) {
        await Promise.resolve().then(() => i.removeCachedAuthToken({ token })).catch(() => {}); // or Chrome hands it back next time
        throw new Fail('scope');
      }
      return token;
    };
    // hint: the connected account, for a silent renewal first; without one only an interactive sign-in can answer.
    const webToken = async (interactive, hint) => {
      if (held && held.exp - EARLY > now()) return held.token;
      const at = gen;
      held = null;
      const once = async (prompt, inter) => {
        current(at);
        const state = O.random(), back = redirect();
        const answer = await launch(authUrl(c(), { redirect: back, state, prompt, hint }), inter);
        current(at);
        return grant(answer, state, now());
      };
      let g = null;
      if (hint) g = await once('none', false).catch((e) => { if (!interactive || ['state', 'connect', 'network', 'permission'].includes(e.why)) throw e; return null; });
      else if (!interactive) throw new Fail('auth');
      g ||= await once(hint ? '' : 'select_account', true);
      held = g;
      return g.token;
    };
    const tokenFor = (flow, interactive, hint) => (flow === 'chrome' ? chromeToken(interactive) : webToken(interactive, hint));
    const drop = async (flow, token) => {
      if (flow === 'chrome') await Promise.resolve().then(() => id()?.removeCachedAuthToken({ token })).catch(() => {});
      else if (held?.token === token) held = null;
    };
    const who = async (flow, token) => {
      const r = await send(USERINFO, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
      if (r?.status === 401) { await drop(flow, token); throw new Fail('auth'); }
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (typeof j?.email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(j.email) || j.email.length > 320 || typeof j.sub !== 'string' || !/^[\w-]{1,255}$/.test(j.sub)) throw new Fail('network');
      return { email: j.email, sub: j.sub };
    };
    // g's token, once Google says it is g's account's. Another account's is forgotten (Chrome's cache, this worker's
    // memory) and refused: 'account'.
    const ours = async (g, interactive) => {
      if (g.flow === 'native') return nativeToken(g); // the handler binds its refresh token to g.sub
      const at = gen;
      const t = await tokenFor(g.flow, interactive, g.email);
      current(at);
      if (checked.get(t) === g.sub) return t;
      const { sub } = await who(g.flow, t);
      current(at);
      if (checked.size > 50) checked.clear();
      checked.set(t, sub);
      if (sub !== g.sub) { await drop(g.flow, t); throw new Fail('account'); }
      return t;
    };

    const canPickNative = () => typeof env.tab === 'function' && typeof env.show === 'function'
      && typeof env.hold?.get === 'function' && typeof env.hold?.set === 'function';
    // → { ok: true, flow, email (null until connected), picker (pick() can open Google's Picker here, with its key and
    // a hold that survives worker unload; Save to Drive and Sync need neither) } or { ok: false, why: 'setup'
    // (placeholders) | 'browser' (Safari, for now) }
    const status = async () => {
      if (!on) return { ok: false, why: 'off' };
      const flow = flowNow();
      if (flow === 'native' && c().native !== true) return { ok: false, why: 'browser' };
      if (!usable(flow)) return { ok: false, why: 'setup' };
      if (flow !== 'native') return { ok: true, flow, email: (await saved())?.email || null, picker: pickable(c()) };
      const h = await drive.status();
      if (h?.ok !== true) return { ok: false, why: 'setup' }; // no app group
      let g = await saved();
      // The handler may have committed the grant just before Safari ended the worker that asked finish(). Its account
      // is durable too: recover that reply here, including a reconnect to another account, without another sign-in.
      if (!h.pending && typeof h.email === 'string' && /^[^@\s]+@[^@\s]+$/.test(h.email) && h.email.length <= 320
        && typeof h.sub === 'string' && /^[\w-]{1,255}$/.test(h.sub) && (g?.flow !== 'native' || g.sub !== h.sub || g.email !== h.email)) {
        await nativeSave(h);
        g = await saved();
      }
      // pending: a sign-in under way in the app, for Settings to finish (the student may be back from it already).
      return { ok: true, flow, email: g?.email || null, picker: pickable(c()) && canPickNative(), pending: h.pending === true };
    };
    // From Settings' click, once the page holds the identity permission. → { ok, email } or { ok: false, why }
    const connect = () => turn(fails(async () => {
      const s = await status();
      if (!s.ok) return s;
      if (s.flow === 'native') {
        gen++;
        await env.hold?.set(null);
        await drive.start();
        return nativeSave(await drive.finish());
      }
      // Firefox's package holds identity from install (it has no optional identity, and its permissions API throws if asked).
      if (!env.firefox && !await Promise.resolve().then(() => env.permissions.contains({ permissions: ['identity'] })).catch(() => false)) return { ok: false, why: 'permission' };
      let flow = s.flow, token;
      held = null;
      if (flow === 'chrome') {
        // No getAuthToken here, or no Google account in the browser: Google's own sign-in page instead.
        try { token = await chromeToken(true); } catch (e) {
          if (!['unsupported', 'signin'].includes(e.why)) throw e;
          if (!usable('web')) throw new Fail(e.why === 'unsupported' ? 'browser' : 'signin');
          flow = 'web';
        }
      }
      if (flow === 'web') token = await webToken(true, '');
      try {
        const { email, sub } = await who(flow, token);
        gen++;
        await env.storage.set({ google: { email, sub, flow, at: now() } });
        checked.set(token, sub);
        return { ok: true, email };
      } catch (e) { held = null; throw e; }
    }));
    // Safari: the sign-in Connect started, answered once the app has it (why: 'pending' until then). → { ok, email } or
    // { ok: false, why }
    const finish = () => turn(fails(async () => {
      const s = await status();
      if (!s.ok) return s;
      if (s.flow !== 'native') return { ok: false, why: 'request' };
      return nativeSave(await drive.finish());
    }));
    // The worker's token for a Drive request; interactive only for something the student pressed.
    const token = async ({ interactive = false } = {}) => {
      if (!on) throw new Fail('off');
      const at = gen;
      const g = await saved();
      current(at);
      if (!g) throw new Fail('connect');
      if (!usable(g.flow)) throw new Fail('setup');
      const t = await ours(g, interactive);
      current(at);
      return t;
    };
    const account = async () => (await saved())?.email || null;
    // A token Google answered 401 to: forgotten with its account check (Chrome's cache, or this worker's held one), so the
    // next token() gets a fresh one, silently where it can. A Drive request's one retry calls this, then token().
    const forget = async (t) => {
      if (typeof t !== 'string' || !t) return;
      checked.delete(t);
      const g = await saved();
      if (g?.flow === 'chrome') await Promise.resolve().then(() => id()?.removeCachedAuthToken({ token: t })).catch(() => {});
      else if (g?.flow === 'native') await drive.drop(t);
      else if (held?.token === t) held = null;
    };
    // This device only (owner, 2026-10-31): the account, its tokens (Chrome's cache, this worker's memory, Safari's Keychain)
    // and the identity permission forgotten here, Google's grant kept, so Drive and Calendar on the student's other devices,
    // and Calendar here, keep working. While Calendar sync shares Chrome's cache and identity (keep), both stay. → { ok }
    const disconnect = () => turn(fails(async () => {
      gen++;
      const g = await saved();
      held = null;
      checked.clear();
      if (env.flow === 'native' || g?.flow === 'native') { await env.hold?.set(null); await drive.disconnect(); }
      else if (!await Promise.resolve().then(() => env.keep?.()).catch(() => true)) {
        if (g?.flow === 'chrome') await Promise.resolve().then(() => id()?.clearAllCachedAuthTokens()).catch(() => {});
        if (!env.firefox) await Promise.resolve().then(() => env.permissions.remove({ permissions: ['identity'] })).catch(() => {});
      }
      await env.storage.remove('google');
      return { ok: true };
    }));
    // The first picker page that answers, else null: frostdev.io's, then its GitHub Pages copy (which answers every origin).
    const reach = async () => {
      for (const base of c().picker) {
        const r = await send(base, { method: 'HEAD', signal: AbortSignal.timeout(8000) }).catch(() => null);
        if (r?.ok) return base;
      }
      return null;
    };
    // From a click on a Glaze page. → { ok: true, files: [{ id, name, mimeType }] (none: cancelled) } or { ok: false, why }
    const pick = fails(async () => {
      if (!on) return { ok: false, why: 'off' };
      if (!pickable(c())) return { ok: false, why: 'setup' };
      const at = gen, still = () => current(at);
      const g = await saved();
      still();
      if (!g) return { ok: false, why: 'connect' };
      // A Connect or Disconnect while this waits: the token isn't handed on, and nothing comes back.
      if (env.flow === 'native') {
        // Safari has no launchWebAuthFlow: the picker page opens in a tab of the worker's and comes back to Glaze's own
        // return page (documents/picked.html, which hands its address to back()), and the page that asked waits on
        // picked(state). The pick waits in env.hold, not this worker's memory: Safari may unload the worker meanwhile.
        if (!canPickNative()) return { ok: false, why: 'browser' };
        const t = await token({ interactive: true });
        still();
        const base = await reach();
        still();
        if (!base) return { ok: false, why: 'offline' };
        return turn(async () => {
          still();
          const state = O.random();
          await env.hold.set(null);
          // Save a blank tab before navigating: an immediate return or onRemoved waits for this turn and sees the hold.
          const tab = await env.tab();
          if (!Number.isInteger(tab)) return { ok: false, why: 'picker' };
          try {
            await env.hold.set({ state, tab, sub: g.sub, at: now() });
            await env.show(tab, pickerUrl(base, { token: t, state, redirect: env.back(), key: c().apiKey, appId: c().appId }));
          } catch (e) {
            await env.hold.set(null);
            await Promise.resolve().then(() => env.shut?.(tab)).catch(() => {});
            throw e;
          }
          return { ok: false, why: 'pending', state };
        });
      }
      const t = await token({ interactive: true });
      still();
      const base = await reach();
      still();
      if (!base) return { ok: false, why: 'offline' };
      const state = O.random();
      const url = await launch(pickerUrl(base, { token: t, state, redirect: own(), key: c().apiKey, appId: c().appId }), true);
      still();
      return { ok: true, files: picked(url, state) };
    });

    // Safari's return page (documents/picked.html, top-level in its tab): the address the picker page came back to, for the
    // pick under way in that tab only, its state checked (picked()). → { ok } (the worker then closes the tab)
    const PICK_FOR = 10 * 60e3;
    const back = (url, tab) => turn(async () => {
      const p = await env.hold?.get();
      if (!on || !p || p.done || p.tab !== tab || now() - p.at >= PICK_FOR || typeof url !== 'string' || url.split('#')[0] !== env.back()) return { ok: false, why: 'state' };
      if ((await saved())?.sub !== p.sub) { await env.hold.set(null); return { ok: false, why: 'connect' }; }
      let files = null, why = '';
      try { files = picked(url, p.state); } catch (e) {
        if (e.why === 'state') return { ok: false, why: 'state' };
        why = e.why || 'picker';
      }
      await env.hold.set({ ...p, done: true, ...(files ? { files } : { why }) });
      return { ok: true };
    });
    // The pick's tab closed: a cancel, unless its page already came back.
    const closed = (tab) => turn(async () => {
      const p = await env.hold?.get();
      if (p && !p.done && p.tab === tab) await env.hold.set({ ...p, done: true, files: [] });
    });
    // The page that pressed From Google Drive, asking again with its invocation's state while Safari's pick is under way.
    // A stale page cannot consume a newer choice, even after worker unload. → { ok: true, files } (none:
    // cancelled), { ok: false, why: 'pending' } (ask again), or why it stopped: another account connected meanwhile is 'connect'.
    const pickedNow = (state) => turn(fails(async () => {
      const p = await env.hold?.get();
      if (!on || !p || typeof state !== 'string' || p.state !== state) return { ok: false, why: 'state' };
      if ((await saved())?.sub !== p.sub) { await env.hold.set(null); return { ok: false, why: 'connect' }; }
      if (now() - p.at >= PICK_FOR) {
        await env.hold.set(null);
        return { ok: false, why: 'cancel' };
      }
      if (!p.done) return { ok: false, why: 'pending' };
      await env.hold.set(null);
      return p.files ? { ok: true, files: p.files } : { ok: false, why: p.why || 'picker' };
    }));

    // Status can recover a native account: serialize it with Connect/Disconnect so a late status cannot reconnect one
    // the student just disconnected. Internal calls already hold this turn.
    return { status: env.flow === 'native' ? () => turn(status) : status, connect, finish, token, drop: forget, account, disconnect, pick, picked: pickedNow, back, closed };
  };

  return { ON, AUTH, USERINFO, DRIVE, APP, Fail, real, ready, pickable, flowOf, authUrl, pickerUrl, grant, picked, nativeGrant, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_GOOGLE;
