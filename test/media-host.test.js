// The "public host only" rule for a Look's media address (lib/lookparts.js MEDIA.url, LOOK-12): no device, no local network.
// An extension cannot resolve a name before it fetches, so beyond the IP literals (which the URL parser writes in one form) the
// rule can only name what is known to point inward: the pseudo-TLDs for private use, the wildcard-DNS services whose names
// answer with the address written in them, and any name that has a private address written into its labels.
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../lib/lookparts.js');

const url = X.MEDIA.url;

test('every spelling of an IP address is refused, whatever the encoding', () => {
  for (const host of [
    '127.0.0.1', '127.1', '0x7f.1', '0x7f000001', '0177.0.0.1', '2130706433', '017700000001', '127.0.0.1.', '0', '0.0.0.0',
    '１２７．０．０．１', '%31%32%37.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '93.184.216.34', '3232235777',
    '[::1]', '[0:0:0:0:0:0:0:1]', '[::]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[fe80::1]', '[fd00::1]', '[2001:db8::1]', '[64:ff9b::7f00:1]',
  ]) assert.equal(url(`https://${host}/a.webm`), null, host);
});

test('wildcard-DNS names that answer with a private or loopback address are refused', () => {
  for (const host of [
    // The services themselves, whatever address they are asked for.
    '192-168-1-1.nip.io', '10.0.0.5.nip.io', 'app.127.0.0.1.nip.io', '8-8-8-8.nip.io', 'x.nip.io',
    '127-0-0-1.sslip.io', 'a.b.10.1.1.1.sslip.io', 'fe80--1.sslip.io', '192.168.0.1.xip.io', 'foo.traefik.me',
    'localtest.me', 'sub.localtest.me', 'a.b.localtest.me', 'lvh.me', 'app.lvh.me', 'vcap.me', 'x.lacolhost.com', 'x.local.gd', 'x.localho.st',
  ]) assert.equal(url(`https://${host}/a.webm`), null, host);
});

test('a private or loopback address written into a name, on any domain, is refused', () => {
  for (const host of [
    '192-168-1-1.example.com', '10-0-0-1.cdn.example.com', '172-16-0-9.example.org', '172-31-255-255.example.org', '169-254-169-254.example.com',
    '127-0-0-1.org.uk', '0-0-0-0.example.com', '100-64-0-1.example.com', 'host.10.20.30.40.example.com', 'x.192.168.0.1.example.net',
    'a-192-168-0-1-b.example.com', 'cdn-10-0-0-1.example.com', '192.168.1.1.example.com',
  ]) assert.equal(url(`https://${host}/a.webm`), null, host);
});

test('names for private use (reserved, or never delegated) are refused', () => {
  for (const host of ['printer.local', 'nas.internal', 'router.lan', 'hub.home.arpa', 'app.localhost', 'intranet.corp', 'files.corp', 'media.home', 'wiki.intranet', 'box.private', 'srv.localdomain']) {
    assert.equal(url(`https://${host}/a.webm`), null, host);
  }
});

test('ordinary public names still pass, digits and all', () => {
  for (const host of [
    'cdn.example.com', 'a.example.org', 'xn--bcher-kva.example', 'v10.cdn.example.com', '10.cdn.example.com', 'cdn1.example.com', 'my-10-1.cdn.example.com',
    '8-8-8-8.example.com', '93-184-216-34.example.com', '172-32-0-1.example.com', 'media-192.example.com', 'i.imgur.com', 'media.giphy.com',
    'nip.example.com', 'notnip.io.example.com', 'sslip.io.example.com', 'my-localtest.me.example.com', 'localtest.media.example.com', 'corp.example.com', 'home.example.com',
  ]) assert.equal(url(`https://${host}/a.webm`), `https://${host}/a.webm`, host);
});

test('a media Look part carrying such a host is refused whole', () => {
  for (const host of ['192-168-1-1.nip.io', 'localtest.me', '10-0-0-1.example.com']) {
    assert.equal(X.clean({ bg: { media: { type: 'video', src: `https://${host}/a.webm` } } }), null, host);
  }
  assert.ok(X.clean({ bg: { media: { type: 'video', src: 'https://cdn.example.com/a.webm' } } }));
});
