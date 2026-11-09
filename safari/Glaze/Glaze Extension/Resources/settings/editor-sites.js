// School access: grant, check, list and remove through the shared site API and worker. No settings-page state is owned here.
var GZ_SETTINGS_SITES = (() => {
  const mount = ({ t, $ = (q) => document.querySelector(q) }) => {
    // ---- Sites: the sites the student said yes to (background/background.js approved), each with Remove, which only the worker does.
    // Each LMS's own hosts (GZ_BUILT_IN) are Glaze's anyway, so they aren't listed.
    const KINDS = { canvas: 'Canvas', moodle: 'Moodle', ultra: 'Blackboard Ultra' };
    const siteSaid = (text) => { $('#site-status').textContent = text; };
    const renderSites = (r) => {
      const sites = new Map();
      for (const kind of Object.keys(KINDS)) for (const x of Array.isArray(r?.[kind]) ? r[kind] : []) {
        let u;
        try { u = new URL(String(x).replace(/\/\*$/, '')); } catch { continue; }
        const automatic = GZ_BUILT_IN(kind, u);
        if (u.protocol !== 'https:' || automatic) continue;
        sites.set(u.origin, [...new Set([...sites.get(u.origin) || [], t(KINDS[kind])])]);
      }
      $('#site-list').replaceChildren(...[...sites].sort(([a], [b]) => a.localeCompare(b)).map(([origin, kinds]) => {
        const host = new URL(origin).host;
        const name = Object.assign(document.createElement('span'), { className: 'name' });
        name.append(Object.assign(document.createElement('span'), { textContent: host, translate: false }), Object.assign(document.createElement('small'), { textContent: kinds.join(' · ') }));
        const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: t('Remove') });
        remove.setAttribute('aria-label', t('Remove {name}', { name: host }));
        remove.addEventListener('click', async (e) => {
          if (!e.isTrusted || remove.disabled) return;
          remove.disabled = true;
          const done = await chrome.runtime.sendMessage({ type: 'glaze:sites', op: 'remove', origin }).catch(() => null);
          if (!done?.ok) { remove.disabled = false; siteSaid(t('Not saved. Try again in a moment.')); return; }
          // And the browser's grant for it, where the student gave one for exactly this site (core/site.js handBack).
          const site = GZ_SITE.address(origin);
          if (site?.origin === origin) await GZ_SITE.handBack(site);
          siteSaid(t('Removed {site}. Glaze no longer runs there.', { site: host }));
          $('#heading-backup-sites').focus({ preventScroll: true });
        });
        const li = document.createElement('li');
        li.append(name, remove);
        return li;
      }));
      $('#site-empty').hidden = sites.size > 0;
    };
    // Add a site, the first screen's way (core/site.js allow): the browser's prompt from the submit itself, then the check;
    // a course site is listed with its LMS, anything else has its grant handed back, with the course sites nearby to pick.
    // Where Glaze holds every site (Safari), a school's own site is added from its pages' card instead.
    const addForm = $('#site-add'), addInput = $('#site-address'), addGo = $('#site-allow');
    addForm.hidden = !!chrome.runtime.getManifest().host_permissions?.includes('<all_urls>');
    let adding = false;
    const addSaid = (text = '', hosts = []) => {
      $('#site-error').textContent = text;
      $('#site-picks').replaceChildren(...hosts.map((h) => {
        const b = Object.assign(document.createElement('button'), { type: 'button', textContent: h });
        b.setAttribute('translate', 'no');
        b.addEventListener('click', (e) => { if (!e.isTrusted || adding) return; addInput.value = h; addSite(GZ_SITE.address(h)); });
        return b;
      }));
      $('#site-note').hidden = !text;
    };
    const addSite = (site) => {
      adding = true;
      addInput.readOnly = true;
      addGo.setAttribute('aria-busy', 'true');
      addSaid();
      siteSaid('');
      GZ_SITE.allow(site, { checking: () => siteSaid(t('Checking {host}', { host: site.host })) }).then((r) => {
        adding = false;
        addInput.readOnly = false;
        addGo.removeAttribute('aria-busy');
        siteSaid(r.state === 'done' ? t('Allowed {host}', { host: site.host }) : '');
        if (r.state === 'done') { addInput.value = ''; addInput.focus(); return; }
        if (r.state === 'refused') { addInput.focus(); return; }
        addSaid(t(r.state === 'none' ? 'No course site at {host}' : "Can't reach {host}", { host: site.host }), r.hosts);
        ($('#site-picks').children[0] || addInput).focus();
      });
    };
    addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!e.isTrusted || adding) return;
      const site = GZ_SITE.address(addInput.value);
      if (!site) { addSaid(t('Not a web address')); return; }
      addSite(site);
    });
    addInput.addEventListener('input', () => addSaid());
    const readSites = () => chrome.storage.local.get(Object.keys(KINDS), renderSites);
    readSites();
    chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && Object.keys(KINDS).some((k) => k in c)) readSites(); });

    return { read: readSites };
  };
  return { mount };
})();
