(() => {
  if (!/^https?:$/.test(location.protocol)) return;
  let installPrompt = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const card = document.createElement('section');
  card.className = 'settings-card install-card';
  card.innerHTML = '<div class="settings-card-heading"><span class="settings-icon" aria-hidden="true">↓</span><div><h3>Install Encrypted Notes</h3><p>Keep your workspace on your home screen.</p></div></div><button type="button" id="install-app">Install app</button><p id="install-app-help" role="status" aria-live="polite" hidden></p>';
  const target = document.querySelector('.settings-footnote');
  if (target) target.before(card);
  const button = card.querySelector('button'), help = card.querySelector('#install-app-help');
  function render() {
    button.hidden = standalone();
    card.querySelector('.settings-card-heading p').textContent = standalone() ? 'Installed · opens in its own app window.' : 'Keep your workspace on your home screen.';
    if (standalone()) help.hidden = true;
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; render();
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; button.hidden = true; help.hidden = false; help.textContent = 'Installed. Open Encrypted Notes from your home screen.'; });
  button.addEventListener('click', async () => {
    if (installPrompt) {
      const prompt = installPrompt; installPrompt = null;
      try { await prompt.prompt(); await prompt.userChoice; } catch (_) { showHelp(); }
    } else showHelp();
  });
  function showHelp() {
    help.hidden = false;
    help.textContent = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      ? 'In Safari, tap Share → Add to Home Screen → Add.'
      : 'In your browser menu, choose Install app or Add to Home screen. On desktop, use the install icon in the address bar.';
  }
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).then(registration => {
      function updateNotice() {
        if (!registration.waiting || !navigator.serviceWorker.controller) return;
        help.hidden = false;
        help.textContent = 'An app update is ready. Close all Encrypted Notes windows and reopen to update.';
      }
      updateNotice();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', updateNotice);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) registration.update().catch(() => {});
      });
    }).catch(error => console.warn('App installation unavailable:', error));
  }
})();
