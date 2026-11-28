// Build an atomic, self-contained public website from the two public databases.
// Runs in GitHub Actions, without a visitor, Google login or stored API keys.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {publicDrive,SOURCE,PNG_MAX_BYTES,mapLimit} from './public-drive.mjs';
import {scanCatalogue,availableCatalogue,publicManifest} from './catalogue.mjs';

export const SITE='https://plakoropokedex.github.io/';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function safeAsset(name){if(typeof name!=='string'||! /^(cards|chronicle-cards|rule-assets)\/[A-Za-z0-9_.-]+\.png$/.test(name))throw Error('Unexpected published image path.');return name;}
export function images(data){const out=[];function visit(v){if(!v||typeof v!=='object')return;if(typeof v.image==='string')out.push(v);for(const [key,value]of Object.entries(v))if(key!=='image')visit(value);}visit(data);return out;}
export async function request(url,kind='json'){
 for(let attempt=0;attempt<3;attempt++){
  try{
   const headers={};if(url.startsWith('https://api.github.com/repos/Jollto/PlakoroDB/')&&process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;
   const r=await fetch(url,{headers,signal:AbortSignal.timeout(45000),redirect:'follow'});
   if(!r.ok)throw Object.assign(Error('Source returned HTTP '+r.status),{status:r.status,retryable:r.status===429||r.status>=500});
   if(kind==='bytes'){const b=Buffer.from(await r.arrayBuffer());if(b.length>PNG_MAX_BYTES||!b.subarray(0,8).equals(PNG))throw Error('Source did not return a complete PNG.');return b;}
   return await r[kind]();
  }catch(e){if(attempt===2||e.retryable===false)throw e;await new Promise(r=>setTimeout(r,500*(attempt+1)));}
 }
}
async function readJSON(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}}
async function write(file,data){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data);}
async function bundle(file,variable){const source=await fs.readFile(file,'utf8');const prefix='window.'+variable+' = ';if(!source.startsWith(prefix))throw Error('Invalid bundled data.');return JSON.parse(source.slice(prefix.length).trim().replace(/;$/,''));}
function parser(source){const context={window:{},CardCache:{create:()=>({})}};vm.runInNewContext(source,context);return context.window.PlakoroSync;}

export async function refreshModern(previous,out,cache,parse){
 const api='https://api.github.com/repos/Jollto/PlakoroDB/';
 const head=await request(api+'commits/main');if(!/^[a-f0-9]{40}$/.test(head.sha))throw Error('Invalid PlakoroDB revision.');
 if(head.sha===previous.revision)return {...previous,sourceUpdatedAt:head.commit.committer.date};
 const result=await request(api+'git/trees/'+head.sha+'?recursive=1');if(result.truncated||!Array.isArray(result.tree))throw Error('Incomplete PlakoroDB listing.');
 const tree=result.tree.filter(f=>f.type==='blob');
 const raw=file=>'https://raw.githubusercontent.com/Jollto/PlakoroDB/'+head.sha+'/'+file.split('/').map(encodeURIComponent).join('/');
 const pokemon=parse.parseCharacters(await request(raw('database/text/characards.md'),'text'),tree);
 const moveFiles=tree.filter(f=>/^database\/text\/wazacards\/.*\.md$/.test(f.path));
 const texts=await mapLimit(moveFiles,4,f=>request(raw(f.path),'text'));
 for(const p of pokemon)for(const text of texts){const blocks=text.split(/^#### /m).slice(1).filter(b=>new RegExp('^\\|\\s*Pokémon\\s*\\|\\s*'+p.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\|','m').test(b));if(blocks.length)p.moves.push(...parse.parseMoves(blocks.map(b=>'#### '+b).join('\n'),p,tree));}
 const next=parse.validate({source:previous.source,revision:head.sha,sourceUpdatedAt:head.commit.committer.date,snapshotDate:head.commit.committer.date.slice(0,10),pokemon});
 const used=new Set(pokemon.flatMap(p=>p.moves.map(m=>m.image)));
 if(tree.some(f=>/^database\/cards\/wazacards\/.*\.png$/.test(f.path)&&!used.has(f.path)))throw Error('PlakoroDB contains unmapped move images.');
 await mapLimit(pokemon.flatMap(p=>[p,...p.moves]),4,async card=>{
  const relative='cards/'+card.imageSha+'.png',cached=path.join(cache,relative);let bytes;
  try{bytes=await fs.readFile(cached);}catch{bytes=await request(raw(card.image),'bytes');}
  const sha=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  if(sha!==card.imageSha)throw Error('PlakoroDB image failed integrity verification.');
  await write(cached,bytes);await write(path.join(out,relative),bytes);card.image=relative;
 });
 return next;
}

export async function refreshChronicle(previous,out,cache){
 const original=publicDrive();let folders=0;
 const reader={list:async id=>{const rows=await original.list(id);if(++folders%25===0)console.log('Checked '+folders+' public Drive folders');return rows;},read:async file=>{
  const key=file.modified?path.join(cache,'drive-files',file.id+'-'+file.modified+'-v1.bin'):null;
  if(key){try{return new Uint8Array(await fs.readFile(key));}catch{}}
  const bytes=await original.read(file);if(key)await write(key,bytes);return bytes;
 }};
 const scanned=await scanCatalogue(reader,async(key,bytes)=>{
  const [,id,file]=key.split('/'),relative='chronicle-cards/'+id+'-'+file;
  await write(path.join(cache,relative),bytes);await write(path.join(out,relative),bytes);
 },p=>{if(p.phase==='listed')console.log('Drive: '+p.folders+' folders, '+p.files+' files');else if(p.completed%20===0)console.log('Verified '+p.completed+' Drive cards');});
 const old={...previous,assets:{}};
 for(const c of images(old))if(c.driveId&&c.imageSha)old.assets[c.driveId]={revision:c.imageSha.slice(c.driveId.length+1),key:c.image};
 const next=publicManifest(await availableCatalogue(scanned,old));
 if(!next.complete)throw Error('No complete Chronicle snapshot is available.');
 for(const c of images(next))if(c.image.startsWith('drive:'))c.image='chronicle-cards/'+c.driveId+'-'+c.imageSha.slice(c.driveId.length+1)+'.png';
 next.cardPolicy='og-only';return next;
}

export async function build(root=ROOT,out=path.join(root,'_site')){
 const cache=path.join(root,'.card-cache');await fs.mkdir(cache,{recursive:true});
 await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
 for(const entry of await fs.readdir(root,{withFileTypes:true})){
  if(entry.isFile()&&/\.(html|js|css|json|txt|svg)$/.test(entry.name))await fs.copyFile(path.join(root,entry.name),path.join(out,entry.name));
  else if(entry.isDirectory()&&['cards','chronicle-cards','rule-assets'].includes(entry.name))await fs.cp(path.join(root,entry.name),path.join(out,entry.name),{recursive:true});
 }
 const saved={plakoro:await readJSON(path.join(cache,'plakoro.json')),chronicle:await readJSON(path.join(cache,'chronicle.json'))};
 const previous={plakoro:saved.plakoro||await bundle(path.join(root,'data.js'),'PLAKORO_DATA'),chronicle:saved.chronicle||await bundle(path.join(root,'chronicle-data.js'),'CHRONICLE_DATA')};
 // Recover the deployed snapshot if the build cache has expired. A failed
 // source must never cause the website to revert to the older seed cards.
 try{
  const remote=await request(SITE+'site-cards.json?check='+Date.now());
  for(const kind of ['plakoro','chronicle'])if(remote[kind]?.file&&/^snapshots\/[a-z]+-[a-f0-9]{64}\.json$/.test(remote[kind].file)){
   const published=await request(SITE+remote[kind].file);
   if(Date.parse(published.publishedAt||published.checkedAt||published.snapshotDate)>Date.parse(previous[kind].publishedAt||previous[kind].checkedAt||previous[kind].snapshotDate))previous[kind]=published;
  }
 }catch(e){if(e.status!==404&&(!saved.plakoro||!saved.chronicle))throw Error('Cannot recover the last published cards; keeping the live website unchanged. '+e.message);console.log('Using the saved build snapshot ('+e.message+').');}
 const parse=parser(await fs.readFile(path.join(root,'sync.js'),'utf8'));
 const results=await Promise.allSettled([refreshModern(previous.plakoro,out,cache,parse),refreshChronicle(previous.chronicle,out,cache)]);
 const checkedAt=new Date().toISOString(),manifest={version:1,checkedAt,cadenceMinutes:30,sources:{}};
 for(const [i,kind]of ['plakoro','chronicle'].entries()){
  const result=results[i],success=result.status==='fulfilled',data=success?result.value:previous[kind];
  if(!success)console.warn(kind+' refresh kept its previous snapshot: '+result.reason.message);
  parse.validate(kind==='plakoro'?data:previous.plakoro);
  if(kind==='chronicle'&&(data.source!==SOURCE||!data.complete||!Array.isArray(data.pokemon)||!Array.isArray(data.moves)))throw Error('Invalid Chronicle snapshot.');
  data.publishedAt=checkedAt;if(success)data.lastSuccessfulCheck=checkedAt;
  const assets=new Map(images(data).map(c=>[safeAsset(c.image),c]));
  await mapLimit([...assets.keys()],4,async relative=>{
   let bytes;for(const base of [out,cache,root]){try{bytes=await fs.readFile(path.join(base,relative));break;}catch{}}
   if(!bytes)bytes=await request(SITE+relative,'bytes');
   if(!bytes.subarray(0,8).equals(PNG))throw Error('Invalid retained PNG.');
   await write(path.join(out,relative),bytes);await write(path.join(cache,relative),bytes);
  });
  const json=JSON.stringify(data),file='snapshots/'+kind+'-'+hash(json)+'.json';await write(path.join(out,file),json);
  await write(path.join(cache,kind+'.json'),json);
  manifest[kind]={file,revision:data.revision,pokemon:data.pokemon.length,moves:data.pokemon.reduce((n,p)=>n+p.moves.length,0)+(data.moves?.length||0)};
  manifest.sources[kind]={state:success?(data.sourceComplete===false?'pending-uploads':'current'):'unavailable',lastSuccessfulCheck:success?checkedAt:data.lastSuccessfulCheck||null,warnings:success?data.warnings||[]:[result.reason.message]};
  await write(path.join(out,kind==='plakoro'?'data.js':'chronicle-data.js'),'window.'+(kind==='plakoro'?'PLAKORO_DATA':'CHRONICLE_DATA')+' = '+json+';\n');
  if(kind==='chronicle')await write(path.join(out,'chronicle-feed.json'),json);
 }
 await write(path.join(out,'site-cards.json'),JSON.stringify(manifest));
 let html=await fs.readFile(path.join(out,'index.html'),'utf8');
 const filenames=[...new Set([...html.matchAll(/(?:src|href)="([A-Za-z0-9_.-]+\.(?:js|css))(?:\?[^"]*)?"/g)].map(m=>m[1]))];
 for(const name of filenames){const rev=hash(await fs.readFile(path.join(out,name))).slice(0,16);html=html.replace(new RegExp('((?:src|href)=")'+name.replaceAll('.','\\.')+'(?:\\?[^" ]*)?"','g'),'$1'+name+'?v='+rev+'"');}
 await write(path.join(out,'index.html'),html);await write(path.join(out,'.nojekyll'),'');
 // This daily health record documents that the unattended job is still
 // working and keeps the repository active during long gaps between cards.
 if(results.every(r=>r.status==='fulfilled'))await write(path.join(root,'update-check.json'),JSON.stringify({date:checkedAt.slice(0,10),plakoro:manifest.plakoro.revision,chronicle:manifest.chronicle.revision},null,2)+'\n');
 console.log(JSON.stringify(manifest,null,2));return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await build();
