/* Local vault encryption, not account authentication. WebAuthn PRF wraps a random
 * vault key; the vault holds all this browser's note master keys. */
window.installDeviceLock = function installDeviceLock(options) {
  const REFRESH_SESSION = 'stillnote-refresh-unlock-v1';
  let refreshRaw=null, leaving=false;
  function clearRefresh(){try{sessionStorage.removeItem(REFRESH_SESSION)}catch{}}
  const STORAGE = 'stillnote-device-lock-v1';
  const isMaster = key => key === 'stillnote-device-key' || key.startsWith('stillnote-master:');
  const encode = new TextEncoder(), decode = new TextDecoder();
  const bytes = size => crypto.getRandomValues(new Uint8Array(size));
  const b64 = value => btoa(String.fromCharCode(...new Uint8Array(value)));
  const unb64 = value => Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
  const url64 = value => b64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const aad = part => encode.encode('stillnote-device-lock:v1:' + location.origin + ':' + part);
  let record = null, broken = false;
  try { const raw = localStorage.getItem(STORAGE); if (raw) { record = JSON.parse(raw); if (record.version !== 1 || !record.credentialId || !record.vault || !record.prfWrap || !record.recoveryWrap) throw Error('Invalid device lock'); } }
  catch (_) { broken = true; }
  let keys = {}, vaultKey = null, unlocked = !record && !broken, busy = false;
  let pending = Promise.resolve(), readyResolve, gate, message, card, idleTimer, recovered = false;
  const inertBeforeLock = new Set();
  if (!unlocked) document.documentElement.classList.add('device-locked');
  function rawKeys() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (isMaster(name)) out[name] = localStorage.getItem(name);
    }
    return out;
  }
  function validateKeys(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw Error('The device vault has no keys.');
    for (const [name, raw] of Object.entries(value)) if (!isMaster(name) || typeof raw !== 'string' || unb64(raw).length !== 32) throw Error('Invalid encryption key in device vault.');
    return value;
  }
  async function aes(raw, usages) { return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages); }
  async function derive(raw, salt, part) {
    const input = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256', salt, info:aad(part)}, input, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  }
  async function seal(key, plain, part) {
    const iv = bytes(12);
    const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:aad(part)}, key, plain);
    return {iv:b64(iv), cipher:b64(cipher)};
  }
  async function open(key, box, part) {
    return crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(box.iv), additionalData:aad(part)}, key, unb64(box.cipher));
  }
  function wipePlaintextKeys() { for (const name of Object.keys(rawKeys())) localStorage.removeItem(name); }
  async function persist() {
    if (!record || !unlocked || !vaultKey) throw Error('Unlock this device before saving encryption keys.');
    const stored = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    if (!stored || stored.credentialId !== record.credentialId || stored.prfWrap.cipher !== record.prfWrap.cipher) throw Error('Device lock changed in another tab. Reopen this workspace.');
    const storedKeys = validateKeys(JSON.parse(decode.decode(await open(vaultKey, stored.vault, 'vault'))));
    keys = {...storedKeys, ...keys};
    const vault = await seal(vaultKey, encode.encode(JSON.stringify(keys)), 'vault');
    const next = {...stored, vault};
    localStorage.setItem(STORAGE, JSON.stringify(next)); record = next;
    wipePlaintextKeys();
  }
  const keyStore = {
    getItem(name) { return record || broken ? (unlocked ? keys[name] || null : null) : localStorage.getItem(name); },
    async setItem(name, raw) {
      if (!isMaster(name) || unb64(raw).length !== 32) throw Error('Invalid master key');
      if (!record && !broken) {
        if (localStorage.getItem(STORAGE)) throw Error('Device lock changed in another tab. Reopen this workspace.');
        localStorage.setItem(name, raw); return;
      }
      if (!unlocked) throw Error('Device locked');
      const task = pending.then(async () => {
        const previous = keys; keys = {...keys, [name]:raw};
        try { await persist(); } catch (error) { keys = previous; throw error; }
      });
      pending = task.catch(() => {});
      return task;
    }
  };
  function showGate(text) {
    document.documentElement.classList.add('device-locked');
    for (const child of document.body.children) if (child !== gate && !child.inert) {
      inertBeforeLock.add(child); child.inert = true;
    }
    gate.hidden = false; message.textContent = text || 'Unlock to open your private workspace.';
    gate.querySelector('#device-unlock').focus();
  }
  function dismissGate() {
    document.documentElement.classList.remove('device-locked');
    for (const child of inertBeforeLock) child.inert = false;
    inertBeforeLock.clear();
    gate.hidden = true; gate.querySelector('input').value = '';
    message.textContent = ''; readyResolve?.(); readyResolve = null; resetIdle(); render();
  }
  function errorText(error) {
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') return 'Unlock cancelled. Try again, or use your recovery key.';
    return error.message || 'Could not unlock this device.';
  }
  function setBusy(value) {
    busy = value;
    gate?.querySelectorAll('button').forEach(button => button.disabled = value);
    card?.querySelectorAll('button').forEach(button => button.disabled = value);
  }
  async function prfCredential(info) {
    const id = unb64(info.credentialId);
    const credential = await navigator.credentials.get({publicKey:{
      challenge:bytes(32), rpId:location.hostname, timeout:60000,
      allowCredentials:[{type:'public-key', id}], userVerification:'required',
      extensions:{prf:{evalByCredential:{[url64(id)]:{first:unb64(info.prfSalt)}}}}
    }});
    if (!credential || b64(credential.rawId) !== info.credentialId) throw Error('Choose the passkey registered for this device lock.');
    const auth = new Uint8Array(credential.response.authenticatorData);
    if (auth.length < 37 || !(auth[32] & 4)) throw Error('Device verification is required.');
    const result = credential.getClientExtensionResults().prf?.results?.first;
    if (!result || result.byteLength !== 32) throw Error('This phone/browser does not support secure fingerprint key protection (PRF). Your existing notes and keys are unchanged.');
    return result;
  }
  async function acceptVault(raw) {
    const candidate = await aes(raw, ['encrypt','decrypt']);
    const decoded = validateKeys(JSON.parse(decode.decode(await open(candidate, record.vault, 'vault'))));
    refreshRaw=b64(raw); vaultKey = candidate; keys = decoded; unlocked = true; wipePlaintextKeys(); dismissGate();
  }
  async function unlockBiometric() {
    if (busy || broken) return;
    setBusy(true); message.textContent = 'Verify with your phone…';
    try {
      const output = await prfCredential(record);
      const key = await derive(output, unb64(record.prfSalt), 'passkey');
      await acceptVault(await open(key, record.prfWrap, 'passkey'));
      recovered = false;
    } catch (error) { message.textContent = errorText(error); }
    finally { setBusy(false); if (record && unlocked && document.visibilityState === 'hidden') lock(); }
  }
  function recoveryRaw(value) {
    let raw = value.trim();
    try { const parsed = JSON.parse(raw); if (parsed.format === 'stillnote-recovery-v1') raw = parsed.key; } catch (_) {}
    if (typeof raw !== 'string' || unb64(raw).length !== 32) throw Error('Enter the recovery key you saved when enabling this device lock.');
    return raw;
  }
  async function unlockRecovery(event) {
    event.preventDefault(); if (busy || broken) return;
    setBusy(true);
    try {
      const raw = recoveryRaw(gate.querySelector('input').value);
      const key = await derive(unb64(raw), unb64(record.recoverySalt), 'recovery');
      await acceptVault(await open(key, record.recoveryWrap, 'recovery'));
      recovered = true;
    } catch (_) { message.textContent = 'That recovery key did not unlock this device. Use the key saved when you enabled fingerprint lock.'; }
    finally { setBusy(false); if (record && unlocked && document.visibilityState === 'hidden') lock(); }
  }
  async function enable() {
    if (busy || record) return;
    const status = card.querySelector('[role=status]');
    if (!options.canEnable()) { status.textContent = 'Unlock your notes with their recovery key first.'; return; }
    if (!card.querySelector('input').checked) { status.textContent = 'Save your recovery key, then tick the confirmation above.'; return; }
    setBusy(true); status.textContent = 'Create a device passkey, then verify it to enable lock…';
    try {
      const recovery = recoveryRaw(options.recoveryKey() || '');
      if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials || !await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) throw Error('Set up fingerprint, Face ID or a device PIN, and use a supported HTTPS browser.');
      const credential = await navigator.credentials.create({publicKey:{
        challenge:bytes(32), rp:{name:'Encrypted Notes', id:location.hostname},
        user:{id:bytes(32), name:'device-lock', displayName:'Encrypted Notes device lock'},
        pubKeyCredParams:[{type:'public-key', alg:-7}, {type:'public-key', alg:-257}],
        authenticatorSelection:{authenticatorAttachment:'platform', residentKey:'preferred', userVerification:'required'},
        timeout:60000, attestation:'none', extensions:{prf:{}}
      }});
      if (!credential) throw Error('Passkey creation cancelled.');
      const info = {version:1, credentialId:b64(credential.rawId), prfSalt:b64(bytes(32)), recoverySalt:b64(bytes(32))};
      // Always exercise get(): registration alone cannot prove a repeatable PRF output.
      const output = await prfCredential(info), rawVault = bytes(32);
      const prfKey = await derive(output, unb64(info.prfSalt), 'passkey');
      const recoveryKey = await derive(unb64(recovery), unb64(info.recoverySalt), 'recovery');
      const candidate = await aes(rawVault, ['encrypt','decrypt']);
      const allKeys = validateKeys(rawKeys());
      const next = {...info,
        vault:await seal(candidate, encode.encode(JSON.stringify(allKeys)), 'vault'),
        prfWrap:await seal(prfKey, rawVault, 'passkey'),
        recoveryWrap:await seal(recoveryKey, rawVault, 'recovery')};
      const verify = await aes(await open(prfKey, next.prfWrap, 'passkey'), ['decrypt']);
      validateKeys(JSON.parse(decode.decode(await open(verify, next.vault, 'vault'))));
      await open(recoveryKey, next.recoveryWrap, 'recovery');
      // Commit the verified encrypted vault before deleting any plaintext master keys.
      localStorage.setItem(STORAGE, JSON.stringify(next));
      refreshRaw=b64(rawVault); record = next; keys = allKeys; vaultKey = candidate; unlocked = true;
      wipePlaintextKeys(); render(); resetIdle();
      status.textContent = 'Enabled on this browser. Refresh stays unlocked. Locks when reopened, backgrounded, or idle for 5 minutes.';
    } catch (error) { status.textContent = errorText(error); }
    finally { setBusy(false); if (record && document.visibilityState === 'hidden') lock(); }
  }
  async function disable() {
    if (busy || !record || !unlocked) return;
    setBusy(true);
    try {
      // Recovery unlock must also allow replacing a lost or removed passkey.
      if (!recovered) {
        const output = await prfCredential(record);
        const key = await derive(output, unb64(record.prfSalt), 'passkey');
        await open(key, record.prfWrap, 'passkey');
      }
      await pending;
      for (const [name, raw] of Object.entries(keys)) localStorage.setItem(name, raw);
      clearRefresh();refreshRaw=null;localStorage.removeItem(STORAGE); record = null; vaultKey = null; keys = {};
      clearTimeout(idleTimer); render();
      card.querySelector('[role=status]').textContent = 'Device lock disabled on this browser.';
    } catch (error) {
      // A failed disable must not leave partially restored plaintext master keys.
      if (record) wipePlaintextKeys();
      card.querySelector('[role=status]').textContent = errorText(error);
    }
    finally { setBusy(false); resetIdle(); if (record && document.visibilityState === 'hidden') lock(); }
  }
  async function lock() {
    if (!record || !unlocked || busy) return;
    clearRefresh();refreshRaw=null;setBusy(true); clearTimeout(idleTimer);
    const flushing = options.beforeLock();
    showGate('Saving encrypted changes and locking…');
    try {
      await flushing; await pending;
      keys = {}; vaultKey = null; unlocked = false;
      // A fresh document drops editor history, note keys and all decrypted closures.
      location.reload();
    } catch (_) {
      message.textContent = 'Could not save changes. Your workspace is still covered. Retry locking to keep your edits.';
      setBusy(false);
      gate.querySelector('#device-unlock').textContent = 'Retry lock';
      gate.querySelector('#device-unlock').onclick = lock;
    }
  }
  function resetIdle() { clearTimeout(idleTimer); if (record && unlocked) idleTimer = setTimeout(lock, 5 * 60 * 1000); }
  function render() {
    if (!card) return;
    card.querySelector('#device-enable').hidden = !!record;
    card.querySelector('.device-backup-check').hidden = !!record;
    card.querySelector('#device-lock-now').hidden = !record;
    card.querySelector('#device-disable').hidden = !record;
    card.querySelector('.device-lock-detail').textContent = record
      ? 'Enabled on this browser · fingerprint, Face ID or device PIN.'
      : 'Protect your encryption keys with your phone’s device unlock.';
  }
  async function start() {
    card = document.createElement('section'); card.className = 'settings-card device-lock-card';
    card.innerHTML = '<div class="settings-card-heading"><span class="settings-icon" aria-hidden="true">⌑</span><div><h3>Fingerprint / Face ID</h3><p class="device-lock-detail"></p></div></div><label class="device-backup-check"><input type="checkbox"> I have saved my recovery key</label><div class="device-lock-actions"><button type="button" id="device-enable">Enable device lock</button><button type="button" id="device-lock-now">Lock now</button><button type="button" id="device-disable">Disable lock</button></div><p role="status" aria-live="polite">Keep the recovery key you save during setup. Enable separately on each browser/device.</p>';
    document.querySelector('.settings-footnote').before(card);
    gate = document.createElement('section'); gate.id = 'device-lock-gate'; gate.hidden = true;
    gate.setAttribute('role','dialog'); gate.setAttribute('aria-modal','true'); gate.setAttribute('aria-labelledby','device-lock-title');
    gate.innerHTML = '<div class="device-lock-panel"><img src="/public/icon-192.png" alt="" width="72" height="72"><h1 id="device-lock-title">Your workspace is locked</h1><p>Unlock with fingerprint, Face ID or your device PIN.</p><button type="button" id="device-unlock">Unlock with device</button><details><summary>Use recovery key</summary><form><label for="device-recovery">Key saved when enabling this lock</label><input id="device-recovery" type="password" autocomplete="off" spellcheck="false"><button type="submit">Unlock with recovery key</button></form></details><p id="device-lock-message" role="status" aria-live="polite"></p></div>';
    document.body.append(gate); message = gate.querySelector('#device-lock-message');
    card.querySelector('#device-enable').onclick = enable;
    card.querySelector('#device-lock-now').onclick = lock;
    card.querySelector('#device-disable').onclick = disable;
    gate.querySelector('#device-unlock').onclick = unlockBiometric;
    gate.querySelector('form').onsubmit = unlockRecovery;
    render();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') setTimeout(()=>{if(!leaving&&document.visibilityState==='hidden')lock()},0); });
    window.addEventListener('pagehide',event=>{leaving=true;if(event.persisted){clearRefresh();return}if(record&&unlocked&&!busy&&refreshRaw){try{sessionStorage.setItem(REFRESH_SESSION,JSON.stringify({raw:refreshRaw,credentialId:record.credentialId,wrap:record.prfWrap.cipher,expires:Date.now()+15000,recovered}))}catch{}}else clearRefresh()});
    for (const event of ['pointerdown','keydown','input']) document.addEventListener(event, resetIdle, {passive:true});
    window.addEventListener('pageshow', event => { leaving=false;if (event.persisted && record) lock(); });
    window.addEventListener('storage', event => {
      if (event.key === STORAGE && !busy) {
        // Another tab changed the shared key vault. Preserve local edits before restarting.
        if (record && unlocked) lock();
        else if (unlocked) {
          setBusy(true); const flushing = options.beforeLock();
          showGate('Device lock changed in another tab. Saving encrypted changes…');
          flushing.then(() => location.reload()).catch(() => {
            message.textContent = 'Could not save changes. Retry after restoring storage access.';
            setBusy(false);
          });
        } else location.reload();
      }
    });
    if (broken) { showGate('The saved device lock is damaged. Restore this browser’s data from a backup or use your recovery key in another browser.'); gate.querySelectorAll('button').forEach(button => button.disabled = true); return new Promise(() => {}); }
    if (!record){clearRefresh();return;}
    let resume;try{resume=JSON.parse(sessionStorage.getItem(REFRESH_SESSION)||'null')}catch{}clearRefresh();
    if(performance.getEntriesByType('navigation')[0]?.type==='reload'&&resume&&resume.expires>Date.now()&&resume.expires<=Date.now()+15000&&resume.credentialId===record.credentialId&&resume.wrap===record.prfWrap.cipher){try{await acceptVault(unb64(resume.raw));recovered=!!resume.recovered;resetIdle();return}catch{refreshRaw=null}}
    const ready = new Promise(resolve => readyResolve = resolve);
    showGate(); return ready;
  }
  return {keyStore, start, lock};
};
