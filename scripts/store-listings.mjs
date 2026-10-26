// Store listing text: store/listing*.md for the shared summary, description and release notes, store/firefox*.md for
// Firefox privacy, and store/app-store*.md for Apple. Everything is checked before a release builds or sends anything.
import fs from 'node:fs';
import path from 'node:path';

// "NEW IN <version>" in each language heads that version's notes in a listing's "## Release notes".
export const LANGUAGES = {
  en: { amoLocale: 'en-US', appleLocale: 'en-US', newIn: 'NEW IN', privacyHeading: 'PRIVACY' },
  de: { amoLocale: 'de', appleLocale: 'de-DE', newIn: 'NEU IN', privacyHeading: 'DATENSCHUTZ' },
  es: { amoLocale: 'es-ES', appleLocale: 'es-ES', newIn: 'NOVEDADES DE', privacyHeading: 'PRIVACIDAD' },
  fr: { amoLocale: 'fr', appleLocale: 'fr-FR', newIn: 'NOUVEAUTÉS DE LA VERSION', privacyHeading: 'CONFIDENTIALITÉ' },
  nl: { amoLocale: 'nl', appleLocale: 'nl-NL', newIn: 'NIEUW IN', privacyHeading: 'PRIVACY' },
  'pt-BR': { amoLocale: 'pt-BR', appleLocale: 'pt-BR', newIn: 'NOVO NA', privacyHeading: 'PRIVACIDADE' },
};
const suffix = lang => lang === 'en' ? '' : `-${lang}`;
const LIMITS = {
  chrome: { label: 'the Chrome Web Store', summary: ['short summary', 132], description: ['description', 16000] },
  firefox: { label: 'AMO', summary: ['summary', 250], description: ['description', 15000], notes: ['release notes', 3000] },
  apple: {
    label: 'the App Store', name: ['name', 30], subtitle: ['subtitle', 30], promotionalText: ['promotional text', 170],
    keywords: ['keywords', 100], description: ['description', 4000], whatsNew: ["What's New", 4000],
  },
};
// Apple rejects a listing that names another platform.
const OTHER_BROWSERS = /\b(?:Chrome|Chromium|Firefox|Android|Microsoft Edge)\b/;

// "## Heading (limit)" sections: the text after a heading, up to the next one.
function sections(text) {
  const result = {};
  for (const part of text.split(/^## /m).slice(1)) {
    const [heading, ...body] = part.split('\n');
    result[heading.replace(/\s*\(.*$/, '').trim().toLowerCase()] = body.join('\n').trim();
  }
  return result;
}
// A heading inside a description or the notes is a line in capitals, like "YOUR LOOK" or "NEW IN 3.3.8".
const isHeading = line => line.trim() && !line.startsWith('•') && line === line.toUpperCase() && /\p{L}/u.test(line);
const releaseLabel = new RegExp(`^(?:#{1,6}\\s+)?(?:${Object.values(LANGUAGES).map(({ newIn }) => newIn).join('|')}|FROM|AUS|DE LA VERSION|DE|UIT|DA)\\s+\\d+\\.\\d+(?:\\.\\d+)?$`, 'i');
const isRelease = line => {
  const heading = line.trim();
  return releaseLabel.test(heading) || (isHeading(heading) && /\s\d+\.\d+(?:\.\d+)?$/.test(heading));
};
// "• Safari: …" is about one browser and belongs only in that browser's store; other bullets go everywhere.
const forBrowser = (text, browser) => text.split('\n').filter(line => {
  const label = /^•\s*(Chrome|Firefox|Safari)\s*:/.exec(line);
  return !label || label[1] === browser;
}).join('\n');
function block(text, heading) {
  const lines = text.split('\n'), start = lines.indexOf(heading);
  if (start < 0) return null;
  const end = lines.findIndex((line, i) => i > start && isHeading(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}
const amoDescription = description => forBrowser(description, 'Firefox').replace(/\n{3,}/g, '\n\n').trim();

// read(file) returns a repository file's text (a committed one, for a release). Throws once, naming every problem.
export function readListings(read, version, stores = ['chrome', 'firefox', 'apple']) {
  const problems = [], listings = {};
  const check = (file, store, text) => {
    const limits = LIMITS[store];
    for (const [field, value] of Object.entries(text)) {
      const [name, max] = limits[field];
      if (store === 'apple' && field === 'promotionalText' && !value) continue;
      const bytes = store === 'apple' && field === 'keywords';
      const length = value ? (bytes ? Buffer.byteLength(value, 'utf8') : value.length) : 0;
      if (!value) problems.push(`${file}: ${name} is missing`);
      else if (length > max) problems.push(`${file}: ${name} is ${length} ${bytes ? 'bytes' : 'characters'}; ${limits.label} allows ${max}`);
      if (store === 'apple' && OTHER_BROWSERS.test(value || '')) problems.push(`${file}: ${name} names another browser (${OTHER_BROWSERS.exec(value)[0]})`);
      if (store === 'firefox' && field !== 'summary' && /[*_`]|^\s*(?:#|>|[-+] |\d+\. )/m.test(value || '')) problems.push(`${file}: ${name} has Markdown that AMO would render`);
      if (store === 'firefox' && /\b(?:Chrome|Chromium|Safari|Microsoft Edge)\b/i.test(value || '')) problems.push(`${file}: ${name} names another browser`);
    }
  };
  for (const [lang, codes] of Object.entries(LANGUAGES)) {
    const entry = listings[lang] = { lang, ...codes };
    const file = `store/listing${suffix(lang)}.md`, heading = `${codes.newIn} ${version}`;
    const text = sections(read(file));
    const chrome = { summary: text['short summary'], description: text['detailed description'] };
    // The stores show each version's notes on their own, so the description has none.
    const release = (chrome.description || '').split('\n').find(isRelease);
    if (release) problems.push(`${file}: the detailed description has release notes ("${release}"); they go in ## Release notes`);
    const notes = text['release notes'] && block(text['release notes'], heading);
    if (!notes) problems.push(`${file}: no "${heading}" block in ## Release notes`);
    if (stores.includes('chrome')) { entry.chrome = chrome; check(file, 'chrome', chrome); }
    if (stores.includes('firefox') && notes) {
      const firefoxFile = `store/firefox${suffix(lang)}.md`, privacy = sections(read(firefoxFile)).privacy;
      const paragraphs = (chrome.description || '').split('\n\n'), index = paragraphs.indexOf(codes.privacyHeading);
      if (index < 0 || !paragraphs[index + 1]) problems.push(`${file}: no ${codes.privacyHeading} paragraph`);
      if (!privacy) problems.push(`${firefoxFile}: privacy is missing`);
      if (index >= 0 && privacy) paragraphs[index + 1] = privacy;
      entry.firefox = { summary: chrome.summary, description: amoDescription(paragraphs.join('\n\n')), notes: forBrowser(notes, 'Firefox') };
      check(file, 'firefox', entry.firefox);
    }
    if (stores.includes('apple')) {
      const appleFile = `store/app-store${suffix(lang)}.md`, source = sections(read(appleFile));
      const { name, subtitle, keywords, description } = source, promotionalText = source['promotional text'];
      entry.apple = { name, subtitle, promotionalText, keywords, description };
      if (notes) entry.apple.whatsNew = forBrowser(notes, 'Safari');
      check(appleFile, 'apple', entry.apple);
    }
  }
  if (problems.length) throw new Error(`Store listings need fixing before a release:\n  ${problems.join('\n  ')}`);
  return listings;
}

// The Chrome Web Store API has no listing method: these files are pasted into the dashboard, one per language.
export function writeChromeKit(dir, listings) {
  fs.mkdirSync(dir, { recursive: true });
  return Object.values(listings).map(({ lang, chrome }) => {
    const file = path.join(dir, `listing-${lang}.txt`);
    fs.writeFileSync(file, `Short summary\n\n${chrome.summary}\n\nDetailed description\n\n${chrome.description}\n`);
    return file;
  });
}

// One line per store and language: what would change, or "unchanged".
export function describeChanges(changes) {
  const lines = new Map();
  for (const { store, locale, field, action, detail } of changes) {
    const key = `${store} ${locale}`;
    if (!lines.has(key)) lines.set(key, []);
    if (action !== 'same') lines.get(key).push(`${field} ${action}${detail ? ` (${detail})` : ''}`);
  }
  return [...lines].map(([key, parts]) => `${key}: ${parts.length ? parts.join(', ') : 'unchanged'}`);
}
