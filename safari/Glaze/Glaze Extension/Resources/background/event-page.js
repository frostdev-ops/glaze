// Firefox and Safari run the background as an event page (tools/build/event-page.js): the manifest loads every script the
// worker imports, in order, before background/background.js, so importScripts has nothing left to load there.
globalThis.importScripts ??= () => {};
