const assert = require('node:assert/strict');
const handler = require('../api/movie-preview');
let calls = [], upstream;
global.fetch = async (url,options) => {calls.push({url,options});return upstream(url,options)};
async function request(url,method='GET',refresh) {const output={headers:{},statusCode:null};const res={setHeader:(key,value)=>output.headers[key]=value,status(code){output.statusCode=code;return this},json(data){output.data=data;return output}};await handler({method,query:{url,refresh}},res);return output}
(async()=>{
 for(const url of ['http://127.0.0.1/admin','http://169.254.169.254/latest/meta-data','https://youtube.com.evil.invalid/watch?v=dQw4w9WgXcQ','https://youtube.com:444/watch?v=dQw4w9WgXcQ','https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ','file:///etc/passwd','https://www.imdb.com/redirect?url=http://localhost','https://youtu.be/not-valid']){const before=calls.length;assert.equal((await request(url)).statusCode,400);assert.equal(calls.length,before)}
 assert.equal((await request('https://youtu.be/dQw4w9WgXcQ','POST')).statusCode,405);
 upstream = async () => new Response(JSON.stringify({title:'Real trailer title',author_name:'Studio',thumbnail_url:'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'}));
 let result=await request('https://youtu.be/dQw4w9WgXcQ?t=20&secret=omit');assert.equal(result.statusCode,200);assert.equal(result.data.title,'Real trailer title');assert.equal(result.data.provider,'YouTube');assert.ok(!calls.at(-1).url.includes('secret'));assert.equal(calls.at(-1).options.redirect,'manual');assert.ok(!calls.at(-1).options.headers.Cookie);
 assert.equal((await request('https://youtu.be/dQw4w9WgXcQ','GET','1')).headers['Cache-Control'],'no-store');
 upstream = async () => new Response(JSON.stringify({title:'Vimeo trailer',thumbnail_url:'http://localhost/secret'}));result=await request('https://vimeo.com/1234567');assert.equal(result.statusCode,200);assert.equal(result.data.poster,'');
 upstream = async () => new Response('<meta content="Movie &amp; Friends (2026) - IMDb" property="og:title"><meta property="og:image" content="https://m.media-amazon.com/images/M/test.jpg">');result=await request('https://www.imdb.com/title/tt1234567/?ref_=tracking');assert.equal(result.statusCode,200);assert.equal(result.data.title,'Movie & Friends (2026)');assert.equal(result.data.year,'2026');assert.ok(!calls.at(-1).url.includes('tracking'));
 upstream = async () => new Response('<meta property="og:title" content="1917 (2019) - IMDb">');assert.equal((await request('https://www.imdb.com/title/tt1234567/')).data.year,'2019');
 upstream = async () => new Response('',{status:302,headers:{Location:'http://127.0.0.1/private'}});const count=calls.length;assert.equal((await request('https://youtu.be/dQw4w9WgXcQ')).statusCode,502);assert.equal(calls.length,count+1);
 upstream = async () => new Response('oversized',{headers:{'content-length':'1000001'}});assert.equal((await request('https://youtu.be/dQw4w9WgXcQ')).statusCode,502);
 upstream = async () => {throw Error('Offline')};result=await request('https://youtu.be/dQw4w9WgXcQ');assert.equal(result.statusCode,502);assert.equal(result.headers['Cache-Control'],'no-store');
 console.log('PASS movie preview API: host/protocol/port/credential checks, canonical URLs, YouTube/Vimeo/IMDb metadata, unsafe images, redirects, size limits and offline fallback');
})().catch(error=>{console.error(error);process.exitCode=1});
