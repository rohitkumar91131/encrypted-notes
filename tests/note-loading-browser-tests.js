(async()=>{
 const results=[],check=(ok,label)=>{if(!ok)throw Error(label);results.push(label)};
 await loadMaster();const raw=localStorage.getItem(DEVICE_KEY);const session={user:{id:uuid(),email:'test@example.invalid'}};user=session.user;localStorage.setItem(masterStorageKey(),raw);
 const rows=new Map();let realtimeHandler;
 supa={from(){return {select(columns){let id;const query={eq(field,value){id=value;return query},order(){return Promise.resolve({data:[...rows.values()].reverse().map(row=>columns==='*'?row:{id:row.id,title:row.title}),error:null})},maybeSingle(){return Promise.resolve({data:rows.get(id)||null,error:null})},then(resolve,reject){return Promise.resolve({data:[...rows.values()],error:null}).then(resolve,reject)}};return query},upsert(row){rows.set(row.id,row);return {select(){return {single:async()=>({data:{id:row.id},error:null})}}}}}},channel(){return {on(event,filter,handler){realtimeHandler=handler;return this},subscribe(){return this}}},removeChannel:async()=>{}};
 async function fixture(title,blocks,deleted=false){const n={id:uuid(),title,blocks,updated:Date.now(),deleted};const row=await sealNote(n);const oldBody={id:n.id,blocks:n.blocks,updated:n.updated,deleted};row.ciphertext=b64(await crypto.subtle.encrypt({name:'AES-GCM',iv:unb64(row.nonce),additionalData:aad(n.id,'content')},noteKeys.get(n.id),enc.encode(JSON.stringify(oldBody))));rows.set(n.id,row);await putLocal(row);return n}
 const first=await fixture('Existing first note',[{type:'text',text:'First line\n\nLast line',id:uuid(),editedAt:1,position:0}]);
 const second=await fixture('Existing second note',[{type:'heading',text:'Old heading',id:uuid(),editedAt:1,position:0},{type:'text',text:'Existing body',html:'<strong>Existing body</strong><br><br>Next line',id:uuid(),editedAt:1,position:1}]);
 let releaseCloud;const gate=new Promise(resolve=>releaseCloud=resolve),originalFrom=supa.from;
 supa.from=function(...args){const table=originalFrom.apply(this,args),originalSelect=table.select;table.select=function(...columns){const query=originalSelect.apply(this,columns),order=query.order;query.order=()=>gate.then(()=>order());return query};return table};
 notes=[];workspace.setLoading(true);const loadingLogin=handleLogin(session);
 for(let i=0;i<100&&document.querySelector('#home-view').getAttribute('aria-busy')!=='false';i++)await new Promise(resolve=>setTimeout(resolve,10));
 check(workspace.visibleNotes().length===2&&document.querySelector('#home-view').getAttribute('aria-busy')==='false','cached notes usable while cloud request is delayed');
 releaseCloud();await loadingLogin;supa.from=originalFrom;
 const unchanged=JSON.stringify([...rows.values()]);notes=[];noteKeys.clear();await handleLogin(session);workspace.setLoading(false);check(!awaitingRecovery,'existing account key accepted');check(workspace.visibleNotes().length===2,'both legacy notes remain visible');
 for(const [n,expected] of [[first,'First line'],[second,'Existing body']]){workspace.navigate('all');const card=[...document.querySelectorAll('#recent-grid .recent-card')].find(c=>c.querySelector('h3').textContent===n.title);check(card,'existing note card present');card.click();check(!document.querySelector('#note-view').hidden&&activeId===n.id,'existing card opens editor');check(editor.innerText.includes(expected),'existing note body rendered');check(getBlocks().length===n.blocks.length,'old block count preserved')}
 check(JSON.stringify([...rows.values()])===unchanged,'opening existing notes does not rewrite cloud data');
 workspace.navigate('all');notes=[];noteKeys.clear();user=null;master=await importMaster(raw);await handleLogin(session);workspace.setLoading(false);check(workspace.visibleNotes().length===2,'existing notes survive reload');workspace.openNote(first.id);check(editor.innerText.includes('Last line'),'existing content survives reload');
 // An unfocused open note must render realtime updates before marking the cipher seen.
 workspace.openNote(first.id);document.activeElement?.blur();
 const remoteEdit={...notes.find(n=>n.id===first.id),title:'Updated on another device',blocks:[{id:first.blocks[0].id,type:'text',text:'Synced without refresh',position:0,editedAt:Date.now()+1000}],updated:Date.now()+1000};
 const editedRow=await sealNote(remoteEdit);rows.set(first.id,editedRow);
 await realtimeHandler({eventType:'UPDATE',new:editedRow});
 check(titleEl.textContent===remoteEdit.title&&editor.innerText.includes('Synced without refresh'),'realtime update renders an unfocused open note without refresh');
 await syncRemote();check(editor.innerText.includes('Synced without refresh'),'polling preserves the rendered realtime update');
 // Returning from the page cache and reconnecting must pull new cloud notes.
 const returned={id:uuid(),title:'Added while away',blocks:[],updated:Date.now()};rows.set(returned.id,await sealNote(returned));
 window.dispatchEvent(new Event('pageshow'));await syncRemote();
 check(notes.some(n=>n.id===returned.id),'returning to the app pulls cloud notes');
 const reconnected={id:uuid(),title:'Added while offline',blocks:[],updated:Date.now()};rows.set(reconnected.id,await sealNote(reconnected));
 window.dispatchEvent(new Event('online'));await syncRemote();
 check(notes.some(n=>n.id===reconnected.id),'internet reconnect pulls cloud notes');
 const keyBeforeImport=masterKeyStore.getItem(masterStorageKey());secret.value=b64(crypto.getRandomValues(new Uint8Array(32)));await $('#modal-confirm').onclick();
 check(masterKeyStore.getItem(masterStorageKey())===keyBeforeImport,'wrong recovery import cannot replace a key using cached note keys');
 workspace.openNote(first.id);check(editor.innerText.includes('Synced without refresh'),'failed recovery import preserves working notes and keys');
 localStorage.removeItem(masterStorageKey());notes=[];noteKeys.clear();workspace.setLoading(true);await handleLogin(session);
 check(awaitingRecovery&&document.querySelector('#home-view').getAttribute('aria-busy')==='false','new device stops skeleton and shows recovery state');
 check(document.querySelectorAll('#recent-grid .recent-card').length===1&&document.querySelector('#recent-grid').textContent.includes('Unlock workspace'),'new device asks to unlock before classifying notes and threads');
 workspace.setLoading(false,'Network unavailable');check(document.querySelector('#retry-load-notes'),'failed loading offers retry');
 secret.value=raw;await $('#modal-confirm').onclick();
 check(!awaitingRecovery&&workspace.visibleNotes().length===4,'valid recovery key unlocks a fresh device');
 check(masterKeyStore.getItem(masterStorageKey())===raw,'valid recovery key is committed after actual note decryption');
 clearInterval(reconnectPoll);clearTimeout(debounce);document.querySelector('#test-results').textContent='PASS '+results.length+' existing-note checks\n'+results.join('\n');
})().catch(e=>{clearInterval(reconnectPoll);clearTimeout(debounce);document.querySelector('#test-results').textContent='FAIL '+e.stack});
