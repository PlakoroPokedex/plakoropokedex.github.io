import {ROOT_ID,SOURCE,listCatalogue,mapLimit,sha256} from './public-drive.mjs';
const TYPES=['Grass','Fire','Water','Electric','Psychic','Fighting','Darkness','Metal','Dragon','Flying','Normal'];
const ENERGY={grass:'G',fire:'R',water:'W',electric:'L',psychic:'P',fighting:'F',dark:'D',steel:'M',dragon:'N',flying:'Y',normal:'C'};
const slug=s=>String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const species=s=>String(s).replace(/^DX\s+/i,'').replace(/^(Strong|Legendary|Surfing)\s+/i,'').trim();
const decoder=new TextDecoder();
const pngSignature=[137,80,78,71,13,10,26,10];
// Preserve typed editor fields for battle clients. Numeric hidden defaults
// must not become printed damage, and facing flags must stay unambiguous.
export function battleMetadata(d){
 const fields={};
 for(const [key,value] of Object.entries(d))if(/^(?:mon_name|hp|type|weakness|weakness_visible|move_name|damage|(?:grass|fire|water|electric|psychic|fighting|dark|steel|dragon|flying|normal)_energy|move_text_[0-3]|move_[1-3]_facing_[0-5])$/.test(key)&&['string','number','boolean'].includes(typeof value))fields[key]=value;
 return {schema:1,fields};
}

export async function scanCatalogue(reader,saveAsset,progress=()=>{},partialInventory=null){
 const {files,folders}=partialInventory||await listCatalogue(reader);progress({phase:'listed',folders:folders.length,files:files.length});
 const lookup=new Map(files.map(f=>[f.path.join('/')+'/'+f.name.toLowerCase(),f]));
 // Artwork and editor files may be in different Pokémon subfolders of the
 // same product/edition. Never cross a year, product or OG/RE boundary.
 const editionOf=f=>f.path.find(x=>/^(OGs?|REs?)$/i.test(x))?.slice(0,2).toUpperCase();
 const scope=f=>JSON.stringify([f.path[0],f.path[1],editionOf(f)]);
 const editors=new Map();
 for(const f of files.filter(f=>/\.koro$/i.test(f.name))){const key=scope(f)+'/'+f.name.toLowerCase();if(!editors.has(key))editors.set(key,[]);editors.get(key).push(f);}
 const images=files.filter(f=>/\.png$/i.test(f.name)),assets={},mons=new Map(),moves=[],warnings=[],fingerprints=[],customRules={};
 let completed=0;
 async function art(file){
  const bytes=await reader.read(file);if(!pngSignature.every((n,i)=>bytes[i]===n))throw Object.assign(Error('Drive did not return the original PNG: '+file.name),{retryable:false});
  const revision=await sha256(bytes),key='cards/'+file.id+'/'+revision+'.png';await saveAsset(key,bytes);
  assets[file.id]={revision,key};fingerprints.push(file.id+':'+revision);
  return {driveId:file.id,image:'drive:'+file.id,imageSha:file.id+':'+revision};
 }
 // The publishing runner has room for four bounded original-file downloads.
 await mapLimit(images,4,async f=>{
  try{
  if(f.path[0]?.toLowerCase()==='custom'){
   const editor=lookup.get(f.path.join('/')+'/'+f.name.replace(/\.png$/i,'.koro').toLowerCase());
   if(!editor){warnings.push('Missing custom card .koro: '+f.name);return;}
   const raw=await reader.read(editor);fingerprints.push(editor.id+':'+await sha256(raw));
   let d;try{d=JSON.parse(decoder.decode(raw));}catch{warnings.push('Unreadable .koro: '+editor.name);return;}
   // SWITCH belongs to the player, not to a Pokémon's four-card move pool.
   if(String(d.mon_name).trim().toUpperCase()!=='PLAYER'||String(d.move_name).trim().toUpperCase()!=='SWITCH')return;
   const standing=[1,2,3].filter(i=>d['move_'+i+'_facing_0']).map(i=>String(d['move_text_'+i]||'').trim()).filter(Boolean).join('\n');
   customRules.switch={id:f.name.replace(/\.png$/i,''),name:'SWITCH',owner:'PLAYER',effect:String(d.move_text_0||'').trim(),standing,...await art(f)};
   return;
  }
  const year=Number(f.path[0]);if(year!==1997&&year!==2026)return;
  const edition=f.path.find(x=>/^(OGs?|REs?)$/i.test(x))?.slice(0,2).toUpperCase();if(edition!=='OG')return;
  // Some products have subgroup numbers, e.g. OGW01-1-01. Keep the
  // entire code so each PNG finds its own editor file and unique move ID.
  const code=/^((?:OG|RE)[CW]\d+(?:-\d+)+)(?=\.|[ _]|$)/i.exec(f.name)?.[1].toUpperCase();if(!code){warnings.push('Unrecognized card filename: '+f.name);return;}
  const name=code.toLowerCase()+'.koro',siblings=editors.get(scope(f)+'/'+name)||[];
  const editor=lookup.get(f.path.join('/')+'/'+name)||(siblings.length===1?siblings[0]:null);
  if(!editor){warnings.push((siblings.length>1?'Ambiguous matching .koro: ':'Missing matching .koro: ')+f.name);return;}
  let d;const raw=await reader.read(editor);fingerprints.push(editor.id+':'+await sha256(raw));
  try{d=JSON.parse(decoder.decode(raw));}catch{warnings.push('Unreadable .koro: '+editor.name);return;}
  if(!d.mon_name){warnings.push('Missing Pokémon owner: '+f.name);return;}
  const owner=String(d.mon_name).trim(),family=species(owner),base={code,year,edition,set:f.path[1]||String(year),type:TYPES[d.type]||'',battle:battleMetadata(d),sourceUrl:'https://drive.google.com/file/d/'+editor.id+'/view',...await art(f)};
  if(code[2]==='C'){
   const id=year+'-'+slug(owner)+'-'+code.slice(3).split('-')[0],hp=Number(String(d.hp||'').replace(/\s/g,'0'));
   if(!Number.isFinite(hp)||hp<=0){warnings.push('Missing HP: '+f.name);return;}
   const variant={...base,name:owner,hp,weakness:d.weakness_visible===false?'None':TYPES[d.weakness]||''};
   let p=mons.get(id);if(!p){p={...variant,id,species:family,form:/^(?:DX\s+)?Surfing Pikachu$/i.test(owner)?'surfing':'',editions:{},moves:[]};mons.set(id,p);}
   p.editions[edition]=variant;Object.assign(p,variant);
  }else{
   const name=String(d.move_name||'').trim();if(!name){warnings.push('Missing move name: '+f.name);return;}
   const orientations={};for(let i=1;i<4;i++){const text=String(d['move_text_'+i]||'').trim();if(!text)continue;const labels=['Standing','Handstand','Back','Down','Sideways (left)','Sideways (right)'].filter((_,j)=>d['move_'+i+'_facing_'+j]);orientations[labels.join(' / ')||'Additional effect '+i]=text;}
   const effect=String(d.move_text_0||'').trim(),m={...base,id:code,name,owner,species:family,variantKey:code.slice(2),energy:Object.entries(ENERGY).map(([key,symbol])=>('{'+symbol+'}').repeat(Math.max(0,Math.min(99,Number(d[key+'_energy'])||0)))).join(''),damage:String(d.damage||'').trim(),effect,orientations,surfingOnly:/^(?:DX\s+)?Surfing Pikachu$/i.test(owner)};
   if(/^evolve$/i.test(name)){m.action='evolve';const match=/\bevolves? (?:it |this pok[eé]mon )?into (.+?)(?:\.|$)/i.exec(effect);if(match)m.evolutionTargets=match[1].split(/,|\bor\b|\band\b/).map(x=>species(x.trim()).toLowerCase()).filter(Boolean);}
   if(/^devolve$/i.test(name)){m.action='devolve';const match=/\bdevolves? (?:this pok[eé]mon )?into (.+?)(?:\.|$)/i.exec(effect);if(match)m.devolutionTargets=[species(match[1]).toLowerCase()];}
   moves.push(m);
  }
  progress({phase:'cards',completed:++completed});
  }catch(error){
   if(error.retryable===false){warnings.push('Pending card '+f.name+': '+error.message);return;}
   throw error;
  }
 });
 moves.sort((a,b)=>a.id.localeCompare(b.id));
 const pokemon=[...mons.values()].sort((a,b)=>a.id.localeCompare(b.id));for(const p of pokemon)p.moves=moves.filter(m=>m.owner.toLowerCase()===p.name.toLowerCase());
 const standalone=moves.filter(m=>!pokemon.some(p=>m.owner.toLowerCase()===p.name.toLowerCase()));
 const rules={formats:[],...customRules};
 await mapLimit(files.filter(f=>f.path[0].toLowerCase()==='rules'),1,async f=>{
  if(/\.png$/i.test(f.name)){if(/1p.*playseat/i.test(f.name))rules.basic=await art(f);else if(/how.?to.?play/i.test(f.name))rules.howTo=await art(f);return;}
  if(f.kind!=='document'&&!/\.(md|txt)$/i.test(f.name))return;
  const raw=await reader.read(f),text=decoder.decode(raw);if(/^\s*<!doctype html/i.test(text))throw Error('Rules document is not publicly downloadable.');fingerprints.push(f.id+':'+await sha256(raw));
  if(/event.*floor/i.test(f.name))rules.event={text};else if(f.path.some(x=>/^formats?$/i.test(x))||/\bformat\b/i.test(f.name))rules.formats.push({title:f.name.replace(/\.(md|txt)$/i,''),text});
 });
 rules.formats.sort((a,b)=>a.title.localeCompare(b.title));
 if(!partialInventory&&!pokemon.length&&!moves.length&&!warnings.length)throw Error('No complete card pairs found. Keeping saved cards.');
 // Names and folder membership also contribute, so additions, moves and removals are detected.
 const revision=await sha256([ROOT_ID,'battle-metadata-v1',...fingerprints.sort(),...files.map(f=>f.id+':'+f.path.join('/')+'/'+f.name).sort()].join('\n'));
 return {version:1,revision,snapshotDate:new Date().toISOString().slice(0,10),checkedAt:new Date().toISOString(),source:SOURCE,status:'live',pokemon,moves:standalone,rules,assets,warnings,complete:warnings.length===0,sourceNote:'Updated from the publicly shared Chronicle Drive folder.',discovery:{folders:folders.length,files:files.length},...(partialInventory?{fingerprints}: {})};
}

export async function combineParts(parts,inventory){
 const mons=new Map(),allMoves=new Map(),assets={},warnings=[],fingerprints=[],rules={formats:[]};
 for(const part of parts){
  Object.assign(assets,part.assets);warnings.push(...part.warnings);fingerprints.push(...part.fingerprints);
  for(const p of part.pokemon){let merged=mons.get(p.id);if(!merged){merged={...p,editions:{}};mons.set(p.id,merged);}Object.assign(merged.editions,p.editions);}
  for(const m of [...part.moves,...part.pokemon.flatMap(p=>p.moves)])allMoves.set(m.id,m);
  Object.assign(rules,...['basic','howTo','event','switch'].filter(k=>part.rules[k]).map(k=>({[k]:part.rules[k]})));rules.formats.push(...part.rules.formats);
 }
 const moves=[...allMoves.values()].sort((a,b)=>a.id.localeCompare(b.id)),pokemon=[...mons.values()].sort((a,b)=>a.id.localeCompare(b.id));
 for(const p of pokemon){Object.assign(p,p.editions.OG);p.moves=moves.filter(m=>m.owner.toLowerCase()===p.name.toLowerCase());}
 if(!pokemon.length&&!moves.length&&!warnings.length)throw Error('No complete card pairs found. Keeping saved cards.');
 rules.formats.sort((a,b)=>a.title.localeCompare(b.title));
 const revision=await sha256([ROOT_ID,'battle-metadata-v1',...fingerprints.sort(),...inventory.files.map(f=>f.id+':'+f.path.join('/')+'/'+f.name).sort()].join('\n'));
 return {version:1,revision,snapshotDate:new Date().toISOString().slice(0,10),checkedAt:new Date().toISOString(),source:SOURCE,status:'live',pokemon,moves:moves.filter(m=>!pokemon.some(p=>m.owner.toLowerCase()===p.name.toLowerCase())),rules,assets,warnings,complete:warnings.length===0,sourceNote:'Updated from the publicly shared Chronicle Drive folder.',discovery:{folders:inventory.folders.length,files:inventory.files.length}};
}
export function publicManifest(manifest){const result={...manifest};delete result.assets;delete result.fingerprints;return result;}

// A catalogue can contain only fully validated cards even while a few source
// uploads are unfinished. Overlay ready cards on the last published snapshot
// in that case; defer removals until a warning-free scan can confirm them.
export async function availableCatalogue(next,previous){
 if(next.complete)return next;
 if(!Array.isArray(next.warnings)||!next.warnings.length)return next;
 const old=previous?.source===SOURCE?previous:null,mons=new Map(),allMoves=new Map();
 for(const catalogue of [old,next].filter(Boolean)){
  for(const p of catalogue.pokemon){
   const prior=mons.get(p.id);
   mons.set(p.id,{...prior,...p,editions:{...prior?.editions,...p.editions},moves:[]});
  }
  for(const m of [...catalogue.moves,...catalogue.pokemon.flatMap(p=>p.moves)])allMoves.set(m.id,m);
 }
 const pokemon=[...mons.values()].sort((a,b)=>a.id.localeCompare(b.id)),moves=[...allMoves.values()].sort((a,b)=>a.id.localeCompare(b.id));
 if(!pokemon.length&&!moves.length)return next;
 for(const p of pokemon){Object.assign(p,p.editions.OG);p.moves=moves.filter(m=>m.owner.toLowerCase()===p.name.toLowerCase());}
 const standalone=moves.filter(m=>!pokemon.some(p=>m.owner.toLowerCase()===p.name.toLowerCase()));
 const rules={...old?.rules,...next.rules};
 // Keep existing rules during an incomplete source scan as well.
 rules.formats=[...new Map([...(old?.rules?.formats||[]),...(next.rules?.formats||[])].map(f=>[f.title,f])).values()].sort((a,b)=>a.title.localeCompare(b.title));
 const references=[...pokemon.flatMap(p=>[p,...Object.values(p.editions),...p.moves]),...standalone,...[rules.basic,rules.howTo,rules.switch].filter(Boolean)],assets={};
 for(const card of references){
  const id=card.driveId,revision=card.imageSha?.slice(id?.length+1);
  const asset=next.assets[id]?.revision===revision?next.assets[id]:old?.assets?.[id]?.revision===revision?old.assets[id]:null;
  if(!asset)throw Error('A retained card has no verified original PNG.');
  assets[id]=asset;
 }
 const revision=await sha256(JSON.stringify({scan:next.revision,pokemon,moves:standalone,rules}));
 return {...next,revision,pokemon,moves:standalone,rules,assets,complete:true,sourceComplete:false,
  sourceNote:'Ready cards updated from Drive. '+next.warnings.length+' unfinished upload'+(next.warnings.length===1?' is':'s are')+' pending; existing cards are kept. '+next.warnings.slice(0,3).join('; ')};
}
