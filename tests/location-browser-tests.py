from pathlib import Path
import re,tempfile
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
s=(root/'encrypted-notes.html').read_text()
s=re.sub(r'<script src="[^"]+"></script>','',s)
s=s.replace('  const supa=window.supabase?.createClient(SUPABASE_URL,SUPABASE_KEY,{global:{fetch:boundedFetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});',"""  const supa=localStorage.getItem('test-login')?{auth:{async getSession(){await new Promise(r=>setTimeout(r,150));return {data:{session:{user:{id:localStorage.getItem('test-login'),email:'test@example.invalid'}}}}},onAuthStateChange(){}},from(){return {select(){let id;const result=async()=>({data:id?(await allLocal()).find(r=>r.id===id):(await allLocal()).filter(r=>r.user_id===user?.id),error:null});const q={eq(k,v){id=v;return q},order:()=>new Promise(r=>setTimeout(r,250)).then(result),maybeSingle:result,then:(a,b)=>result().then(a,b)};return q},upsert(row){return {select(){return {single:async()=>({data:{id:row.id},error:null})}}}}}},channel(){return {on(){return this},subscribe(){return this}}},removeChannel:async()=>{}}:null;""")
s=s.replace('<script>','<script>'+''.join((root/f).read_text()+'\n' for f in ['device-lock.js','editor-features.js','workspace.js'])+'</script><script>',1)
s=s.replace('  ({renderList,renderHome,showHome,openNote,createNote}=workspace);',"""  ({renderList,renderHome,showHome,openNote,createNote}=workspace);window.testWorkspace=workspace;window.testAccount=id=>{user=id?{id}:null};window.testPromote=async()=>{const raw=masterKeyStore.getItem(masterStorageKey());user={id:'signed-in-test',email:'test@example.invalid'};await masterKeyStore.setItem(masterStorageKey(),raw);for(const n of notes)await putLocal(await sealNote(n));localStorage.setItem('test-login',user.id);workspace.openNote(notes.find(n=>n.kind!=='thread').id)};""")
with tempfile.TemporaryDirectory() as d,sync_playwright() as pw:
    file=Path(d)/'app.html';file.write_text(s)
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox','--allow-file-access-from-files'])
    page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.dismiss())
    def ready():page.wait_for_function("document.querySelector('#home-view').getAttribute('aria-busy')==='false'")
    def refresh():page.reload();ready()
    page.goto(file.as_uri());ready()
    page.evaluate('testWorkspace.createNote()');page.locator('#note-title').fill('Refresh test');page.locator('#note-title').blur();page.wait_for_timeout(1200)
    note=page.evaluate("JSON.parse(localStorage.getItem('stillnote-location-v1:guest')).noteId")
    refresh();assert page.evaluate('location.hash')=='';assert page.locator('#note-view').is_visible();assert page.locator('#note-title').inner_text()=='Refresh test'
    page.evaluate("testWorkspace.createThread('Daily test')");refresh();assert page.locator('.home-heading h1').inner_text()=='Threads'
    page.get_by_label('Thread month',exact=True).fill('2026-09');refresh();assert page.get_by_label('Thread month',exact=True).input_value()=='2026-09'
    page.locator('.threads-table').get_by_role('button',name='Daily test',exact=True).click();refresh();assert page.locator('#note-title').inner_text()=='Daily test';assert page.locator('#note-view').is_visible()
    page.evaluate("testWorkspace.navigate('movies')");page.get_by_role('button',name='Watched',exact=True).click();refresh();assert page.locator('.home-heading h1').inner_text()=='Movies';assert page.locator('.home-section-head h2').inner_text()=='Watched'
    page.evaluate("testWorkspace.navigate('recent')");refresh();assert page.locator('.home-heading h1').inner_text()=='Recently viewed'
    page.evaluate("history.replaceState(null,'',location.pathname);localStorage.setItem('stillnote-location-v1:guest',JSON.stringify({view:'all',noteId:'missing'}))");refresh();assert page.locator('#home-view').is_visible()
    page.evaluate("localStorage.setItem('stillnote-location-v1:guest','null')");refresh();assert page.locator('#home-view').is_visible()
    page.evaluate("localStorage.setItem('stillnote-location-v1:account-test',JSON.stringify({view:'threads',noteId:null}));testAccount('account-test');testWorkspace.restoreLocation(true)");assert page.locator('.home-heading h1').inner_text()=='Threads'
    page.evaluate("testWorkspace.navigate('movies');testAccount(null);testWorkspace.restoreLocation(true)");assert page.locator('.home-heading h1').inner_text()=='All notes'
    assert page.evaluate("JSON.parse(localStorage.getItem('stillnote-location-v1:account-test')).view")=='movies'
    page.evaluate('testPromote()');signed_title=page.locator('#note-title').inner_text();refresh();page.wait_for_timeout(800);assert page.locator('#note-view').is_visible();assert page.locator('#note-title').inner_text()==signed_title
    page.evaluate("history.replaceState(null,'','#workspace='+encodeURIComponent(JSON.stringify({scope:'stillnote-location-v1:signed-in-test',state:{view:'all',noteId:null}})))");refresh();page.wait_for_timeout(800);assert page.locator('#note-view').is_visible();assert page.locator('#note-title').inner_text()==signed_title;assert page.evaluate('location.hash')==''
    page.evaluate("testWorkspace.navigate('threads')");assert page.evaluate('location.hash')=='';refresh();page.wait_for_timeout(800);assert page.locator('.home-heading h1').inner_text()=='Threads';assert page.evaluate('location.hash')==''
    assert not errors,errors
    print('PASS clean URL and local-storage-only signed-in refresh, legacy URL cleanup; real refresh: note, thread grid/month, thread page, Movies tab, Recently viewed, missing page and invalid stored state')
    browser.close()
