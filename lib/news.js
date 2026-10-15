// What's new: a few hand-written lines per version, shown once at the top of the editor after an
// update. Classic script; module.exports for node.
//
// Release step: notes key on the version that ships. '2.1' shows once manifest.json says 2.1 or
// 2.1.x, never before; `node --test` lists a todo while the newest notes are ahead of the manifest.
const GZ_NEWS = (() => {
  const NOTES = {
    '2.2': [
      "Glaze works on Canvas now, on your school's own address or on instructure.com.",
      "The extras come along, on Canvas's Modules, Assignments, Grades and To Do.",
      "Two Looks for Halloween, Graveyard and Pumpkin Patch, each with its own animated scene.",
    ],
    '2.1': [
      'About forty fonts, each shown in its own face. Headings and code can have their own.',
      'Theme codes: send your look to someone as one line of text, under Share.',
      'Grades on course cards, new-grade badges and a what-if calculator.',
      'A command palette (Ctrl+K or ⌘K), Download all for folders, and a backup of what you type.',
      'Dark documents, focus mode, and course tint.',
      'Search these settings: press / anywhere on this page.',
    ],
  };

  // Dotted versions, number by number: '2.1' is '2.1.0'.
  const cmp = (a, b) => {
    const x = String(a).split('.'), y = String(b).split('.');
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (+x[i] || 0) - (+y[i] || 0);
      if (d) return d;
    }
    return 0;
  };

  // [version, lines] newer than `last` and not past `now`, newest first. Nothing seen and no
  // settings ever saved is a fresh install: nothing to say.
  const unseen = (now, last, used, notes = NOTES) => (!last && !used ? [] : Object.keys(notes)
    .filter((v) => (!last || cmp(v, last) > 0) && cmp(v, now) <= 0)
    .sort((a, b) => cmp(b, a))
    .map((v) => [v, notes[v]]));

  const now = () => chrome.runtime.getManifest().version;
  // Settings ever saved = a `version` key in sync storage (every save writes one). A fresh install
  // is marked seen here, so changing a setting first can't make 2.1's notes show up later.
  const check = (done) => chrome.storage.local.get('newsSeen', (l) => chrome.storage.sync.get('version', (s) => {
    if (!l?.newsSeen && !s?.version) seen();
    done(unseen(now(), l?.newsSeen, !!s?.version));
  }));
  const seen = () => chrome.storage.local.set({ newsSeen: now() });

  return { NOTES, cmp, unseen, check, seen };
})();

if (typeof module !== 'undefined') module.exports = GZ_NEWS;
