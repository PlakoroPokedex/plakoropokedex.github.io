// Reads only anonymous, publicly shared Google Drive pages. No OAuth or cookies.
import {KORO_MAX_BYTES,readKoroMetadata} from './koro-metadata.mjs';
export const ROOT_ID='1g7KX3NYqRm6mVtbo_hIkir_6QT27E-tW';
export const SOURCE='https://drive.google.com/drive/folders/'+ROOT_ID;
const ID=/^[A-Za-z0-9_-]{20,100}$/;
const utf8=new TextDecoder();
export const PNG_MAX_BYTES=32*1024*1024;
export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof bytes==='string'?new TextEncoder().encode(bytes):bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function decode(s){return s.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp);/gi,(_,num,name)=>num?String.fromCodePoint(num[0].toLowerCase()==='x'?parseInt(num.slice(1),16):Number(num)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[name.toLowerCase()]);}
function text(s){return decode(s.replace(/<[^>]*>/g,'')).trim();}
export function parseFolder(html){
 // The normal public folder page supplies exact modification timestamps.
 // Decode its JSON string as data; never execute scripts returned by Drive.
 const literal=/window\['_DRIVE_ivd'\]\s*=\s*'((?:\\.|[^'\\])*)'/.exec(html)?.[1];
 if(literal){
  const decoded=JSON.parse('"'+literal.replace(/\\x([a-f0-9]{2})/gi,(_,h)=>'\\u00'+h).replace(/\\'/g,"'")+'"');
  const data=JSON.parse(decoded);
  if(!Array.isArray(data)||data[1]||data[2]||data[3]||data[0]!==null&&!Array.isArray(data[0]))throw Error('Drive listing is incomplete or paginated. Keeping the previous catalogue.');
  return (data[0]||[]).map(row=>{
   if(!ID.test(row[0])||typeof row[2]!=='string'||!Array.isArray(row[1]))throw Error('Invalid public Drive entry.');
   const kind=row[3]==='application/vnd.google-apps.folder'?'folder':row[3]==='application/vnd.google-apps.document'?'document':row[3]==='application/vnd.google-apps.shortcut'?'unsupported':'file';
   return {id:row[0],name:row[2],kind,modified:Number.isFinite(row[10])?row[10]:null,parents:row[1]};
  });
 }
 if(!/class="[^"]*flip-embedded/.test(html)||!/id="flip-contents"/.test(html))throw Error('Drive did not return a public folder listing.');
 const rows=[...html.matchAll(/<div\b[^>]*\bclass="flip-entry"[^>]*\bid="entry-([A-Za-z0-9_-]+)"[^>]*>/g)],entries=[];
 for(let i=0;i<rows.length;i++){
  const id=rows[i][1],part=html.slice(rows[i].index,(rows[i+1]?.index??html.length));
  const href=part.match(/<a\b[^>]*\bhref="([^"]+)"/)?.[1],name=part.match(/<div\b[^>]*class="flip-entry-title"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  if(!ID.test(id)||!href||name===undefined)throw Error('Unrecognized Drive folder entry.');
  const url=new URL(decode(href));let kind;
  if(url.hostname==='drive.google.com'&&url.pathname==='/drive/folders/'+id)kind='folder';
  else if(url.hostname==='drive.google.com'&&url.pathname==='/file/d/'+id+'/view')kind='file';
  else if(url.hostname==='docs.google.com'&&url.pathname.startsWith('/document/d/'+id+'/'))kind='document';
  else kind='unsupported';
  entries.push({id,name:text(name),kind});
 }
 if(!rows.length&&/https:\/\/(?:drive|docs)\.google\.com\/(?:file|drive\/folders|document)\//.test(html))throw Error('Drive listing changed; refusing a partial catalogue.');
 if(new Set(entries.map(f=>f.id)).size!==entries.length)throw Error('Duplicate Drive folder entries.');
 return entries;
}
async function getBytes(url,limit,fetcher,timeout=8000,metadata=false){
 for(let attempt=0;attempt<2;attempt++){
 try{return await readBytes(url,limit,fetcher,timeout,metadata);}catch(error){
  if(attempt===1||error.retryable===false)throw error;
  await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));
 }
 }
}
async function readBytes(url,limit,fetcher,timeout,metadata){
 const response=await fetcher(url,{credentials:'omit',redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(timeout)});
 if(!response.ok){await response.body?.cancel();const error=Error('Public Drive download failed ('+response.status+').');error.retryable=response.status===429||response.status>=500;throw error;}
 const host=new URL(response.url||url).hostname;
 if(!['drive.google.com','drive.usercontent.google.com','docs.google.com'].includes(host)&&!host.endsWith('.googleusercontent.com')){await response.body?.cancel();throw Object.assign(Error('Unexpected Drive redirect.'),{retryable:false});}
 const oversized=()=>Object.assign(Error('Drive file exceeds the supported size ('+Math.round(limit/1024/1024)+' MiB per file).'),{retryable:false});
 if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw oversized();}
 if(metadata)return readKoroMetadata(response.body,{maxBytes:limit});
 const reader=response.body.getReader(),chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw oversized();}chunks.push(value);}
 const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}return out;
}
export function publicDrive(fetcher=fetch){return {
 async list(id){
  if(!ID.test(id))throw Error('Invalid folder ID.');
  const entries=parseFolder(utf8.decode(await getBytes('https://drive.google.com/drive/folders/'+id,8*1024*1024,fetcher,20000)));
  if(entries.some(f=>f.parents&&!f.parents.includes(id)))throw Error('Unexpected Drive parent.');
  // Drive's normal page only embeds its first 50 items. The public embedded
  // listing supplies the complete folder; missing timestamps disable reuse.
  if(entries.length>=50){
   const full=parseFolder(utf8.decode(await getBytes('https://drive.google.com/embeddedfolderview?id='+id,8*1024*1024,fetcher,20000)));
   if(entries.some(f=>!full.some(g=>g.id===f.id)))throw Error('Drive folder changed during listing.');
   return full.map(f=>({...f,...entries.find(g=>g.id===f.id)}));
  }
  return entries;
 },
 async read(file){if(!ID.test(file.id))throw Error('Invalid file ID.');const url=file.kind==='document'?'https://docs.google.com/document/d/'+file.id+'/export?format=txt':'https://drive.google.com/uc?export=download&id='+file.id,metadata=/\.koro$/i.test(file.name);try{return await getBytes(url,metadata?KORO_MAX_BYTES:/\.png$/i.test(file.name)?PNG_MAX_BYTES:8*1024*1024,fetcher,35000,metadata);}catch(error){throw Object.assign(Error(file.name+': '+error.message),{retryable:error.retryable});}}
};}
export async function mapLimit(values,limit,fn){const output=new Array(values.length);let index=0;const results=await Promise.allSettled(Array.from({length:Math.min(limit,values.length)},async()=>{while(index<values.length){const at=index++;output[at]=await fn(values[at],at);}}));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;return output;}
export async function listCatalogue(reader){
 const files=[],folders=[],seen=new Set([ROOT_ID]);let level=[{id:ROOT_ID,path:[]}];
 while(level.length){const next=[];await mapLimit(level,4,async parent=>{
  const entries=await reader.list(parent.id);folders.push({id:parent.id,path:parent.path,count:entries.length});
  for(const entry of entries){if(entry.kind==='folder'){
   if(!parent.path.length&&!/^(1997|2026|Rules|Custom)$/i.test(entry.name))continue;
   if(/^(JP|REs?)$/i.test(entry.name)||seen.has(entry.id))continue;
   if(parent.path.length>=9||seen.size>=2000)throw Error('Catalogue folder limit reached.');
   seen.add(entry.id);next.push({id:entry.id,path:parent.path.concat(entry.name)});
  }else if(parent.path.length&&entry.kind!=='unsupported'){files.push({...entry,path:parent.path.slice()});if(files.length>20000)throw Error('Catalogue file limit reached.');}}
 });level=next;}
 return {files,folders};
}
