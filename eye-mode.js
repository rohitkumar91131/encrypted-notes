(() => {
  'use strict';
  const button=document.getElementById('eye-mode-toggle');
  const editor=document.getElementById('editor');
  const title=document.getElementById('note-title');
  const crumb=document.getElementById('crumb-title');
  if(!button||!editor||!title)return;
  const storageKey='encrypted-notes-eye-mode';
  const timers=new WeakMap();
  const versions=new WeakMap();
  let labelTimer=0, titleTimer=0;
  const enabled=()=>document.body.classList.contains('eye-mode');
  const api=()=>window.eyeModeCipher;
  const currentBlocks=()=>new Map((api()?.blocks()||[]).map(block=>[block.id,block]));

  async function encryptBlock(element, model){
    if(!enabled()||!editor.contains(element)||!model)return;
    const version=(versions.get(element)||0)+1;
    versions.set(element,version);
    const cipher=element.querySelector(':scope > .eye-block-cipher');
    if(!cipher)return;
    try{
      const value=await api().encryptBlock(model);
      if(versions.get(element)!==version||!enabled()||!editor.contains(element))return;
      cipher.textContent=value||'Encrypting block…';
      element.classList.add('eye-ciphered');
    }catch(error){console.warn('Could not encrypt block preview',error);cipher.textContent='Encrypted block unavailable';element.classList.add('eye-ciphered')}
  }
  function ensureBlock(element, models){
    if(!enabled()||!element.classList.contains('block'))return;
    let cipher=element.querySelector(':scope > .eye-block-cipher');
    if(!cipher){
      cipher=document.createElement('pre');
      cipher.className='eye-block-cipher';
      cipher.setAttribute('aria-label','Encrypted block. Click to edit.');
      cipher.textContent='Encrypting block…';
      element.append(cipher);
      encryptBlock(element,models.get(element.dataset.blockId));
      if(element.contains(document.activeElement))reveal(element);
    }
  }
  function syncBlocks(refresh=false){
    if(!enabled()||!api()?.activeId())return;
    const models=currentBlocks();
    for(const element of editor.children){
      if(!element.classList.contains('block'))continue;
      const existing=!!element.querySelector(':scope > .eye-block-cipher');
      ensureBlock(element,models);
      if(refresh&&existing)encryptBlock(element,models.get(element.dataset.blockId));
    }
  }
  function finishReveal(element){
    if(!enabled()||!editor.contains(element))return;
    const model=currentBlocks().get(element.dataset.blockId);
    encryptBlock(element,model);
    element.classList.remove('eye-reveal');
  }
  function reveal(element){
    if(!enabled()||!element)return;
    element.classList.add('eye-reveal');
    clearTimeout(timers.get(element));
    timers.set(element,setTimeout(()=>finishReveal(element),1000));
  }
  function clearBlocks(){
    for(const element of editor.querySelectorAll('.block')){
      clearTimeout(timers.get(element));
      versions.set(element,(versions.get(element)||0)+1);
      element.classList.remove('eye-ciphered','eye-reveal');
      element.querySelector(':scope > .eye-block-cipher')?.remove();
    }
  }
  editor.addEventListener('focusin',event=>reveal(event.target.closest('.block')));
  editor.addEventListener('input',event=>reveal(event.target.closest('.block')));
  editor.addEventListener('change',event=>reveal(event.target.closest('.block')));
  editor.addEventListener('click',event=>{
    const cipher=event.target.closest('.eye-block-cipher');
    if(!cipher||!enabled())return;
    const block=cipher.closest('.block');
    reveal(block);
    block.querySelector('.block-content[contenteditable="true"]')?.focus();
  });
  new MutationObserver(records=>{
    if(!enabled())return;
    if(records.some(record=>record.target===editor&&[...record.addedNodes].some(node=>node.nodeType===1&&node.classList.contains('block'))))syncBlocks();
  }).observe(editor,{childList:true});

  async function encryptTitle(){
    if(!enabled()||!api()?.activeId())return;
    const id=api().activeId(),plain=title.innerText;
    try{
      const cipher=await api().encryptBlock({id:'title',type:'title',text:plain});
      if(enabled()&&api().activeId()===id&&title.innerText===plain){title.dataset.eyeCipher=cipher;crumb.dataset.eyeCipher=cipher.slice(0,24)+'…'}
    }catch(error){console.warn('Could not encrypt title preview',error)}
  }
  title.addEventListener('focus',()=>{if(enabled()){title.classList.add('eye-reveal');clearTimeout(titleTimer);titleTimer=setTimeout(()=>{title.classList.remove('eye-reveal');encryptTitle()},1000)}});
  title.addEventListener('input',()=>{if(enabled()){title.classList.add('eye-reveal');clearTimeout(titleTimer);titleTimer=setTimeout(()=>{title.classList.remove('eye-reveal');encryptTitle()},1000)}});
  title.addEventListener('click',()=>{if(enabled())title.classList.add('eye-reveal')});

  function applyLabels(rows){
    if(!enabled())return;
    const byId=new Map(rows.map(row=>[row.id,row.ciphertext]));
    for(const element of document.querySelectorAll('[data-eye-id],.sidebar-page-row[data-note-id],.sidebar-folder[data-folder-id]')){
      const id=element.dataset.eyeId||element.dataset.noteId||element.dataset.folderId;
      const target=element.matches('.sidebar-page-row')?element.querySelector('.note-row'):element.matches('.sidebar-folder')?element.querySelector('.folder-open'):element;
      if(target)target.dataset.eyeCipher=(byId.get(id)||'Encrypted note').slice(0,28)+'…';
    }
  }
  async function refreshLabels(){if(enabled())try{applyLabels(await api().list())}catch(error){console.warn('Could not read encrypted note labels',error)}}
  function scheduleLabels(){if(!enabled()||labelTimer)return;labelTimer=setTimeout(()=>{labelTimer=0;refreshLabels()},100)}
  for(const id of ['note-list','recent-grid'])new MutationObserver(scheduleLabels).observe(document.getElementById(id),{childList:true,subtree:true});

  const privateSelector=[
    '#workspace-crumb','.sidebar .account-copy','#settings-account-email',
    '#home-view .home-heading h1','#home-view .home-section-head h2',
    '#recent-grid .month-card-preview','#recent-grid .threads-table tbody .thread-name-cell > button:first-of-type',
    '#recent-grid .movie-title','#recent-grid .movie-card-meta','#recent-grid .movie-preview',
    '.thread-drag-preview span:last-child','.movie-form-preview .movie-preview',
    '#note-view .movie-preview','#note-view .page-relations button','#note-view #note-cover',
    '.smart-search-result-copy','.page-mention-menu button',
    '#gallery-screen .sg-folder-open','#gallery-screen .sg-preview','#gallery-screen .sg-caption span:first-child',
    '#gallery-screen .sg-caption small','#gallery-screen .sg-date h2','#gallery-screen .sg-notice-thumb',
    '#gallery-screen #sg-viewer-title','#gallery-screen .sg-stage',
    '#gallery-screen .sg-folder-file span','#gallery-screen .sg-private-folder-row span',
    '#gallery-screen .sg-notice-copy strong','#gallery-screen .sg-notice-copy small',
    '#gallery-screen .sg-spec-grid dd','#gallery-screen .sg-file-fallback p',
    '#gallery-screen .sg-destination-choice',
    '#gallery-screen .download-job h3','#gallery-screen .download-current',
    '#gallery-screen #sidebarDownloadName','#gallery-screen .sg-version strong',
    '#gallery-screen .sg-small-modal h2','#gallery-screen .sg-small-modal p'
  ].join(',');
  const privateState=new WeakMap(), inputState=new WeakMap(), inputTimers=new WeakMap();
  let privateScanTimer=0;
  function privateValue(element){
    if(element.id==='note-cover')return api()?.cover()||'';
    if(element.classList.contains('sg-folder-open'))return element.querySelector('.sg-folder-copy strong')?.textContent||element.getAttribute('aria-label')||'';
    if(element.classList.contains('sg-preview'))return element.querySelector('img')?.alt||element.getAttribute('aria-label')||'';
    if(element.classList.contains('sg-stage'))return document.getElementById('sg-viewer-title')?.textContent||'';
    if(element.classList.contains('sg-notice-thumb'))return element.closest('.sg-notice-card')?.querySelector('.sg-notice-copy strong')?.textContent||'';
    if(element.classList.contains('movie-preview'))return element.closest('[data-movie-url]')?.dataset.movieUrl||element.textContent||'Movie preview';
    return element.textContent?.trim()||'';
  }
  async function paintPrivate(element){
    const source=privateValue(element);
    if(!source)return;
    element.classList.add('eye-private');
    if(element.matches('.sg-preview,.sg-folder-open,.movie-preview,.sg-stage,.sg-notice-thumb,#note-cover'))element.classList.add('eye-private-media');
    const previous=privateState.get(element);
    if(previous?.source===source&&previous.cipher){element.dataset.eyeCipher=previous.cipher;return}
    const token=(previous?.token||0)+1;
    privateState.set(element,{source,token});
    element.dataset.eyeCipher='Encrypting…';
    try{
      const cipher=await api().encryptValue(source,element.className||element.id);
      if(!enabled()||!element.isConnected||privateState.get(element)?.token!==token)return;
      if(cipher){privateState.set(element,{source,token,cipher});element.dataset.eyeCipher=cipher}
    }catch(error){console.warn('Could not encrypt workspace preview',error)}
  }
  const privateInputSelector='input:not([type]),input[type="text"],input[type="search"],input[type="url"],textarea';
  function inputEligible(element){return element.matches?.(privateInputSelector)&&!element.closest('#editor')}
  async function paintInput(element){
    if(!enabled()||!inputEligible(element))return;
    const source=element.value;
    if(!source){element.classList.remove('eye-private-input');element.style.removeProperty('--eye-input-image');return}
    element.classList.add('eye-private-input');
    const previous=inputState.get(element);
    if(previous?.source===source&&previous.cipher)return;
    const token=(previous?.token||0)+1;
    inputState.set(element,{source,token});
    try{
      const cipher=await api().encryptValue(source,'input:'+element.id);
      if(!enabled()||!element.isConnected||inputState.get(element)?.token!==token||element.value!==source)return;
      if(!cipher)return;
      inputState.set(element,{source,token,cipher});
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="18"><text x="0" y="13" fill="#315e47" font-family="monospace" font-size="11">'+cipher.slice(0,72)+'</text></svg>';
      element.style.setProperty('--eye-input-image','url("data:image/svg+xml,'+encodeURIComponent(svg)+'")');
    }catch(error){console.warn('Could not encrypt input preview',error)}
  }
  function scanPrivate(){
    privateScanTimer=0;if(!enabled())return;
    for(const element of document.querySelectorAll(privateSelector))paintPrivate(element);
    const names=new Set(api()?.privateNames()||[]);
    for(const element of document.querySelectorAll('.sidebar-page-menu button'))if(names.has(element.textContent.trim()))paintPrivate(element);
    if(!api()?.activeId()||document.getElementById('note-view').hidden)paintPrivate(crumb);
    for(const element of document.querySelectorAll(privateInputSelector))paintInput(element);
  }
  function schedulePrivate(){if(enabled()&&!privateScanTimer)privateScanTimer=setTimeout(scanPrivate,60)}
  new MutationObserver(schedulePrivate).observe(document.body,{childList:true,characterData:true,subtree:true});
  document.addEventListener('click',schedulePrivate,true);
  document.addEventListener('focusin',schedulePrivate,true);
  document.addEventListener('input',event=>{
    const element=event.target;if(!enabled()||!inputEligible(element))return;
    element.classList.add('eye-reveal');clearTimeout(inputTimers.get(element));
    inputTimers.set(element,setTimeout(()=>{element.classList.remove('eye-reveal');paintInput(element)},1000));
  },true);
  window.addEventListener('eye-crypto-ready',schedulePrivate);

  function setMode(on){
    document.body.classList.toggle('eye-mode',on);
    window.dispatchEvent(new CustomEvent('eye-mode-changed',{detail:{enabled:on}}));
    button.setAttribute('aria-pressed',String(on));
    button.setAttribute('aria-label',on?'Eye mode on. Show normal text':'Eye mode off. Show ciphertext');
    button.title=on?'Show decrypted notes':'Show encrypted ciphertext';
    button.querySelector('span').textContent=on?'Eye mode on':'Eye mode off';
    if(on){syncBlocks();encryptTitle();refreshLabels();scanPrivate()}
    else{clearBlocks();title.classList.remove('eye-reveal');clearTimeout(titleTimer);title.dataset.eyeCipher='';crumb.dataset.eyeCipher=''}
    try{localStorage.setItem(storageKey,on?'on':'off')}catch{}
  }
  button.addEventListener('click',()=>setMode(!enabled()));
  window.addEventListener('eye-note-changed',()=>{if(enabled()){syncBlocks();encryptTitle();scheduleLabels()}});
  window.addEventListener('note-ciphertext-saved',scheduleLabels);
  let saved=false;try{saved=localStorage.getItem(storageKey)==='on'}catch{}
  setMode(saved);
})();
