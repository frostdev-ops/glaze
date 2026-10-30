// PKCE (RFC 7636), states and the redirect check for sign-in. Pure: no endpoints, no client IDs, no requests. The worker
// loads it for Google Drive (lib/google.js); never a page or a content script.
const GZ_OAUTH = (() => {
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const random = () => b64url(crypto.getRandomValues(new Uint8Array(32))); // 43 characters, 256 bits
  // For verifiers from random() only; it doesn't check an arbitrary verifier's syntax.
  const challenge = async (verifier) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  // The code from the URL the provider redirected to, or an Error whose `.error` is the provider's OAuth error
  // (consent_required, interaction_required, access_denied, …), 'state' or 'code'. Fails closed: no pending
  // state, a missing or different one, or any repeated response parameter (RFC 6749 §3.1) is 'state'.
  // It checks state only: the caller must know the URL came back to its own redirect URI, as
  // chrome.identity.launchWebAuthFlow guarantees for https://<id>.chromiumapp.org/*.
  const fail = (error, description = '') => Object.assign(new Error(description || error), { error });
  // The redirect's parameters as an object, under the same checks: from the query, else the fragment; `from` 'hash' reads
  // the fragment only (an implicit-flow token, or the Drive picker's answer, never travels in a query).
  const reply = (redirect, state, from) => {
    const u = new URL(redirect);
    const p = new URLSearchParams(from === 'hash' ? u.hash.slice(1) : u.search || u.hash.slice(1)); // Microsoft can answer in the fragment
    const keys = [...p.keys()];
    if (typeof state !== 'string' || !state || keys.length !== new Set(keys).size || p.get('state') !== state) throw fail('state');
    if (p.get('error')) throw fail(p.get('error'), p.get('error_description') || '');
    return Object.fromEntries(p);
  };
  const code = (redirect, state) => {
    const p = reply(redirect, state);
    if (!p.code) throw fail('code');
    return p.code;
  };
  return { random, challenge, reply, code };
})();
if (typeof module !== 'undefined') module.exports = GZ_OAUTH;
