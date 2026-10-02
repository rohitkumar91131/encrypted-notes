"""Real WebAuthn PRF vault tests with Chrome's virtual platform authenticator."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright
import base64, json
ROOT = Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=str(ROOT), **kw)
    def do_GET(self):
        if self.path.split('?')[0] == '/': self.path = '/encrypted-notes.html'
        super().do_GET()
    def log_message(self, *a): pass
server = ThreadingHTTPServer(('127.0.0.1',0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
base = f'http://localhost:{server.server_port}'
VAULT = 'stillnote-device-lock-v1'
checks = []
def passed(name): checks.append(name); print('PASS:',name, flush=True)
def set_auth(context, page, prf=True):
    cdp = context.new_cdp_session(page)
    cdp.send('WebAuthn.enable', {'enableUI':False})
    result = cdp.send('WebAuthn.addVirtualAuthenticator', {'options':{
        'protocol':'ctap2', 'transport':'internal','hasResidentKey':True,
        'hasUserVerification':True,'isUserVerified':True,
        'automaticPresenceSimulation':True,'hasPrf':prf}})
    return cdp, result['authenticatorId']
def settings(page):
    page.locator('#settings').evaluate('(el)=>el.click()')
def gate_ready(page):
    page.wait_for_function("!!document.querySelector('#device-lock-gate') && !document.querySelector('#device-lock-gate').hidden && !document.querySelector('#device-unlock').disabled && document.querySelector('#device-lock-message').textContent.includes('Unlock to open')")
def enable(page):
    settings(page)
    page.locator('.device-backup-check input').check()
    page.locator('#device-enable').click()
try:
 with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1280,'height':900})
    context.route('https://**/*', lambda r:r.abort())
    context.route('**/pwa.js', lambda r:r.abort()) # Keep SW release/update testing separate.
    lock_source=(ROOT/'device-lock.js').read_text()+'''\nconst installLockForTest = window.installDeviceLock;window.installDeviceLock = options => {const lock=installLockForTest(options);window.lockForTest=lock;return lock;};'''
    context.route('**/device-lock.js', lambda r:r.fulfill(body=lock_source, content_type='application/javascript'))
    page=context.new_page(); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('dialog',lambda d:d.dismiss())
    cdp, authenticator=set_auth(context,page)
    page.goto(base,wait_until='domcontentloaded')
    page.wait_for_function("!!localStorage.getItem('stillnote-device-key') && !!document.querySelector('#device-enable')")
    recovery=page.evaluate("localStorage.getItem('stillnote-device-key')")
    extra=base64.b64encode(bytes(range(32))).decode()
    page.evaluate("raw=>localStorage.setItem('stillnote-master:test-account',raw)",extra)
    page.locator('#home-new-note').click()
    page.locator('#note-title').fill('Private biometric note')
    page.locator('#editor [contenteditable=true]').first.fill('Private encrypted content')
    page.wait_for_timeout(900)
    enable(page)
    try:
        page.wait_for_function("!!localStorage.getItem('stillnote-device-lock-v1')",timeout=20000)
    except Exception:
        print('Enable status:',page.locator('.device-lock-card [role=status]').text_content(),flush=True)
        raise
    vault=page.evaluate("localStorage.getItem('stillnote-device-lock-v1')")
    assert recovery not in vault and extra not in vault
    assert page.evaluate("localStorage.getItem('stillnote-device-key')") is None
    assert page.evaluate("localStorage.getItem('stillnote-master:test-account')") is None
    passed('real PRF registration, verified encrypted vault, every plaintext master key removed')
    later=base64.b64encode(bytes([77])*32).decode()
    page.evaluate("raw=>window.lockForTest.keyStore.setItem('stillnote-master:later-account',raw)",later)
    assert page.evaluate("localStorage.getItem('stillnote-master:later-account')") is None
    assert page.evaluate("window.lockForTest.keyStore.getItem('stillnote-master:later-account')")==later
    result=page.evaluate("""async raw=>{
        const original=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){if(key==='stillnote-device-lock-v1')throw new DOMException('full','QuotaExceededError');return original.call(this,key,value)};
        try{await window.lockForTest.keyStore.setItem('stillnote-master:later-account',raw);return 'unexpected success'}
        catch(error){return error.name}
        finally{Storage.prototype.setItem=original}
    }""",extra)
    assert result=='QuotaExceededError'
    assert page.evaluate("window.lockForTest.keyStore.getItem('stillnote-master:later-account')")==later
    passed('future account keys persist only inside vault; failed storage writes roll back safely')
    page.locator('#modal-cancel').click()
    for _ in range(2):
        page.reload(wait_until='domcontentloaded')
        try:page.wait_for_function("document.querySelector('#device-lock-gate').hidden && document.querySelector('#note-list').textContent.includes('Private biometric note')",timeout=8000)
        except Exception:
            print('Refresh diagnostics',page.evaluate("({nav:performance.getEntriesByType('navigation')[0]?.type})"),page.locator('#device-lock-message').text_content(),errors,flush=True);raise
        assert page.evaluate("sessionStorage.getItem('stillnote-refresh-unlock-v1')") is None
        assert page.evaluate("localStorage.getItem('stillnote-device-key')") is None
    passed('consecutive normal refreshes restore unlocked vault without another biometric prompt; refresh bridge is consumed')
    page.locator('#editor [contenteditable=true]').first.fill('Last edit before immediate lock')
    settings(page);page.locator('#device-lock-now').click()
    gate_ready(page)
    assert page.locator('.app').evaluate('(el)=>el.inert')
    assert page.locator('#editor').text_content()==''
    assert 'Private biometric note' not in page.locator('#note-list').text_content()
    assert page.evaluate("localStorage.getItem('stillnote-device-key')") is None
    passed('manual lock clears decrypted editor/list and blocks workspace access')
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path='/tmp/notes-fingerprint-lock-mobile.png')
    page.locator('#device-unlock').click()
    page.wait_for_function("document.querySelector('#device-lock-gate').hidden && document.querySelector('#note-list').textContent.includes('Private biometric note')")
    page.locator('#note-list .note-row').filter(has_text='Private biometric note').evaluate('(el)=>el.click()')
    assert 'Last edit before immediate lock' in page.locator('#editor').text_content()
    passed('real PRF unlock restores saved notes, including immediate pre-lock edits')
    # Backgrounding the app must trigger the same encrypted save and memory-clearing restart.
    page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))")
    gate_ready(page)
    page.locator('#device-unlock').click()
    page.wait_for_function("document.querySelector('#device-lock-gate').hidden && document.querySelector('#note-list').textContent.includes('Private biometric note')")
    passed('backgrounding locks automatically and fingerprint unlock still restores notes')
    page.clock.install()
    page.locator('#settings').evaluate('(el)=>el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))')
    page.clock.fast_forward(5 * 60 * 1000 + 1)
    gate_ready(page)
    page.evaluate("() => {window.realCredentialsGet = navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get = async()=> {throw new DOMException('cancelled','NotAllowedError')}}")
    page.locator('#device-unlock').click()
    page.wait_for_function("document.querySelector('#device-lock-message').textContent.includes('cancelled')")
    assert page.locator('.app').evaluate('(el)=>el.inert')
    page.evaluate("() => {navigator.credentials.get = window.realCredentialsGet}")
    page.locator('#device-unlock').click()
    page.wait_for_function("document.querySelector('#device-lock-gate').hidden && document.querySelector('#note-list').textContent.includes('Private biometric note')")
    passed('idle timeout locks; cancelled biometric verification cannot bypass lock')
    settings(page);page.locator('#device-lock-now').click();gate_ready(page)
    page.reload(wait_until='domcontentloaded');gate_ready(page)
    page.locator('summary').click()
    page.locator('#device-recovery').fill(base64.b64encode(bytes([99])*32).decode())
    page.get_by_role('button',name='Unlock with recovery key',exact=True).click()
    page.wait_for_function("document.querySelector('#device-lock-message').textContent.includes('did not unlock')")
    assert page.locator('.app').evaluate('(el)=>el.inert')
    passed('wrong recovery key cannot unlock or create a replacement master key')
    context.set_offline(True)
    page.locator('#device-recovery').fill(json.dumps({'format':'stillnote-recovery-v1','key':recovery}))
    page.get_by_role('button',name='Unlock with recovery key',exact=True).click()
    page.wait_for_function("document.querySelector('#device-lock-gate').hidden && document.querySelector('#note-list').textContent.includes('Private biometric note')")
    assert page.evaluate("localStorage.getItem('stillnote-device-key')") is None
    passed('recovery JSON unlocks offline without restoring plaintext master keys')
    context.set_offline(False)
    settings(page)
    page.evaluate("""() => {
        window.originalStorageSet=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){if(key==='stillnote-master:later-account')throw new DOMException('storage full during disable','QuotaExceededError');return window.originalStorageSet.call(this,key,value)};
    }""")
    page.locator('#device-disable').click()
    page.wait_for_function("document.querySelector('.device-lock-card [role=status]').textContent.includes('storage full')")
    assert page.evaluate("!!localStorage.getItem('stillnote-device-lock-v1')")
    assert page.evaluate("localStorage.getItem('stillnote-device-key')") is None
    assert page.evaluate("localStorage.getItem('stillnote-master:test-account')") is None
    page.evaluate("() => {Storage.prototype.setItem=window.originalStorageSet}")
    passed('failed disable removes partial plaintext copies and keeps the vault enabled')
    page.locator('#device-disable').click()
    page.wait_for_function("!localStorage.getItem('stillnote-device-lock-v1')")
    assert page.evaluate("localStorage.getItem('stillnote-device-key')")==recovery
    assert page.evaluate("localStorage.getItem('stillnote-master:test-account')")==extra
    assert page.evaluate("localStorage.getItem('stillnote-master:later-account')")==later
    passed('recovery can disable a lost passkey lock; all account/device keys restored safely')
    # A platform authenticator without PRF must leave the original vault untouched.
    cdp.send('WebAuthn.removeVirtualAuthenticator',{'authenticatorId':authenticator})
    cdp2, auth2=set_auth(context,page,False)
    page.locator('.device-backup-check input').check()
    page.locator('#device-enable').click()
    page.wait_for_function("document.querySelector('.device-lock-card [role=status]').textContent.includes('PRF')",timeout=20000)
    assert page.evaluate("localStorage.getItem('stillnote-device-lock-v1')") is None
    assert page.evaluate("localStorage.getItem('stillnote-device-key')")==recovery
    passed('unsupported PRF fails safely and preserves notes and original recovery key')
    assert not errors,errors
    print(f'PASS {len(checks)} device lock workflows; no browser errors',flush=True)
    browser.close()
finally:
 server.shutdown()
