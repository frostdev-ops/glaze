/// <reference path="../../../types/glaze.d.ts" />
// A badge with the course's initials on each course card, in a palette colour picked from its name.
const COLORS = ['accent', 'accent-hi', 'ok', 'warn'];
const initials = (name) => [...name.split(/\s+/).filter(Boolean).map((word) => [...word][0]).join('')].slice(0, 4).join('').toUpperCase() || '?';
const colorOf = (name) => COLORS[[...name].reduce((sum, ch) => sum + ch.codePointAt(0), 0) % COLORS.length];

glaze.cards.decorate((courses) => Object.fromEntries(courses.map((c) => [c.id, { badge: initials(c.name), accent: colorOf(c.name) }])));
