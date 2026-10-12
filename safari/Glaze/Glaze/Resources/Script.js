// The app calls these: showInstall() outside Applications, showGuide() inside, then show(enabled) every second.
function showInstall() {
  document.body.dataset.view = 'install';
}

function showGuide() {
  document.body.dataset.view = 'guide';
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
  document.querySelector('.install-button').textContent = 'Install Glaze';
};

for (const el of document.querySelectorAll('.settings-name')) el.textContent = 'Preferences';

document.querySelector('.install-button').addEventListener('click', (event) => {
  event.target.disabled = true;
  event.target.textContent = 'Installing…';
  webkit.messageHandlers.controller.postMessage('install');
});

document.querySelector('.open-preferences').addEventListener('click', () => {
  webkit.messageHandlers.controller.postMessage('open-preferences');
});
