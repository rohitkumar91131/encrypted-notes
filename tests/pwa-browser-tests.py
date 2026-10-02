"""Check the real installable shell and encrypted guest-note offline persistence."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import json
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=str(ROOT), **kw)
    def do_GET(self):
        if self.path.split('?')[0] == '/': self.path = '/encrypted-notes.html'
        super().do_GET()
    def log_message(self, *a): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        context = browser.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
        context.route('https://**/*', lambda route: route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda d: d.dismiss())
        base = f'http://127.0.0.1:{server.server_port}'
        page.goto(base, wait_until='domcontentloaded')
        page.evaluate('navigator.serviceWorker.ready')
        page.wait_for_function('!!navigator.serviceWorker.controller')
        manifest = page.evaluate("fetch('/manifest.webmanifest').then(r=>r.json())")
        assert manifest['display'] == 'standalone' and manifest['start_url'] == '/'
        assert len(manifest['icons']) == 3
        cdp = context.new_cdp_session(page)
        result = cdp.send('Page.getAppManifest')
        assert not result['errors'], result['errors']
        installability = cdp.send('Page.getInstallabilityErrors')['installabilityErrors']
        print('Chrome installability:', installability)
        assert not [e for e in installability if e['errorId'] not in ('not-from-secure-origin', 'in-incognito', 'not-in-main-frame')], installability
        assert page.locator('#install-app').count() == 1
        page.locator('#install-app').evaluate('(el)=>el.click()')
        assert 'browser menu' in page.locator('#install-app-help').text_content()
        page.evaluate("window.dispatchEvent(new Event('beforeinstallprompt'))")
        # Use a real-shaped prompt to test the user-gesture install path.
        page.evaluate("""() => { const e = new Event('beforeinstallprompt'); e.prompt = async () => {window.promptCalled = true}; e.userChoice = Promise.resolve({outcome:'accepted'}); dispatchEvent(e); }""")
        page.locator('#install-app').evaluate('(el)=>el.click()')
        page.wait_for_function('window.promptCalled === true')
        page.wait_for_function("document.querySelector('#home-new-note') && !document.querySelector('#home-view').hidden")
        page.locator('#home-new-note').click()
        page.locator('#note-title').fill('Offline app check')
        page.locator('#editor [contenteditable=true]').first.fill('Encrypted offline text')
        page.wait_for_timeout(1800)
        cached = page.evaluate("caches.keys().then(async keys => (await Promise.all(keys.map(k=>caches.open(k).then(c=>c.keys())))).flat().map(r=>r.url))")
        assert any('/public/vendor/supabase.min.js' in url for url in cached)
        assert all(url.startswith(base) for url in cached), cached
        context.set_offline(True)
        page.reload(wait_until='domcontentloaded')
        page.wait_for_function("document.querySelector('#note-list').textContent.includes('Offline app check')")
        page.locator('#recent-grid').get_by_text('Offline app check', exact=True).click()
        page.wait_for_function("document.querySelector('#editor').textContent.includes('Encrypted offline text')")
        assert page.evaluate('!!window.supabase'), 'SDK must work without CDN'
        assert not errors, errors
        print('PASS: manifest, icon metadata, install help/prompt, shell caching, SDK offline, encrypted note survives offline reload; no browser errors')
        browser.close()
finally:
    server.shutdown()
