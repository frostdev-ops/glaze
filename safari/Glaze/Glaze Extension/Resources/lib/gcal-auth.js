// Chrome's Google sign-in adapter. Firefox packaging replaces it with an unavailable adapter.
var GZ_GCAL_AUTH = globalThis.GZ_GCAL_AUTH || {
  token: (options) => chrome.identity.getAuthToken(options),
  drop: (token) => chrome.identity.removeCachedAuthToken({ token }),
  clear: () => chrome.identity.clearAllCachedAuthTokens(),
};
