// What scripts/canvas-shots.js --html takes out of a captured page before it becomes a test fixture: anything that
// would let someone act as the student. Plain node, no dependencies, so test/canvas-fixtures.test.js can check it.

// Query values that unlock something: file verifiers, tokens. The whole value goes. In a plain query it ends at the next
// & (an encoded %26 there is part of the value); inside an encoded URL (a file preview's ?url=…%3Fverifier%3D…) at %26.
const NAMES = '(?:verifier|sf_verifier|access_token|token|session_token|authenticity_token|_csrf_token|sesskey|logintoken)';
const SECRET_PARAM = new RegExp(`([?&](?:amp;)?${NAMES}=)[^&"'\\s<#]+`, 'gi');
const SECRET_ENCODED = new RegExp(`((?:%3F|%26)${NAMES}%3D)(?:(?!%26)[^&"'\\s<#])+`, 'gi');
// Feed addresses (calendar .ics, announcement and discussion Atom) carry a capability in their path, not a parameter.
const FEED = /((?:\/|%2F)feeds(?:\/|%2F)[\w-]+(?:\/|%2F))[\w-]+((?:\.|%2E)(?:atom|ics|rss|xml))?/gi;
const JWT = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+/g;
// Inlined pictures are bytes, not markup: dropped.
const DATA_URI = /(data:[\w/+.-]+;base64,)[A-Za-z0-9+/=]{200,}/g;

const redact = (html) => html
  .replace(SECRET_PARAM, '$1REDACTED')
  .replace(SECRET_ENCODED, '$1REDACTED')
  .replace(FEED, '$1REDACTED$2')
  .replace(JWT, 'REDACTED_JWT')
  .replace(DATA_URI, '$1');

// A fixture as written to disk: its provenance note (which names the captured address) and the page, scrubbed together.
const SEEDS = { canvas: 'the local Canvas (seed: ~/Projects/canvas-lms/glaze/seed.rb)', moodle: 'the local Moodle (seed: ~/Projects/moodle-dev/seed.php)' };
const fixture = (url, html, lms = 'canvas') => redact(`<!-- Glaze test fixture: ${url} on ${SEEDS[lms]}, rendered DOM after load. Made by scripts/canvas-shots.js --html; scripts emptied, tokens redacted, repeated rows trimmed. -->\n${html}`);

module.exports = { redact, fixture };
