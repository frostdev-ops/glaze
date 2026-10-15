// The app calls these: showInstall(installed) outside Applications, showGuide(update) inside, then show(enabled) every second.
// The iOS app calls only show(enabled), and only on iOS 26.2 or later.
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
    `Updated from ${update.from}. Reload your Blackboard and Canvas tabs to get the new version.`;
}

function useSettingsName() {
  // macOS 12's Safari calls its settings "Preferences".
  for (const el of document.querySelectorAll('.settings-name')) el.textContent = 'Settings';
}

function show(enabled) {
  document.body.classList.toggle('state-on', enabled === true);
}

window.showError = function (message) {
  document.querySelector('.error').textContent = message;
  for (const button of document.querySelectorAll('button')) button.disabled = false;
  document.querySelector('.install-button').textContent = installLabel;
};

for (const el of document.querySelectorAll('.settings-name')) el.textContent = 'Preferences';

// The iOS app's page (Glaze iOS/Resources/Main.html) has no installer.
document.querySelector('.install-button')?.addEventListener('click', (event) => {
  const open = document.body.dataset.install === 'open';
  event.target.disabled = true;
  event.target.textContent = open ? 'Opening…' : installLabel === 'Update Glaze' ? 'Updating…' : 'Installing…';
  webkit.messageHandlers.controller.postMessage(open ? 'open-installed' : 'install');
});

document.querySelector('.open-preferences').addEventListener('click', () => {
  webkit.messageHandlers.controller.postMessage('open-preferences');
});
