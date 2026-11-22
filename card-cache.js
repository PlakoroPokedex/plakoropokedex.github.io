'use strict';
// Keep images out of the catalogue record. Some browsers limit a single
// IndexedDB value even when the device still has ample free storage.
window.CardCache=(()=>{
 const CHUNK=512*1024,PREFIX='offline-image:';
 const imageData=value=>typeof value==='string'&&value.startsWith('data:image/');
 function create(name,version){
  function open(){return new Promise((resolve,reject)=>{
   if(!window.indexedDB)return reject(Error('Offline storage unavailable'));
   const request=indexedDB.open(name,version);
   request.onupgradeneeded=()=>{for(const store of ['snapshots','images','chunks'])if(!request.result.objectStoreNames.contains(store))request.result.createObjectStore(store);};
   request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
   request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Close another Plakoro tab to save the update'));
  });}
  async function record(store,key,value){const db=await open();try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(store,value===undefined?'readonly':'readwrite'),table=tx.objectStore(store);
   const request=value===undefined?table.get(key):value===null?table.delete(key):table.put(value,key);let result;
   request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(value===undefined?result:value);
   tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Offline storage could not save this card'));
  });}finally{db.close();}}
  async function image(key,value){
   const saved=await record('images',key);
   if(value===undefined){
    if(typeof saved==='string')return saved; // Existing version-2 download journal.
    if(!saved)return undefined;
    if(saved.format!==1||saved.count!==Math.ceil(saved.length/CHUNK))throw Error('Incomplete saved image');
    const parts=[];for(let i=0;i<saved.count;i++){const part=await record('chunks',[key,i]);if(typeof part!=='string'||part.length!==Math.min(CHUNK,saved.length-i*CHUNK))throw Error('Incomplete saved image');parts.push(part);}
    return parts.join('');
   }
   if(!imageData(value))throw Error('Invalid offline image');
   if(saved?.format===1&&saved.length===value.length)return value;
   // A descriptor is committed only after every bounded chunk succeeds.
   for(let i=0;i<value.length;i+=CHUNK)await record('chunks',[key,i/CHUNK],value.slice(i,i+CHUNK));
   await record('images',key,{format:1,length:value.length,count:Math.ceil(value.length/CHUNK)});return value;
  }
  function map(value,visit,path='root'){
   if(Array.isArray(value))return value.map((v,i)=>map(v,visit,path+'/'+i));
   if(!value||typeof value!=='object')return value;
   const result={};for(const [k,v]of Object.entries(value))result[k]=k==='image'?visit(v,value,path):map(v,visit,path+'/'+k);return result;
  }
  async function save(value){
   const images=new Map(),metadata=map(value,(url,card,path)=>{
    if(!imageData(url))return url;
    const key=card.imageSha||value.revision+':'+path;images.set(key,url);return PREFIX+key;
   });
   for(const [key,url]of images)await image(key,url);
   // The previous complete catalogue stays installed if any image fails.
   await record('snapshots','current',metadata);return value;
  }
  async function load(transform=value=>value){
   const saved=await record('snapshots','current');if(!saved)return saved;
   const value=transform(saved);
   const images=new Map();map(value,url=>{if(typeof url==='string'&&url.startsWith(PREFIX))images.set(url.slice(PREFIX.length),null);return url;});
   for(const key of images.keys()){const url=await image(key);if(!imageData(url))throw Error('A saved card is missing');images.set(key,url);}
   // Legacy snapshots with inline images also remain readable, without erasure.
   return map(value,url=>typeof url==='string'&&url.startsWith(PREFIX)?images.get(url.slice(PREFIX.length)):url);
  }
  async function prune(){
   const keep=new Set();
   for(const key of ['current','download']){const value=await record('snapshots',key);map(value,(url,card)=>{if(typeof url==='string'&&url.startsWith(PREFIX))keep.add(url.slice(PREFIX.length));if(card.imageSha)keep.add(card.imageSha);return url;});}
   const db=await open();try{await new Promise((resolve,reject)=>{
    const tx=db.transaction(['images','chunks'],'readwrite');
    for(const name of ['images','chunks']){const r=tx.objectStore(name).openCursor();r.onsuccess=()=>{const c=r.result;if(!c)return;const key=name==='chunks'?c.key[0]:c.key;if(!keep.has(key))c.delete();c.continue();};}
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
   });}finally{db.close();}
  }
  return {record,image,save,load,prune};
 }
 return {create};
})();
