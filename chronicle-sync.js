'use strict';
window.ChronicleSync=(()=>{
 const endpoint=window.CHRONICLE_FEED_URL||'',expectedSource=window.CHRONICLE_SOURCE_URL||window.CHRONICLE_DATA?.source||'';
 window.CHRONICLE_DATA=ChronicleOG.catalogue(window.CHRONICLE_DATA);
 const CHECK_INTERVAL_MS=30*60*1000,RETRY_INTERVAL_MS=60*1000;
 let busy=false,last=0,started=false,timer=null,appActive=true,lastOpen=-Infinity,active=null,resumeRequested=false,retrySoon=false;
 let status=endpoint?'Bundled Chronicle cards ready. Drive checks on opening and every 30 minutes while open.':'Bundled Chronicle cards ready. The Drive update feed is not configured.';
 const paused=()=>Object.assign(Error('Update paused. Downloaded cards are saved; it will resume when the app opens.'),{paused:true});
 const invalid=message=>Object.assign(Error(message),{retryable:false});
 function assertActive(signal){if(signal?.aborted)throw paused();}
 function say(s){status=s;const el=document.getElementById('chronicle-status');if(el)el.textContent=s;}
 function cards(d){return [...d.pokemon.flatMap(p=>[p,...Object.values(p.editions||{}),...(p.moves||[])]),...(d.moves||[]),...[d.rules?.basic,d.rules?.howTo,d.rules?.switch].filter(Boolean)];}
 function validate(d){
  if(!d||d.version!==1||typeof d.revision!=='string'||!Array.isArray(d.pokemon)||!Array.isArray(d.moves))throw invalid('Invalid Chronicle catalogue.');
  if(d.complete===false){const detail=Array.isArray(d.warnings)&&d.warnings.length?' '+d.warnings.slice(0,2).join('; '):'';throw invalid('Drive uploads are incomplete.'+detail+' Keeping your saved cards.');}
  if(!expectedSource||d.source!==expectedSource)throw invalid('The update feed returned cards from a different folder. Keeping your saved cards.');
  // Exclude retired editions before validating or downloading any card assets.
  d=ChronicleOG.catalogue(d);
  if(d.pokemon.length>1000||d.moves.length>10000||new Set(d.pokemon.map(p=>p.id)).size!==d.pokemon.length)throw invalid('Invalid Chronicle catalogue.');
  for(const p of d.pokemon)if(!p.id||!p.name||!p.image||!Number.isFinite(p.hp)||!Array.isArray(p.moves)||!p.editions||!Object.keys(p.editions).length)throw invalid('Incomplete character metadata.');
  for(const m of [...d.moves,...d.pokemon.flatMap(p=>p.moves)])if(!m.id||!m.name||!m.owner||!m.image||m.edition!=='OG')throw invalid('Incomplete move metadata.');
  return d;
 }
 function wait(ms,signal){return new Promise((resolve,reject)=>{
  assertActive(signal);const abort=()=>{clearTimeout(id);reject(paused());};
  const id=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});
 });}
 async function request(params,signal){
  if(endpoint!=='https://plakoro-public-card-feed.rusty-grass1.chatgpt.site/api/chronicle')throw invalid('The Drive update feed is not configured.');
  const url=new URL(endpoint);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
  for(let attempt=0;attempt<3;attempt++){
   assertActive(signal);
   const controller=new AbortController(),abort=()=>controller.abort(),timeout=setTimeout(abort,90000);
   signal?.addEventListener('abort',abort,{once:true});
   try{
    const r=await fetch(url,{signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'follow'});
    if(!r.ok)throw Object.assign(Error('Drive update feed returned HTTP '+r.status+'.'),{retryable:r.status===429||r.status>=500});
    let d;
    if(params.format==='png'&&r.headers?.get('content-type')?.split(';')[0]==='image/png'){
     const bytes=new Uint8Array(await r.arrayBuffer());
     if(![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))throw invalid('The card download was not a PNG.');
     if(window.crypto?.subtle){const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(digest!==params.revision)throw invalid('A card download did not match its catalogue. Keeping the previous snapshot.');}
     let binary='';for(let at=0;at<bytes.length;at+=16384)binary+=String.fromCharCode(...bytes.subarray(at,at+16384));
     d={id:params.id,revision:params.revision,image:'data:image/png;base64,'+btoa(binary)};
    }else{
     // Older feeds may still return the legacy image envelope. Images are
     // not subject to the catalogue's metadata-only response limit.
     const text=await r.text();if(params.action!=='asset'&&text.length>14000000)throw invalid('The card catalogue contains too much metadata. Your saved cards are kept.');
     d=JSON.parse(text);
    }if(d.error)throw Error(d.error);assertActive(signal);return d;
   }catch(error){
    assertActive(signal);
    if(attempt===2||error.retryable===false||navigator.onLine===false)throw error;
    say('Connection interrupted. Retrying the saved update progress…');
   }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
   await wait(500*(attempt+1),signal);
  }
 }
 async function manifest(signal){
  const deadline=Date.now()+10*60*1000;let stalled=0,previous='';
  for(let steps=0;steps<500&&Date.now()<deadline;steps++){
   const d=await request({action:'sync'},signal);if(d.status!=='scanning')return validate(d);
   if(d.source!==expectedSource)throw invalid('The update feed returned a different folder.');
   const marker=JSON.stringify([d.phase,d.folders,d.remainingFolders,d.cards]);stalled=marker===previous?stalled+1:0;previous=marker;
   if(stalled>=6)throw Error('Drive scan is paused. Saved progress will resume automatically.');
   say(d.retrying?'Drive interrupted a download. Retrying saved progress…':d.phase==='folders'?`Checking Chronicle Drive folders: ${Number(d.folders)||0} checked…`:`Reading Chronicle cards: ${Number(d.cards)||0}/${Number(d.totalCards)||0}…`);
   await wait(Math.min(2000,Math.max(100,Number(d.retryAfterMs)||100)),signal);
  }
  throw Error('Drive scan needs more time. Saved progress will resume automatically.');
 }
 const offline=CardCache.create('plakoro-chronicle-v1',3);
 const stored=offline.record,cache=value=>value===undefined?offline.load(ChronicleOG.catalogue):offline.save(ChronicleOG.catalogue(value));
 const png=image=>typeof image==='string'&&/^data:image\/png;base64,iVBORw0KGgo/.test(image);
 async function localImage(image,signal){
  // The APK ships these exact images; copy their bytes into the new snapshot
  // instead of spending mobile data downloading unchanged cards again.
  if(!/^chronicle-cards\/[A-Za-z0-9_-]+\.png$/.test(image))return null;
  const r=await fetch(image,{signal,credentials:'omit'});if(!r.ok)return null;
  const bytes=new Uint8Array(await r.arrayBuffer());let binary='';
  for(let at=0;at<bytes.length;at+=16384)binary+=String.fromCharCode(...bytes.subarray(at,at+16384));
  const data='data:image/png;base64,'+btoa(binary);return png(data)?data:null;
 }
 async function download(current,signal){
  if(window.PublishedCards?.enabled){try{const published=await PublishedCards.download('chronicle',current,say,signal);return published?validate(published):null;}catch(e){assertActive(signal);say('Checking the original Chronicle source…');}}
  let next;
  try{const saved=await stored('snapshots','download');if(saved&&saved.revision!==current.revision&&(Date.parse(saved.checkedAt||saved.snapshotDate)||0)>(Date.parse(current.checkedAt||current.snapshotDate)||0))next=validate(saved);}catch(e){}
  if(next)say('Resuming saved Chronicle card downloads…');else next=await manifest(signal);
  if(next.revision===current.revision||(Date.parse(next.checkedAt||next.snapshotDate)||0)<(Date.parse(current.checkedAt||current.snapshotDate)||0))return null;
  // Persist the manifest before any card downloads. Each original PNG is
  // journaled separately, so closing Android never discards completed work.
  try{await stored('snapshots','download',next);}catch(e){}
  const previous=new Map(cards(current).filter(c=>c.imageSha).map(c=>[c.imageSha,c.image]));
  const pending=new Map();
  for(const card of cards(next)){
   if(!/^drive:[A-Za-z0-9_-]+$/.test(card.image)||card.image!=='drive:'+card.driveId||!new RegExp('^'+card.driveId+':[a-f0-9]{64}$').test(card.imageSha))throw invalid('Unexpected image source.');
   const image=previous.get(card.imageSha);
   if(png(image))card.image=image;
   else{if(!pending.has(card.imageSha))pending.set(card.imageSha,[]);pending.get(card.imageSha).push(card);}
  }
  let done=0,index=0,failed=false;const jobs=[...pending];
  const results=await Promise.allSettled(Array.from({length:Math.min(2,jobs.length)},async()=>{
   while(index<jobs.length&&!failed){
    try{
     assertActive(signal);const [sha,targets]=jobs[index++],id=targets[0].driveId,revision=sha.slice(id.length+1);
     let image;try{image=await offline.image(sha);}catch(e){}
     if(!png(image)){try{image=await localImage(previous.get(sha),signal);}catch(e){assertActive(signal);}}
     if(!png(image)){
      const asset=await request({action:'asset',format:'png',id,revision},signal);
      if(asset.id!==id||asset.revision!==revision||!png(asset.image))throw invalid('A card download did not match its catalogue. Keeping the previous snapshot.');
      image=asset.image;
     }
     assertActive(signal);
     try{await offline.image(sha,image);}catch(e){}
     for(const c of targets)c.image=image;
     say(`Saving Chronicle cards for offline use: ${++done}/${jobs.length}`);
    }catch(e){failed=true;throw e;}
   }
  }));
  // Wait for every worker to settle before releasing the update lock. A
  // failed worker must not overlap a later check or mutate its progress.
  const error=results.find(r=>r.status==='rejected');if(error)throw error.reason;
  assertActive(signal);return validate(next);
 }
 async function finishDownload(){await stored('snapshots','download',null);try{await offline.prune();}catch(e){}}
 function install(next){window.CHRONICLE_DATA=validate(next);window.dispatchEvent(new Event('chronicle-updated'));}
 function schedule(delay){
  clearTimeout(timer);if(!started||!endpoint||!appActive||document.hidden)return;
  const ms=delay??(retrySoon?RETRY_INTERVAL_MS:Math.max(1000,CHECK_INTERVAL_MS-(Date.now()-last)));
  timer=setTimeout(()=>{timer=null;if(appActive&&!document.hidden)check(true);},ms);
 }
 async function check(force=false){
  if(!endpoint||busy||(!force&&Date.now()-last<CHECK_INTERVAL_MS))return;
  clearTimeout(timer);busy=true;active=new AbortController();last=Date.now();retrySoon=false;say('Checking Chronicle Drive updates…');
  try{
   const next=await download(window.CHRONICLE_DATA,active.signal);assertActive(active.signal);
   if(next){
    let saved=true;try{await cache(next);await finishDownload();}catch(e){saved=false;}
    install(next);say(saved?'Chronicle updated. Every card is saved for offline use.':'Updated for this session; offline storage is unavailable.');
   }else say('Chronicle up to date · '+new Date().toLocaleTimeString());
  }catch(e){
   retrySoon=e.retryable!==false;
   say(e.paused?e.message:'Chronicle update paused. Your saved cards are still available. '+e.message+(retrySoon?' Retrying automatically in 1 minute.':''));
  }finally{
   active=null;busy=false;
   if(resumeRequested){resumeRequested=false;schedule(0);}else schedule();
  }
 }
 function opened(){
  appActive=true;
  if(busy){if(active?.signal.aborted)resumeRequested=true;return;}
  if(Date.now()-lastOpen<1000){schedule();return;}lastOpen=Date.now();return check(true);
 }
 function closed(){appActive=false;clearTimeout(timer);active?.abort();}
 async function start(){
  if(started)return;started=true;
  try{
   const saved=await cache();
   if(saved){
    const og=validate(saved);
    if(Date.parse(og.checkedAt||og.snapshotDate)>=Date.parse(window.CHRONICLE_DATA.checkedAt||window.CHRONICLE_DATA.snapshotDate))install(og);
    // Rewrite old caches and pending downloads without RE references, then
    // remove their unused images. Loadouts and collection data are separate.
    await cache(og);
   }
   const pending=await stored('snapshots','download');if(pending)await stored('snapshots','download',validate(pending));
   await offline.prune();
  }catch(e){}
  window.addEventListener('online',()=>{if(appActive&&!document.hidden)check(true);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)closed();else opened();});
  window.addEventListener('pageshow',e=>{if(e.persisted)opened();});
  window.addEventListener('plakoro-app-open',opened);window.addEventListener('plakoro-app-close',closed);
  document.getElementById('check-updates')?.addEventListener('click',()=>check(true));if(endpoint)await opened();
 }
 return {get status(){return status;},configured:!!endpoint,validate,cards,download,cache,check,start};
})();
