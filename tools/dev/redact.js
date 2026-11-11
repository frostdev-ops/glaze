// What tools/dev/canvas-shots.js --html takes out of a captured page before it becomes a test fixture: anything that
// would let someone act as the student. Plain node, no dependencies, so test/courses/canvas-fixtures.test.js can check it.

// Query values that unlock something: file verifiers, tokens, API keys, OAuth codes and secrets, and what signs a URL (S3's
// X-Amz-*, CloudFront's Policy, Signature and Key-Pair-Id). The whole value goes. In a plain query it ends at the next
// & (an encoded %26 there is part of the value); inside an encoded URL (a file preview's ?url=…%3Fverifier%3D…) at %26.
const NAMES = '(?:verifier|sf_verifier|access_token|token|session_token|authenticity_token|_csrf_token|sesskey|logintoken|api_key|key|code|client_secret|x-amz-signature|x-amz-credential|x-amz-security-token|policy|signature|key-pair-id)';
const SECRET_PARAM = new RegExp(`([?&](?:amp;)?${NAMES}=)[^&"'\\s<#]+`, 'gi');
const SECRET_ENCODED = new RegExp(`((?:%3F|%26)${NAMES}%3D)(?:(?!%26)[^&"'\\s<#])+`, 'gi');
// Feed addresses (calendar .ics, announcement and discussion Atom) carry a capability in their path, not a parameter.
// A topic's feed address has the topic's id before the code (/feeds/topics/<id>/enrollment_<code>.atom): the id stays.
const FEED = /((?:\/|%2F)feeds(?:\/|%2F)(?:topics(?:\/|%2F)[\w-]+|[\w-]+)(?:\/|%2F))[\w-]+((?:\.|%2E)(?:atom|ics|rss|xml))?/gi;
// The CSRF token in the page head and the authenticity token in a form: the tag's value goes, in either attribute order.
// An empty value (the capture already emptied it) stays as it is.
const META = /<meta\b[^>]*>/gi;
const INPUT = /<input\b[^>]*>/gi;
const quoted = (attribute, tag) => tag.replace(new RegExp(`(\\b${attribute}=)(?:(["'])[^"']+\\2|[^\\s"'>]+)`, 'i'), (all, name, quote) => `${name}${quote || '"'}REDACTED${quote || '"'}`);
// Moodle's M.cfg and Canvas's ENV.current_user, as JSON in a script: the session key, and who the student is.
const SESSKEY = /("sesskey"\s*:\s*)"[^"]+"/g;
const IDENTITY = /("(?:email|login_id|sis_user_id)"\s*:\s*)(?:"(?:\\.|[^"\\])+"|\d+)/g;
const BEARER = /(Authorization[\s"':=,]{1,6}Bearer\s+)[^\s"'<&]+/gi;
const JWT = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+/g;
// Inlined pictures are bytes, not markup: dropped.
const DATA_URI = /(data:[\w/+.-]+;base64,)[A-Za-z0-9+/=]{200,}/g;

const redact = (html) => html
  .replace(SECRET_PARAM, '$1REDACTED')
  .replace(SECRET_ENCODED, '$1REDACTED')
  .replace(FEED, '$1REDACTED$2')
  .replace(META, (tag) => /\bname=["']?csrf-token["']?/i.test(tag) ? quoted('content', tag) : tag)
  .replace(INPUT, (tag) => /\bname=["']?authenticity_token["']?/i.test(tag) ? quoted('value', tag) : tag)
  .replace(SESSKEY, '$1"REDACTED"')
  .replace(IDENTITY, '$1"REDACTED"')
  .replace(BEARER, '$1REDACTED')
  .replace(JWT, 'REDACTED_JWT')
  .replace(DATA_URI, '$1');

// A fixture as written to disk: its provenance note (which names the captured address) and the page, scrubbed together.
const SEEDS = { canvas: 'the local Canvas (seed: ~/Projects/canvas-lms/glaze/seed.rb)', moodle: 'the local Moodle (seed: ~/Projects/moodle-dev/seed.php)' };
const fixture = (url, html, lms = 'canvas') => redact(`<!-- Glaze test fixture: ${url} on ${SEEDS[lms]}, rendered DOM after load. Made by tools/dev/canvas-shots.js --html; scripts emptied, tokens redacted, repeated rows trimmed. -->\n${html}`);

module.exports = { redact, fixture };
