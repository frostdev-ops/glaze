// Native code supplies app details and refreshes extension status while this guide is active.
// Live extension status is available on iOS 26.2 or later.
let installLabel = 'Install Glaze';

// installed: null, or the Glaze already in Applications: {version, relation: 'older' | 'same' | 'newer', appStore}.
function showInstall(installed) {
  document.body.dataset.view = 'install';
  if (!installed) return;
  const note = document.querySelector('.install .note');
  if (installed.relation === 'older' && !installed.appStore) {
    installLabel = 'Update Glaze';
    note.textContent = `Replaces Glaze ${installed.version} in Applications. Your settings and Safari setup carry over.`;
  } else {
    // Nothing to install: open the copy that's there rather than replace it.
    installLabel = 'Open Glaze';
    document.body.dataset.install = 'open';
    note.textContent = installed.appStore
      ? 'Glaze from the App Store is already installed, and the App Store keeps it up to date.'
      : installed.relation === 'same'
        ? `Glaze ${installed.version} is already installed.`
        : `A newer Glaze (${installed.version}) is already installed.`;
  }
  document.querySelector('.install-button').textContent = installLabel;
}

// update: null, or {from, to} when the installer just replaced an older Glaze.
function showGuide(update) {
  document.body.dataset.view = 'guide';
  if (!update) return;
  document.body.classList.add('updated');
  document.querySelector('.guide h1').textContent = `Glaze is updated to ${update.to}`;
  document.querySelector('.guide header .note').textContent =
    `Updated from ${update.from}. Reload your Blackboard Ultra, Canvas and Moodle tabs to get the new version.`;
}

function useSettingsName() {
  // macOS 12's Safari calls its settings "Preferences".
  for (const el of document.querySelectorAll('.settings-name')) el.textContent = 'Settings';
}

function show(enabled) {
  document.body.classList.toggle('state-on', enabled === true);
  document.body.classList.toggle('state-unknown', enabled === null);
  const status = document.querySelector('.status');
  if (status) status.textContent = enabled === true ? '✓ Glaze is on in Safari'
    : enabled === false ? 'Glaze is off in Safari'
      : 'Safari’s extension status is unavailable. Check it in Settings.';
}

function configureApp(info) {
  document.body.dataset.channel = info.channel;
  document.querySelector('.app-version').textContent = `Glaze ${info.version}`;
  const updates = document.querySelector('.updates');
  updates.hidden = false;
  if (info.channel === 'dmg') {
    document.querySelector('.automatic-checks').checked = info.automaticChecks === true;
    document.querySelector('.automatic-checks').disabled = info.updaterAvailable !== true;
    document.querySelector('.automatic-downloads').checked = info.automaticDownloads === true;
    document.querySelector('.automatic-downloads').disabled = info.updaterAvailable !== true || info.automaticChecks !== true;
    document.querySelector('.check-updates').disabled = info.canCheck !== true;
    document.querySelector('.update-status').textContent = info.updateStatus || '';
  }
}

function setupCopied() {
  document.querySelector('.copy-status').textContent = 'Copied version, system and extension status. No school or coursework data is included.';
}

window.showError = function (message) {
  document.querySelector('.error').textContent = message;
  const button = document.querySelector('.install-button');
  if (button) { button.disabled = false; button.textContent = installLabel; }
};

for (const el of document.querySelectorAll('.settings-name')) el.textContent = 'Preferences';

// The iOS app's page (Glaze iOS/Resources/Main.html) has no installer.
document.querySelector('.install-button')?.addEventListener('click', (event) => {
  if (!event.isTrusted) return;
  const open = document.body.dataset.install === 'open';
  event.target.disabled = true;
  event.target.textContent = open ? 'Opening…' : installLabel === 'Update Glaze' ? 'Updating…' : 'Installing…';
  webkit.messageHandlers.controller.postMessage(open ? 'open-installed' : 'install');
});

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', (event) => {
    if (event.isTrusted) webkit.messageHandlers.controller.postMessage(button.dataset.action);
  });
}
for (const input of document.querySelectorAll('.update-preference')) {
  input.addEventListener('change', (event) => {
    if (event.isTrusted) webkit.messageHandlers.controller.postMessage({ action: input.dataset.preference, enabled: input.checked });
  });
}
