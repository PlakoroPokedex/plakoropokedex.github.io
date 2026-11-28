'use strict';
// The website's shared snapshots are refreshed by GitHub even when it is closed.
window.PublishedCards=(()=>{
 const enabled=location.protocol==='https:'&&location.hostname==='plakoropokedex.github.io';
 let pending=null,last=0,latest=null;
 const stamp=d=>Date.parse(d?.sourceUpdatedAt||d?.checkedAt||d?.snapshotDate||'')||0;
 const newer=(candidate,current)=>candidate?.revision!==current?.revision&&stamp(candidate)>=stamp(current);
 const assetPath=p=>typeof p==='string'&&/^(cards|chronicle-cards|rule-assets)\/[A-Za-z0-9_.-]+\.png$/.test(p);
 function images(data){const out=[];function visit(v){if(!v||typeof v!=='object')return;if(typeof v.image==='string')out.push(v);for(const [k,value]of Object.entries(v))if(k!=='image')visit(value);}visit(data);return out;}
 async function request(path,signal,kind='json'){const control=new AbortController(),abort=()=>control.abort(),timer=setTimeout(abort,45000);signal?.addEventListener('abort',abort,{once:true});try{if(signal?.aborted)throw Error('Update paused.');const r=await fetch(path,{cache:'no-store',credentials:'omit',signal:control.signal});if(!r.ok)throw Error('Published cards are temporarily unavailable.');return await r[kind]();}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
 async function manifest(){
  if(!enabled)return null;if(pending)return pending;if(latest&&Date.now()-last<5000)return latest;
  pending=(async()=>{const d=await request('site-cards.json?check='+Date.now());if(d.version!==1||!d.plakoro||!d.chronicle)throw Error('Invalid published card index.');latest=d;last=Date.now();const node=document.getElementById('published-status');if(node){const unavailable=Object.values(d.sources||{}).some(s=>s.state!=='current');node.textContent=(unavailable?'Website checked; some source uploads are pending or unavailable. Latest complete cards kept. ':'Website cards checked: ')+new Date(d.checkedAt).toLocaleString();}return d;})();
  try{return await pending;}finally{pending=null;}
 }
 async function download(kind,current,status=()=>{},signal){
  if(!enabled)return null;const index=await manifest(),entry=index[kind];
  if(entry.revision===current.revision)return null;
  if(!new RegExp('^snapshots/'+kind+'-[a-f0-9]{64}\\.json$').test(entry.file))throw Error('Invalid published snapshot path.');
  const data=await request(entry.file,signal);
  if(data.revision!==entry.revision||!Array.isArray(data.pokemon)||data.source!==current.source)throw Error('Published cards failed validation.');
  if(!newer(data,current))return null;
  if(kind==='plakoro')PlakoroSync.validate(data);else ChronicleSync.validate(data);
  const prior=new Map(images(current).filter(c=>c.image.startsWith('data:image/png;base64,')).map(c=>[c.imageSha,c.image]));
  const jobs=new Map();
  for(const c of images(data)){
   if(!assetPath(c.image))throw Error('Unexpected published card image.');
   if(c.imageSha&&prior.has(c.imageSha)){c.image=prior.get(c.imageSha);continue;}
   if(!jobs.has(c.image))jobs.set(c.image,[]);jobs.get(c.image).push(c);
  }
  let at=0,done=0;const entries=[...jobs];status('Loading the website’s latest cards…');
  const results=await Promise.allSettled(Array.from({length:Math.min(4,entries.length)},async()=>{
   while(at<entries.length){const [url,targets]=entries[at++];const bytes=new Uint8Array(await request(url,signal,'arrayBuffer'));
    if(bytes.length>32*1024*1024||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))throw Error('Incomplete published card image.');
    let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));const image='data:image/png;base64,'+btoa(binary);for(const card of targets)card.image=image;
    status(`Saving website cards for offline use: ${++done}/${entries.length}`);
   }
  }));
  const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;if(signal?.aborted)throw Error('Update paused.');return data;
 }
 return {enabled,stamp,newer,manifest,download};
})();
