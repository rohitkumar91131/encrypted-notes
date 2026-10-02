// Public link previews only. Never fetch arbitrary user-supplied hosts or redirects.
function target(value) {
  const url = new URL(value);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port) throw Error('Unsupported movie link');
  const host = url.hostname.toLowerCase();
  let id;
  if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : /^(shorts|embed|live)$/.test(url.pathname.split('/')[1]) ? url.pathname.split('/')[2] : null;
  } else if (host === 'youtu.be') id = url.pathname.split('/')[1];
  if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return {provider:'YouTube', endpoint:'https://www.youtube.com/oembed?format=json&url='+encodeURIComponent('https://www.youtube.com/watch?v='+id)};
  if (['vimeo.com','www.vimeo.com'].includes(host) && /^\/[0-9]+\/?$/.test(url.pathname)) return {provider:'Vimeo', endpoint:'https://vimeo.com/api/oembed.json?url='+encodeURIComponent('https://vimeo.com/'+url.pathname.split('/')[1])};
  const imdb = /^\/title\/(tt[0-9]+)(?:\/|$)/.exec(url.pathname);
  if (['imdb.com','www.imdb.com','m.imdb.com'].includes(host) && imdb) return {provider:'IMDb', endpoint:'https://www.imdb.com/title/'+imdb[1]+'/'};
  throw Error('Supported previews: YouTube, Vimeo and IMDb title links');
}
function text(value) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,300) : ''; }
function image(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['i.ytimg.com','img.youtube.com','i.vimeocdn.com','m.media-amazon.com','ia.media-imdb.com','images-na.ssl-images-amazon.com'].includes(url.hostname) ? url.href : ''; }
  catch (_) { return ''; }
}
function entities(value) {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt);/gi, (all,key) => {
    if (key[0] !== '#') return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[key.toLowerCase()] || all;
    const point = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : parseInt(key.slice(1),10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
}
function meta(html, name) {
  for (const tag of html.match(/<meta\s[^>]*>/gi) || []) {
    const attrs = {};
    for (const match of tag.matchAll(/([a-z_:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) attrs[match[1].toLowerCase()] = entities(match[2] ?? match[3]);
    if ((attrs.property || attrs.name) === name) return attrs.content || '';
  }
  return '';
}
async function body(response) {
  if (Number(response.headers.get('content-length')) > 1000000) throw Error('Preview too large');
  const reader = response.body.getReader(); let length = 0, chunks = [];
  for (;;) { const {done,value} = await reader.read(); if (done) break; length += value.length; if (length > 1000000) { await reader.cancel(); throw Error('Preview too large'); } chunks.push(value); }
  return Buffer.concat(chunks).toString('utf8');
}
module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).json({error:'GET required'}); }
  let info;
  try { const value = req.query?.url; if (typeof value !== 'string' || value.length > 2048) throw Error('Invalid link'); info = target(value); }
  catch (error) { return res.status(400).json({error:error.message}); }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(info.endpoint, {signal:controller.signal, redirect:'manual', headers:{'User-Agent':'EncryptedNotesPreview/1.0','Accept':info.provider === 'IMDb' ? 'text/html' : 'application/json'}});
    if (!response.ok) throw Error('Preview unavailable');
    const source = await body(response);
    let result;
    if (info.provider === 'IMDb') {
      const title = text(meta(source,'og:title')).replace(/\s*[-–]\s*IMDb\s*$/i,'');
      result = {title, poster:image(meta(source,'og:image')), provider:info.provider, year:(/\(((?:19|20)[0-9]{2})\)/.exec(title)||[])[1] || ''};
    } else {
      const data = JSON.parse(source);
      result = {title:text(data.title), poster:image(data.thumbnail_url), author:text(data.author_name), provider:info.provider};
    }
    if (!result.title) throw Error('Preview unavailable');
    res.setHeader('Cache-Control',req.query?.refresh==='1'?'no-store':'public, max-age=3600, s-maxage=86400');
    return res.status(200).json(result);
  } catch (_) { res.setHeader('Cache-Control','no-store'); return res.status(502).json({error:'Preview unavailable. You can still save a movie name and link.'}); }
  finally { clearTimeout(timer); }
};
