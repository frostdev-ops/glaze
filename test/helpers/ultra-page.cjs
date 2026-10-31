// courses/ultra.js as a page's content world has it, for harnesses that require the module in node: its library, with
// page (the per-site stores) made for the stand-in page by makePage instead of from the browser's globals. env: any of
// makePage's (origin, fetch(url, init, prio), now, live, local, send, framed, todo, todoPrefs); fetch defaults to
// none (a store read asks it), storage to empty.
const U = require('../../extension/courses/ultra.js');

const ultraFor = (env = {}) => ({
  ...U,
  page: U.makePage({
    origin: () => 'https://lms.example.edu', now: () => Date.now(), live: () => true,
    fetch: () => Promise.reject(new Error('no fetch here')),
    local: { get: async () => ({}), set: async () => true }, send: async () => null, framed: () => null,
    todo: () => null, todoPrefs: () => null,
    ...env,
  }),
});

module.exports = { ultraFor };
