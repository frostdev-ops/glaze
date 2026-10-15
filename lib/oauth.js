// PKCE (RFC 7636) and the redirect check for calendar sign-in (parity spike S3). Pure: no endpoints,
// no client IDs, no requests. Nothing loads it yet; W13 does, from the service worker only.
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
  const code = (redirect, state) => {
    const u = new URL(redirect);
    const p = new URLSearchParams(u.search || u.hash.slice(1)); // Microsoft can answer in the fragment
    const fail = (error, description = '') => Object.assign(new Error(description || error), { error });
    const keys = [...p.keys()];
    if (typeof state !== 'string' || !state || keys.length !== new Set(keys).size || p.get('state') !== state) throw fail('state');
    if (p.get('error')) throw fail(p.get('error'), p.get('error_description') || '');
    if (!p.get('code')) throw fail('code');
    return p.get('code');
  };
  return { random, challenge, code };
})();
if (typeof module !== 'undefined') module.exports = GZ_OAUTH;
