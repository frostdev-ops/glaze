// Google sign-in for Drive, in the worker only (lib/background.js 'glaze:google'), optional: nothing runs until the student
// presses Connect in Settings → Writer → Papers, whose click asks the browser for the identity permission first. Scopes:
// drive.file, openid and email (lib/google-config.js). The access token never leaves the worker and is never stored:
// Chrome's own cache (getAuthToken) or this worker's memory (launchWebAuthFlow). storage.local google holds { email, sub, flow,
// at }: the account connected, by its email and Google's id for it (userinfo sub). A token is used only once its userinfo
// names that same account: if the browser's account changes (Chrome's default one, Google's session), Drive refuses
// (why: 'account') until the student connects again, and never revokes the other account's grant.
// Flows (flowOf):
//   chrome  Google Chrome and Chromium: getAuthToken with the browser's Google account and the "Chrome extension" client
//           (the packaged manifest's oauth2).
//   web     Edge, Brave, other Chromium browsers and Firefox: launchWebAuthFlow, the "Web application" client's implicit flow
//           (response_type=token), its state checked (lib/oauth.js reply), renewed silently (prompt=none, interactive:false).
//   native  Safari, through the app (native(); not wired yet).
// The Picker (pick): Google's Picker on Glaze's picker page, frostdev.io's, else its GitHub Pages copy, opened with
// launchWebAuthFlow, the access token and a state in the fragment; the page comes back to the redirect URL with the state and
// the files picked (picked()). Requests carry no cookies, follow no redirect and skip the cache.
// env: { config, flow, firefox, identity() (chrome.identity, which exists once the permission is held), permissions, manifest(),
// storage (storage.local), fetch, native(message), keep() (Calendar sync holds identity too: Disconnect leaves it), now() }.
// Classic script; module.exports for node.
var GZ_GOOGLE = globalThis.GZ_GOOGLE || (() => {
  // The build-time switch, off until the release that ships Drive (and its privacy policy). Off: the worker refuses every
  // operation, Settings shows no Google Drive row, and the packages carry no oauth2 key or identity for Drive
  // (scripts/oauth-manifest.js). scripts/dev-drive.sh turns it on in its copy.
  const ON = false;
  const O = typeof GZ_OAUTH !== 'undefined' ? GZ_OAUTH : require('./oauth.js');
  const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
  const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
  const REVOKE = 'https://oauth2.googleapis.com/revoke';
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
    client_id: c.web, response_type: 'token', redirect_uri: redirect, scope: c.scopes.join(' '), state, include_granted_scopes: 'true',
    ...(prompt && { prompt }), ...(hint && { login_hint: hint }),
  })}`;
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
    const checked = new Set(); // tokens whose userinfo named the connected account, this worker's memory only
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

    // Safari: the app signs in. TODO(Safari): the extension handler (Swift) answers { type: 'google-auth', url } by running
    // ASWebAuthenticationSession on url with the iOS client's callback scheme and replying { url } with the URL it came back
    // to; the iOS client takes the code flow with PKCE (lib/oauth.js challenge, code). Until then config.native stays false.
    const native = async (url) => {
      const r = await Promise.resolve().then(() => env.native({ type: 'google-auth', url })).catch(() => null);
      if (typeof r?.url !== 'string') throw new Fail('cancel');
      return r.url;
    };
    const launch = async (url, interactive) => {
      if (env.flow === 'native') return native(url);
      const i = id();
      if (typeof i?.launchWebAuthFlow !== 'function') throw new Fail('permission');
      // Firefox's schema takes only these two keys, and reads the redirect from the url's redirect_uri.
      const details = { url, interactive };
      // Google's prompt=none answer can take a page or two: Chromium waits for it rather than giving up at the first load.
      if (!env.firefox && !interactive) Object.assign(details, { abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 10000 });
      try { return await i.launchWebAuthFlow(details); } catch { throw new Fail(interactive ? 'cancel' : 'auth'); }
    };
    // Google accepts no redirect on Firefox's own domain; Firefox's loopback form for this add-on is the one it allows.
    const redirect = () => {
      const r = id().getRedirectURL();
      return env.firefox ? `http://127.0.0.1/mozoauth2/${new URL(r).hostname.split('.')[0]}` : r;
    };

    const chromeToken = async (interactive) => {
      const i = id();
      if (typeof i?.getAuthToken !== 'function') throw new Fail('permission');
      let r;
      try { r = await i.getAuthToken({ interactive, scopes: c().scopes }); } catch (e) {
        throw new Fail(/support/i.test(String(e?.message || e)) ? 'unsupported' : interactive ? 'cancel' : 'auth');
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
      held = null;
      const once = async (prompt, inter) => {
        const state = O.random(), back = redirect();
        return grant(await launch(authUrl(c(), { redirect: back, state, prompt, hint }), inter), state, now());
      };
      let g = null;
      if (hint) g = await once('none', false).catch((e) => { if (!interactive || e.why === 'state') throw e; return null; });
      else if (!interactive) throw new Fail('auth');
      g ||= await once(hint ? '' : 'select_account', true);
      held = g;
      return g.token;
    };
    const tokenFor = (flow, interactive, hint) => (flow === 'chrome' ? chromeToken(interactive) : webToken(interactive, hint));
    const drop = async (flow, token) => {
      if (flow === 'chrome') await Promise.resolve().then(() => id()?.removeCachedAuthToken({ token })).catch(() => {});
      else held = null;
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
      const t = await tokenFor(g.flow, interactive, g.email);
      if (checked.has(t)) return t;
      if ((await who(g.flow, t)).sub !== g.sub) { await drop(g.flow, t); throw new Fail('account'); }
      if (checked.size > 50) checked.clear();
      checked.add(t);
      return t;
    };

    // → { ok: true, flow, email (null until connected) } or { ok: false, why: 'setup' (placeholders) | 'browser' (Safari, for now) }
    const status = async () => {
      if (!on) return { ok: false, why: 'off' };
      const flow = flowNow();
      if (flow === 'native' && c().native !== true) return { ok: false, why: 'browser' };
      if (!usable(flow)) return { ok: false, why: 'setup' };
      return { ok: true, flow, email: (await saved())?.email || null };
    };
    // From Settings' click, once the page holds the identity permission. → { ok, email } or { ok: false, why }
    const connect = () => turn(fails(async () => {
      const s = await status();
      if (!s.ok) return s;
      if (!await Promise.resolve(env.permissions.contains({ permissions: ['identity'] })).catch(() => false)) return { ok: false, why: 'permission' };
      if (s.flow === 'native') return { ok: false, why: 'browser' };
      let flow = s.flow, token;
      held = null;
      if (flow === 'chrome') {
        try { token = await chromeToken(true); } catch (e) { if (e.why !== 'unsupported' || !usable('web')) throw e.why === 'unsupported' ? new Fail('browser') : e; flow = 'web'; }
      }
      if (flow === 'web') token = await webToken(true, '');
      try {
        const { email, sub } = await who(flow, token);
        await env.storage.set({ google: { email, sub, flow, at: now() } });
        checked.add(token);
        return { ok: true, email };
      } catch (e) { held = null; throw e; }
    }));
    // The worker's token for a Drive request; interactive only for something the student pressed.
    const token = async ({ interactive = false } = {}) => {
      if (!on) throw new Fail('off');
      const g = await saved();
      if (!g) throw new Fail('connect');
      if (!usable(g.flow)) throw new Fail('setup');
      return ours(g, interactive);
    };
    const account = async () => (await saved())?.email || null;
    // The grant revoked (with a token from the cache or a silent renewal, never a prompt), the browser's cached tokens and
    // the identity permission dropped, the account forgotten. While Calendar sync holds the grant too (keep), revoking would
    // end its access as well (a revocation covers every scope the project was granted): only Drive's own state goes.
    // → { ok, revoked: whether Google confirmed, had: a connection, so Google may still hold its grant unless revoked (no
    // token for its account: signed out of Google, offline, or the browser's account changed) }
    const disconnect = () => turn(async () => {
      const g = await saved();
      if (await Promise.resolve().then(() => env.keep?.()).catch(() => true)) {
        held = null;
        await env.storage.remove('google');
        return { ok: true, revoked: false, had: false };
      }
      const t = g && usable(g.flow) ? await ours(g, false).catch(() => null) : null;
      const r = t && await send(REVOKE, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t }).toString(),
      }).catch(() => null);
      held = null;
      checked.clear();
      const i = id();
      if (t && g.flow === 'chrome') await Promise.resolve().then(() => i?.removeCachedAuthToken({ token: t })).catch(() => {});
      if (g?.flow === 'chrome') await Promise.resolve().then(() => i?.clearAllCachedAuthTokens()).catch(() => {});
      await Promise.resolve().then(() => env.permissions.remove({ permissions: ['identity'] })).catch(() => {});
      await env.storage.remove('google');
      return { ok: true, revoked: !!r?.ok, had: !!g };
    });
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
      const g = await saved();
      if (!g) return { ok: false, why: 'connect' };
      if (env.flow === 'native') return { ok: false, why: 'browser' };
      const t = await token({ interactive: true });
      const base = await reach();
      if (!base) return { ok: false, why: 'offline' };
      const state = O.random();
      const url = await launch(pickerUrl(base, { token: t, state, redirect: id().getRedirectURL(), key: c().apiKey, appId: c().appId }), true);
      return { ok: true, files: picked(url, state) };
    });

    return { status, connect, token, account, disconnect, pick };
  };

  return { ON, AUTH, USERINFO, REVOKE, DRIVE, APP, Fail, real, ready, pickable, flowOf, authUrl, pickerUrl, grant, picked, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_GOOGLE;
