// PKCE (RFC 7636) and the redirect check for calendar sign-in (parity spike S3). Pure: no endpoints,
// no client IDs, no requests. Nothing loads it yet; W13 does, from the service worker only.
const GZ_OAUTH = (() => {
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const random = () => b64url(crypto.getRandomValues(new Uint8Array(32))); // 43 characters, 256 bits
  const challenge = async (verifier) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  // The URL the provider redirected to: its code when `state` is ours, else an Error whose `.error` is the
  // OAuth error (consent_required, interaction_required, access_denied, …) or 'state'.
  const code = (redirect, state) => {
    const u = new URL(redirect);
    const p = new URLSearchParams(u.search || u.hash.slice(1)); // Microsoft can answer in the fragment
    const fail = (error, description = '') => Object.assign(new Error(description || error), { error });
    if (p.get('state') !== state) throw fail('state');
    if (p.get('error')) throw fail(p.get('error'), p.get('error_description') || '');
    if (!p.get('code')) throw fail('code');
    return p.get('code');
  };
  return { random, challenge, code };
})();
if (typeof module !== 'undefined') module.exports = GZ_OAUTH;
