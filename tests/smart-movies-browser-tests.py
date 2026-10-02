"""Real UI checks using deterministic public metadata fixtures, without external requests."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlparse, parse_qs
import json,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
requests=[]
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def do_GET(self):
  if self.path.startswith('/api/movie-preview?'):
   url=parse_qs(urlparse(self.path).query)['url'][0];requests.append(url);time.sleep(.1)
   data={'title':'The Batman — Official Trailer' if 'M7lc1UVf-VE' in url else 'Custom movie trailer','poster':'https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg','provider':'YouTube','author':'Warner Bros.'}
   self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(data).encode());return
  if self.path=='/':self.path='/encrypted-notes.html'
  super().do_GET()
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
  context=browser.new_context(viewport={'width':1280,'height':900})
  context.route('https://**/*',lambda r:r.abort())
  context.route('https://i.ytimg.com/**',lambda r:r.fulfill(body=(ROOT/'public/icon-192.png').read_bytes(),content_type='image/png'))
  context.route('**/pwa.js',lambda r:r.abort())
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.dismiss())
  page.goto(f'http://127.0.0.1:{server.server_port}',wait_until='domcontentloaded')
  page.locator('#movies-notes').click()
  def add(value,title=''):
   page.locator('#home-new-note').click();page.get_by_role('textbox',name='Movie name or link',exact=True).fill(value)
   if title:page.get_by_role('textbox',name='Movie title',exact=True).fill(title)
   page.get_by_role('dialog',name='Add or edit movie').get_by_role('button',name='Add movie',exact=True).click()
  add('https://youtu.be/M7lc1UVf-VE')
  page.locator('.movie-title').filter(has_text='The Batman — Official Trailer').wait_for()
  assert page.locator('#recent-grid .movie-poster').get_attribute('src').startswith('https://i.ytimg.com/')
  assert len(requests)==1 and requests[0]=='https://www.youtube.com/watch?v=M7lc1UVf-VE'
  print('PASS automatic title, thumbnail and canonical public-metadata request',flush=True)
  add('https://www.youtube.com/shorts/M7lc1UVf-VE?t=25')
  assert page.locator('.movie-card').count()==1
  print('PASS duplicate video across different URL forms is not added again',flush=True)
  add('https://youtu.be/dQw4w9WgXcQ','My own title')
  page.wait_for_function("document.querySelectorAll('.movie-card-meta')[0].textContent.includes('Warner')")
  assert page.locator('.movie-title').filter(has_text='My own title').count()==1
  add('https://youtu.be/aqz-KE-bpKQ','YouTube movie')
  page.wait_for_function("document.querySelector('#home-note-count').textContent.includes('3')")
  assert page.locator('.movie-title').filter(has_text='YouTube movie').count()==1
  add('Zeta');add('Alpha')
  page.get_by_role('combobox',name='Sort movies').select_option('title')
  assert page.locator('.movie-title').first.inner_text()=='Alpha'
  page.get_by_role('searchbox',name='Search movies').fill('batman')
  assert page.locator('.movie-card').count()==1
  assert page.locator('#movies-search').evaluate('(el)=>el===document.activeElement')
  page.locator('#movies-search').fill('not a movie')
  assert page.get_by_role('button',name='Clear search').is_visible()
  page.get_by_role('button',name='Clear search').click()
  assert page.locator('.movie-card').count()==5
  print('PASS custom titles retained; search, sort and empty search reset work',flush=True)
  card=page.locator('.movie-card').filter(has_text='The Batman — Official Trailer')
  card.get_by_role('button',name='Play YouTube video').click()
  original=card.locator('iframe').element_handle(); original_frame=original.content_frame()
  page.locator('#movies-search').fill('batman')
  assert card.locator('iframe').evaluate('(el,original)=>el===original',original)
  assert card.locator('iframe').element_handle().content_frame() is original_frame
  page.locator('#movies-search').fill('')
  print('PASS active playback survives list filtering',flush=True)
  card.get_by_role('button',name='Options for movie The Batman — Official Trailer',exact=True).click()
  page.get_by_role('button',name='Delete movie',exact=True).click()
  page.get_by_role('button',name='Movie recycle bin',exact=True).click()
  page.get_by_role('button',name='Restore movie',exact=True).click()
  page.get_by_role('button',name='Watchlist',exact=True).click()
  card.get_by_role('button',name='Mark watched',exact=True).click()
  page.get_by_role('button',name='Watched',exact=True).click()
  assert page.locator('.movie-title').filter(has_text='The Batman — Official Trailer').count()==1
  page.locator('#all-notes').click();assert 'The Batman' not in page.locator('#recent-grid').inner_text()
  page.locator('#recent-notes').click();assert 'The Batman' not in page.locator('#recent-grid').inner_text()
  page.locator('#movies-notes').click()
  page.screenshot(path='/tmp/smart-movies-desktop.png',full_page=True)
  page.set_viewport_size({'width':390,'height':844})
  page.screenshot(path='/tmp/smart-movies-mobile.png',full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors,errors
  print('PASS menu delete/restore, watched state, note separation and mobile layout; no browser errors',flush=True)
  browser.close()
finally:server.shutdown()
