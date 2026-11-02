// MAIN world, only in the native Pearson opener. Preserve its click handler and pass its model straight through.
(() => {
  if (location.origin !== 'https://socket.pearsoned.com' || location.pathname !== '/uiservice/opener' || top === window || window.__gzPearsonLauncher) return;
  let config = null, adapter = null, native = null, frame = null, timer = 0, tries = 0, launched = false;
  const state = phase => document.dispatchEvent(new CustomEvent('glaze:pearson-launch-state', { detail: JSON.stringify({ channel: config?.channel, phase }) }));
  const route = function(model, target) {
    if (!config?.enabled || target !== '_blank' || !frame?.isConnected) return native.call(this, model, target);
    launched = true; frame.hidden = false; document.documentElement.setAttribute('data-gz-pearson-launch', 'active');
    state('active'); return native.call(this, model, frame.name);
  };
  const stop = () => {
    clearTimeout(timer); timer = 0;
    if (adapter?.getLaunchAction === route) adapter.getLaunchAction = native;
    // Taking off Glaze must not discard work already typed in Pearson. The native Blackboard Exit still closes it.
    if (!launched) { frame?.remove(); frame = null; document.documentElement.removeAttribute('data-gz-pearson-launch'); }
  };
  const start = () => {
    clearTimeout(timer); timer = 0;
    if (!config?.enabled || launched) return;
    const button = document.getElementById('btnOpenNewTab'), found = window.SocketExperienceNamespace?.Adapter?.LaunchAdapter;
    if (document.readyState === 'loading' || !button || !found?.getLaunchAction || button.disabled) {
      if (++tries < 100) timer = setTimeout(start, 100); else { stop(); state('native'); } return;
    }
    adapter = found; native = found.getLaunchAction;
    frame = document.createElement('iframe'); frame.id = 'gz-pearson-embedded'; frame.name = `gz-pearson:${config.channel}`;
    frame.title = 'Pearson'; frame.hidden = true; frame.setAttribute('allow', 'fullscreen; clipboard-write');
    frame.addEventListener('load', () => { if (launched && !document.hidden) frame.focus({preventScroll:true}); });
    // Register the named browsing context before Pearson calls window.open on the next task.
    document.body.append(frame); adapter.getLaunchAction = route;
    timer = setTimeout(() => {
      timer = 0;
      if (!config?.enabled || !frame.isConnected) return stop();
      button.click(); if (!launched) { stop(); state('native'); }
    }, 0);
  };
  document.addEventListener('glaze:pearson-launch-config', e => {
    let next; try { next = JSON.parse(e.detail); } catch { return; }
    if (!next || typeof next.enabled !== 'boolean' || typeof next.channel !== 'string' || !/^[\w-]{36}$/.test(next.channel)) return;
    if (config && config.channel !== next.channel && launched) return;
    config = next;
    if (!next.enabled) stop(); else if (!launched && !frame) { tries = 0; start(); } else if (launched) state('active');
  });
  addEventListener('pagehide', stop);
  addEventListener('pageshow', e => { if (e.persisted && config?.enabled) { if (launched) state('active'); else start(); } });
  window.__gzPearsonLauncher = true;
})();
