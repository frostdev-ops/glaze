// Google sign-in for Drive (lib/google.js): the OAuth clients of Google Cloud project glaze-511715 (1071735898350), the
// Picker's key, the scopes and the picker pages. Client ids and the browser key are public by design: the key is restricted
// in Google Cloud to the Picker API and the picker pages' referrers. A client a flow signs in with set to PLACEHOLDER
// makes the worker answer why: 'setup' (no Settings row, no oauth2 key or identity in the packages: scripts/oauth-manifest.js);
// the key or project number unset, only Pick does. Worker only; classic script, module.exports for node.
var GZ_GOOGLE_CONFIG = globalThis.GZ_GOOGLE_CONFIG || {
  // "Chrome extension" client of store item jmmaeoajomodnbnlmdikjooalmcilooh, shared with Calendar sync: Google Chrome's
  // getAuthToken. The package writes it into the manifest's oauth2.client_id; an unpacked copy signs in this way only when
  // its manifest holds the same id and Chrome gives it the store item's id.
  chrome: '1071735898350-o14e1vjmrvkmrfl8bb8e8qbcpue5i5qq.apps.googleusercontent.com',
  // "Web application" client: launchWebAuthFlow's implicit flow on Edge, Brave, other Chromium browsers and Firefox. Its
  // redirect URIs: https://jmmaeoajomodnbnlmdikjooalmcilooh.chromiumapp.org/ (the store item, which Edge and Brave install
  // too) and Firefox's http://127.0.0.1/mozoauth2/3a273a94baf709b1c4095e46230f7ab56b7ad073.
  web: '1071735898350-r3pnkbe9c38i9j5lvkggf84lfhb6pasj.apps.googleusercontent.com',
  // "iOS" client, bundle io.frostdev.Glaze: Safari, through the extension's handler and the app (lib/google.js native). Its callback
  // scheme: com.googleusercontent.apps.1071735898350-h5i3v4abnj2o4btvn270vq9689585eeh.
  ios: '1071735898350-h5i3v4abnj2o4btvn270vq9689585eeh.apps.googleusercontent.com',
  // The Picker's browser API key and the Cloud project number (Picker setAppId, which lets drive.file open what's picked).
  apiKey: 'AIzaSyAJaEwp76_apj8iixjxdeqGcrYNDJuRg-A',
  appId: '1071735898350',
  // Safari: true once the owner has signed in through the app in real Safari (lib/google.js native).
  native: false,
  scopes: ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'],
  // The picker page, then its copy: Glaze works without frostdev.io.
  picker: ['https://frostdev.io/glaze/drive-picker/', 'https://frostdev-ops.github.io/glaze-drive-picker/'],
};
if (typeof module !== 'undefined') module.exports = GZ_GOOGLE_CONFIG;
