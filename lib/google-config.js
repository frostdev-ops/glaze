// Google sign-in for Drive (lib/google.js): the OAuth clients, the Picker's key and project, the scopes and the picker pages.
// Every PLACEHOLDER is a value the owner creates in Google Cloud. Until the ones a flow needs are real (GZ_GOOGLE.ready),
// the worker answers why: 'setup', Settings shows no Google Drive row, and the packages carry no Drive oauth2 key or
// identity permission (scripts/oauth-manifest.js). Worker only; classic script, module.exports for node.
var GZ_GOOGLE_CONFIG = globalThis.GZ_GOOGLE_CONFIG || {
  // "Chrome extension" client, tied to the store item's id: Google Chrome's getAuthToken. The package writes it into the
  // manifest's oauth2.client_id; an unpacked copy signs in this way only when its manifest holds the same id.
  chrome: 'PLACEHOLDER-chrome.apps.googleusercontent.com',
  // "Web application" client: launchWebAuthFlow's implicit flow on Edge, Brave, other Chromium browsers and Firefox.
  web: 'PLACEHOLDER-web.apps.googleusercontent.com',
  // "iOS" client: Safari, through the app (lib/google.js native; not wired yet).
  ios: 'PLACEHOLDER-ios.apps.googleusercontent.com',
  // The Picker's browser API key and the Cloud project number (Picker setAppId, which lets drive.file open what's picked).
  apiKey: 'PLACEHOLDER',
  appId: 'PLACEHOLDER',
  // Safari: true once the app answers 'google-auth' (lib/google.js native).
  native: false,
  scopes: ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'],
  // The picker page, then its copy: Glaze works without frostdev.io.
  picker: ['https://frostdev.io/glaze/drive-picker/', 'https://frostdev-ops.github.io/glaze-drive-picker/'],
};
if (typeof module !== 'undefined') module.exports = GZ_GOOGLE_CONFIG;
