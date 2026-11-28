import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {safeAsset,images} from './refresh-cards.mjs';
import {parseFolder,publicDrive} from './public-drive.mjs';
const script=await fs.readFile(new URL('./published-cards.js',import.meta.url),'utf8');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6YdAAAAAASUVORK5CYII=','base64');
const old={source:'https://github.com/Jollto/PlakoroDB',revision:'a'.repeat(40),sourceUpdatedAt:'2026-11-20T01:00:00Z',pokemon:[]};
const next={...old,revision:'b'.repeat(40),sourceUpdatedAt:'2026-11-21T01:00:00Z',pokemon:[{id:'pikachu',image:'cards/test.png',moves:[{id:'move',image:'cards/test.png'}]}]};
function client(data=next,broken=false,location={protocol:'https:',hostname:'plakoropokedex.github.io'}){
 const calls=[],status={textContent:''},entry={file:'snapshots/plakoro-'+'f'.repeat(64)+'.json',revision:data.revision};
 const w={location,URL,AbortController,setTimeout,clearTimeout,Uint8Array,Date,btoa,document:{getElementById:()=>status},PlakoroSync:{validate:d=>d},ChronicleSync:{validate:d=>d},fetch:async url=>{
  calls.push(url);if(url.startsWith('site-cards.json'))return Response.json({version:1,checkedAt:'2026-11-22T00:00:00Z',plakoro:entry,chronicle:entry,sources:{plakoro:{state:'current'},chronicle:{state:'current'}}});
  if(url.startsWith('snapshots/'))return Response.json(data);return new Response(broken?'not a PNG':png);
 }};w.window=w;vm.runInNewContext(script,w);return {api:w.PublishedCards,calls,status};
}
test('published snapshots load original PNGs once and preserve the old data until complete',async()=>{
 const {api,calls}=client(),before=JSON.stringify(old),data=await api.download('plakoro',old);
 assert.equal(data.revision,next.revision);assert.equal(images(data).length,2);
 assert(images(data).every(c=>c.image==='data:image/png;base64,'+png.toString('base64')));
 assert.equal(calls.filter(p=>p==='cards/test.png').length,1);assert.equal(JSON.stringify(old),before);
});
test('broken assets reject the whole new snapshot',async()=>{const {api}=client(next,true);await assert.rejects(api.download('plakoro',old),/Incomplete/);assert.equal(old.pokemon.length,0);});
test('a newer device snapshot cannot be rolled back by a published snapshot',async()=>{const {api,calls}=client();assert.equal(await api.download('plakoro',{...old,sourceUpdatedAt:'2026-11-25T00:00:00Z'}),null);assert.equal(calls.length,2);});
test('unchanged revisions only check the shared manifest; parallel callers coalesce',async()=>{const {api,calls}=client();await Promise.all([api.download('plakoro',next),api.download('plakoro',next)]);assert.equal(calls.length,1);});
test('wrong sources and external asset URLs are rejected',async()=>{await assert.rejects(client({...next,source:'https://wrong.test'}).api.download('plakoro',old),/validation/);await assert.rejects(client({...next,pokemon:[{image:'https://wrong.test/card.png'}]}).api.download('plakoro',old),/Unexpected/);assert.throws(()=>safeAsset('cards/../../secret.png'));});
test('portable HTML and Android keep their existing public-source updater',async()=>{const {api,calls}=client(next,false,{protocol:'file:',hostname:''});assert.equal(await api.download('plakoro',old),null);assert.equal(calls.length,0);});
test('an older fallback Drive feed cannot replace newer website cards',async()=>{
 const current={version:1,source:'https://drive.google.com/drive/folders/public',revision:'fresh',checkedAt:'2026-11-25T00:00:00Z',pokemon:[],moves:[],complete:true};
 const calls=[],w={CHRONICLE_DATA:current,CHRONICLE_SOURCE_URL:current.source,CHRONICLE_FEED_URL:'https://plakoro-public-card-feed.rusty-grass1.chatgpt.site/api/chronicle',ChronicleOG:{catalogue:d=>d},CardCache:{create:()=>({record:async()=>null})},document:{getElementById:()=>null},navigator:{onLine:true},URL,AbortController,setTimeout,clearTimeout,fetch:async url=>{calls.push(String(url));return Response.json({...current,revision:'old',checkedAt:'2026-11-20T00:00:00Z'});}};w.window=w;
 vm.runInNewContext(await fs.readFile(new URL('./chronicle-sync.js',import.meta.url),'utf8'),w);
 assert.equal(await w.ChronicleSync.download(current,new AbortController().signal),null);assert.equal(calls.length,1);assert.equal(w.CHRONICLE_DATA.revision,'fresh');
});
test('an up-to-date published website does not ask each visitor to scan external databases',async()=>{
 const w={CHRONICLE_DATA:{source:'public-drive',pokemon:[],moves:[]},CHRONICLE_SOURCE_URL:'public-drive',ChronicleOG:{catalogue:d=>d},CardCache:{create:()=>({})},PublishedCards:{enabled:true,download:async()=>null},document:{getElementById:()=>null},fetch:async()=>assert.fail('No external source request is needed')};w.window=w;
 for(const file of ['sync.js','chronicle-sync.js'])vm.runInNewContext(await fs.readFile(new URL('./'+file,import.meta.url),'utf8'),w);
 assert.equal(await w.PlakoroSync.download({},()=>{}),null);assert.equal(await w.ChronicleSync.download({},new AbortController().signal),null);
});
function page(rows){return "<script>window['_DRIVE_ivd'] = '"+JSON.stringify(JSON.stringify([rows,null,null,null])).slice(1,-1)+"';</script>";}
const id='public_folder_id_1234567890';
const rows=Array.from({length:50},(_,i)=>['public_file_id_'+String(i).padStart(10,'0'),[id],'Card '+i,'image/png',null,null,null,null,null,null,1234567890]);
test('public Drive timestamps are parsed as data; empty folders are valid',()=>{const list=parseFolder(page(rows));assert.equal(list.length,50);assert.equal(list[0].modified,1234567890);assert.deepEqual(parseFolder(page(null)),[]);assert.throws(()=>parseFolder('<html>Sign in</html>'),/public folder/);});
test('50-item public Drive pages are expanded instead of silently dropping cards',async()=>{
 const extra=['public_file_id_0000000050',[id],'Last Card','image/png'];
 const embedded='<html class="flip-embedded"><div id="flip-contents">'+[...rows,extra].map(r=>'<div class="flip-entry" id="entry-'+r[0]+'"><a href="https://drive.google.com/file/d/'+r[0]+'/view"><div class="flip-entry-title">'+r[2]+'</div></a></div>').join('')+'</div></html>';
 const reader=publicDrive(async url=>new Response(url.includes('embeddedfolderview')?embedded:page(rows)));
 const found=await reader.list(id);assert.equal(found.length,51);assert.equal(found[0].modified,1234567890);assert.equal(found[50].modified,undefined);
});
