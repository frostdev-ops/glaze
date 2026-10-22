// A Look's nav layout (x.nav): its cleaner, and the one ordered, grouped model every site's rail draws
// (features/nav.js). Site-neutral and pure: the sites only say which native items they have.
var GZ_NAV_LAYOUT = globalThis.GZ_NAV_LAYOUT || (() => {
  const N = typeof GZ_NAV_ITEMS === 'undefined' ? require('./nav-items.js') : GZ_NAV_ITEMS;
  // One name per kind of native item across the LMSes, so a Look hides "calendar" everywhere. Ultra's names come first.
  const NATIVE = [...N.NATIVE, 'dashboard', 'home', 'history', 'help', 'groups', 'admin', 'notifications'];
  // Glaze's own English name for each, the same on every page: what a mod is told the bar holds (features/mods.js, the
  // nav.items event), never what the page or the student calls it. None for the account item, whose label is the
  // student's name, nor for Glaze's settings item in Ultra's own nav, which the bar never shows.
  const NAMES = { 'institution-page': 'Institution page', stream: 'Activity', course: 'Courses', organization: 'Organizations', calendar: 'Calendar', messages: 'Messages', grades: 'Grades',
    tools: 'Tools', logout: 'Sign out', dashboard: 'Dashboard', home: 'Site home', history: 'History', help: 'Help', groups: 'Groups', admin: 'Admin', notifications: 'Notifications' };
  // What only Glaze's own items may look like, so nothing a mod adds to the bar passes for one: the icons of Glaze's
  // settings and of signing out, and those two items' names in each of Glaze's languages (i18n/*.js, which a test keeps
  // these in step with) and the LMSes' usual words for signing out. reserved(label, also) compares them, and `also` (the
  // names this page gives those items), without case, accents, spaces, punctuation, symbols or invisible characters.
  const RESERVED = { icons: ['glaze', 'signout'],
    names: ['Glaze settings', 'Glaze-Einstellungen', 'Ajustes de Glaze', 'Réglages de Glaze', 'Glaze-instellingen', 'Configurações do Glaze', 'Sign out', 'Abmelden', 'Cerrar sesión', 'Se déconnecter', 'Uitloggen', 'Sair', 'Log out'] };
  // Only reserved-name comparisons use this small Latin-lookalike skeleton; ordinary mod labels keep their script.
  // Compatibility normalization runs before folding case (mathematical/fullwidth capitals can normalize to Latin).
  const CONFUSABLE = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ј: 'j', ѕ: 's', ӏ: 'l',
    α: 'a', ε: 'e', ο: 'o', ρ: 'p', χ: 'x', ι: 'i', κ: 'k', ν: 'v', τ: 't' };
  const fold = (v) => (typeof v === 'string' ? v.normalize('NFKC').toLowerCase().normalize('NFKD').replace(/[аеорсхуіјѕӏαεορχικντ]/gu, (c) => CONFUSABLE[c]).replace(/[\p{M}\s\p{P}\p{S}\p{Cc}\p{Cf}]+/gu, '') : '');
  const reserved = (label, also = []) => { const f = fold(label); return !!f && [...RESERVED.names, ...also].some((n) => fold(n) === f); };
  // Shared Looks have no LMS to ask yet. Match the native names in every shipped language, using the same comparison
  // as reserved controls; tests keep this small table in step with the catalogues.
  const NATIVE_NAMES = {
    'institution-page': ['Institution page', 'Institutionsseite', 'Página de la institución', "Page de l’établissement", "Page de l'établissement", 'Instellingspagina', 'Página da instituição'],
    stream: ['Activity', 'Aktivität', 'Actividad', 'Activité', 'Activiteit', 'Atividade'],
    course: ['Courses', 'Kurse', 'Cursos', 'Cours', 'Cursussen'],
    organization: ['Organizations', 'Organisationen', 'Organizaciones', 'Organisations', 'Organisaties', 'Organizações'],
    calendar: ['Calendar', 'Kalender', 'Calendario', 'Calendrier', 'Agenda', 'Calendário'],
    messages: ['Messages', 'Nachrichten', 'Mensajes', 'Berichten', 'Mensagens'],
    grades: ['Grades', 'Noten', 'Calificaciones', 'Notes', 'Cijfers', 'Notas'],
    tools: ['Tools', 'Herramientas', 'Outils', 'Hulpmiddelen', 'Ferramentas'],
    dashboard: ['Dashboard', 'Tablero', 'Tableau de bord', 'Painel'],
    home: ['Site home', 'Startseite der Website', 'Inicio del sitio', 'Accueil du site', 'Startpagina van de site', 'Página inicial do site'],
    history: ['History', 'Verlauf', 'Historial', 'Historique', 'Geschiedenis', 'Histórico'],
    help: ['Help', 'Hilfe', 'Ayuda', 'Aide', 'Ajuda'],
    groups: ['Groups', 'Gruppen', 'Grupos', 'Groupes', 'Groepen'],
    admin: ['Admin', 'Verwaltung', 'Administración', 'Administration', 'Beheer', 'Administração'],
    notifications: ['Notifications', 'Benachrichtigungen', 'Notificaciones', 'Meldingen', 'Notificações'],
    profile: ['Your account', 'Dein Konto', 'Tu cuenta', 'Ton compte', 'Je account', 'Sua conta'],
    logout: RESERVED.names,
  };
  const mimics = (label, ids) => ids.some((id) => (NATIVE_NAMES[id] || []).some((n) => fold(label) === fold(n)));
  // The one rule for a link a mod's code supplies (an item's href, a layout's link): an http(s) page of `origin`, the
  // school's site the tab is on, with no credentials, at most 512 characters. → its address, resolved against that site,
  // or '' when it isn't one. Anywhere else, a mod could carry what it read (grades, say) off the site in the address,
  // with no network permission.
  const onSite = (v, origin) => {
    if (typeof v !== 'string' || !v || v.length > 512 || typeof origin !== 'string' || !origin) return '';
    try { const u = new URL(v, `${origin}/`); return u.origin === origin && /^https?:$/.test(u.protocol) && !u.username && !u.password && u.href.length <= 512 ? u.href : ''; } catch { return ''; }
  };
  // A cleaned layout's links that aren't pages of `origin` (every one, given none).
  const offsite = (nav, origin) => (nav?.links || []).filter((l) => !onSite(l.u, origin));
  // Where a worn Look's link goes, for the bar to say: its host when it leaves `origin` (every one, given none), '' for a
  // page of the school's site. A Look is someone else's, so its "Grades" must not pass for the school's own.
  const away = (l, origin) => { if (onSite(l?.u, origin)) return ''; try { return new URL(l.u).hostname; } catch { return ''; } };
  const PLACES = ['left', 'top', 'bottom', 'dock'];
  const CANVAS = { profile: 'profile', dashboard: 'dashboard', courses: 'course', calendar: 'calendar', conversations: 'messages', history: 'history', help: 'help', accounts: 'admin', groups: 'groups' };
  const MOODLE = [[/\/my\/courses\.php$/, 'course'], [/\/my\/(index\.php)?$/, 'dashboard'], [/\/admin\/search\.php$/, 'admin'], [/\/calendar\/view\.php$/, 'calendar'], [/\/message\/index\.php$/, 'messages'], [/\/grade\/report\/overview\/index\.php$/, 'grades']];
  const LINK = /^link:([a-z0-9]{12})$/;
  const KEYS = ['place', 'groups', 'hidden', 'links', 'icons'];
  const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v, max) => [...v.replace(/[\p{Cc}\p{Bidi_Control}]/gu, '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');

  // Native ids each site's rail reads off its own markup.
  const canvas = (id) => CANVAS[/^global_nav_([a-z]+)_link$/.exec(id || '')?.[1]] || '';
  const moodle = (href) => {
    if (typeof href !== 'string' || !href || href.startsWith('#')) return '';
    let u;
    try { u = new URL(href, 'https://nav.invalid'); } catch { return ''; }
    // Site home is the site's root, which may sit in a folder: Moodle links it with redirect=0 to skip the Dashboard.
    const home = /\/(index\.php)?$/.test(u.pathname) && (/^\/(index\.php)?$/.test(u.pathname) || u.searchParams.get('redirect') === '0');
    return MOODLE.find(([re]) => re.test(u.pathname))?.[1] || (home ? 'home' : '');
  };

  // clean(raw) -> nav | null, idempotent. Keys left out stay out (codes must decode to exactly what was encoded);
  // a wrong type or an unknown key refuses the whole part, entries that don't fit are dropped.
  const clean = (raw) => {
    if (!obj(raw) || Object.keys(raw).some((k) => !KEYS.includes(k))) return null;
    const out = {};
    if ('place' in raw) { if (!PLACES.includes(raw.place)) return null; out.place = raw.place; }
    const links = [];
    if ('links' in raw) {
      if (!Array.isArray(raw.links)) return null;
      for (const v of raw.links.slice(0, 100)) {
        if (!obj(v) || Object.keys(v).some((k) => !['id', 'n', 'u', 'i'].includes(k))) return null;
        const l = N.link(v);
        if (l && !links.some((x) => x.id === l.id)) links.push({ id: l.id, n: l.n, u: l.u, i: l.i });
        if (links.length === 8) break;
      }
      out.links = links;
    }
    const ids = new Set([...NATIVE, ...links.map((l) => `link:${l.id}`), ...N.WIDGETS.map((w) => `w:${w}`)]);
    let hidden = [];
    if ('hidden' in raw) {
      if (!Array.isArray(raw.hidden)) return null;
      hidden = [...new Set(raw.hidden.filter((id) => NATIVE.includes(id) && id !== 'glaze'))];
      out.hidden = hidden;
    }
    if ('groups' in raw) {
      if (!Array.isArray(raw.groups)) return null;
      const placed = new Set(hidden);
      out.groups = [];
      for (const g of raw.groups.slice(0, 6)) {
        if (!obj(g) || Object.keys(g).some((k) => !['label', 'items'].includes(k)) || ('label' in g && typeof g.label !== 'string') || !Array.isArray(g.items)) return null;
        const group = {};
        const label = 'label' in g ? text(g.label, 24) : '';
        if (label) group.label = label;
        group.items = [];
        for (const id of g.items) if (ids.has(id) && !placed.has(id)) { placed.add(id); group.items.push(id); }
        out.groups.push(group);
      }
    }
    if ('icons' in raw) {
      if (!obj(raw.icons)) return null;
      out.icons = Object.fromEntries(Object.entries(raw.icons).filter(([id, i]) => (NATIVE.includes(id) || (LINK.test(id) && ids.has(id))) && N.ICONS.includes(i)));
    }
    return Object.keys(out).length ? out : null;
  };

  // resolve(nav, present) -> [{ key, kind, id, label?, icon? }]: what the rail shows, in order. present: the native ids
  // this page has, in their own order. Grouped items come first, a group's label before them (left out when none of its
  // items are on this page); what no group names follows in the page's order, then the links. Widgets show only where a
  // group puts them. Hidden items never show; Glaze's settings item always does.
  const resolve = (nav, present = []) => {
    const out = [], used = new Set(), hide = new Set(nav?.hidden || []), icons = nav?.icons || {}, links = nav?.links || [];
    const entry = (id) => {
      if (used.has(id) || hide.has(id)) return null;
      const link = LINK.exec(id)?.[1];
      if (link) return links.some((l) => l.id === link) ? { key: id, kind: 'link', id: link } : null;
      if (id.startsWith('w:')) return N.WIDGETS.includes(id.slice(2)) ? { key: id, kind: 'widget', id: id.slice(2) } : null;
      return present.includes(id) ? { key: id, kind: 'native', id, ...(icons[id] && { icon: icons[id] }) } : null;
    };
    (nav?.groups || []).forEach((g, at) => {
      const items = g.items.map(entry).filter(Boolean);
      for (const e of items) used.add(e.key);
      if (items.length && g.label) out.push({ key: `g:${at}`, kind: 'label', label: g.label });
      out.push(...items);
    });
    for (const id of [...present, ...links.map((l) => `link:${l.id}`)]) { const e = entry(id); if (e) { used.add(e.key); out.push(e); } }
    return out;
  };

  // The shape features/nav.js's rail already draws (navItems): a worn layout stands in for the student's own items.
  const rail = (nav) => ({
    links: (nav.links || []).map((l) => ({ ...l, i: nav.icons?.[`link:${l.id}`] || l.i, tab: false })),
    order: [], hidden: nav.hidden || [],
    widgets: N.WIDGETS.filter((w) => (nav.groups || []).some((g) => g.items.includes(`w:${w}`))).map((id) => ({ id, on: true, at: 'inline' })),
  });

  return { NATIVE, NAMES, RESERVED, PLACES, KEYS, clean, resolve, rail, canvas, moodle, reserved, mimics, onSite, offsite, away };
})();
if (typeof module !== 'undefined') module.exports = GZ_NAV_LAYOUT; else GZ_NAV_LAYOUT;
