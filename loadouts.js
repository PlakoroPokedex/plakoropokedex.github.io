'use strict';
// Shared by Android, the downloadable HTML and the hosted app.
window.Loadouts=(()=>{
 const KEY='plakoro-loadouts-v2',blank=(parent=null)=>({pokemon:null,moves:[],hp:null,edition:'RE',parent});
 const blankDie=()=>({a:'',b:'',s1:'',s2:'',d1:'',d2:''});
 const bounded=(n,max)=>Math.min(max,Math.max(0,Math.floor(Number(n)||0)));
 function normalizeStages(x={}){const stages=(Array.isArray(x.stages)?x.stages:[]).slice(0,256).map((t,j)=>({pokemon:typeof t?.pokemon==='string'?t.pokemon:null,moves:[...new Set((Array.isArray(t?.moves)?t.moves:[]).filter(m=>typeof m==='string'))].slice(0,4),hp:Number.isFinite(t?.hp)?Math.max(0,t.hp):null,edition:t?.edition==='OG'?'OG':'RE',parent:j===0?null:Number.isInteger(t?.parent)&&t.parent>=0&&t.parent<j?t.parent:0}));return {stages:stages.length?stages:[blank()],stage:bounded(x.stage,Math.max(0,stages.length-1))};}
 function normalizeLeague(x={}){const mode=x.mode==='doubles'?'doubles':'singles',limit=mode==='doubles'?4:3,indices=a=>[...new Set((Array.isArray(a)?a:[]).filter(i=>Number.isInteger(i)&&i>=0&&i<6))];const selected=indices(x.selected).slice(0,limit);return {mode,member:bounded(x.member,5),phase:['party','choose','moves','battle'].includes(x.phase)?x.phase:'party',onlyOwned:x.onlyOwned!==false,selected,active:indices(x.active).filter(i=>selected.includes(i)).slice(0,mode==='doubles'?2:1),party:Array.from({length:6},(_,i)=>{const p=x.party?.[i]||{};return {...normalizeStages(p),dice:Array.from({length:3},(_,j)=>Object.fromEntries(Object.keys(blankDie()).map(k=>[k,typeof p.dice?.[j]?.[k]==='string'?p.dice[j][k]:''])))};})};}
 let state={version:2,active:0,chronicle:false,slots:Array.from({length:30},()=>({...normalizeStages(),format:'single',league:null}))},storage=true;
 try{const s=JSON.parse(localStorage.getItem(KEY));if(s?.version===2&&Array.isArray(s.slots)){state.active=bounded(s.active,29);state.chronicle=!!s.chronicle;state.slots=state.slots.map((v,i)=>{const x=s.slots[i];return x?{...normalizeStages(x),format:x.format==='league'?'league':'single',league:x.league?normalizeLeague(x.league):x.format==='league'?normalizeLeague():null}:v;});}else{const old=JSON.parse(localStorage.getItem('plakoro-loadout-v1'));if(old?.pokemon)state.slots[0].stages[0]={...blank(),pokemon:old.pokemon,moves:[...new Set(old.moves||[])].slice(0,4)};}}catch(e){storage=false;}
 const savedSlot=()=>state.slots[state.active],isLeague=()=>savedSlot().format==='league';
 const slot=()=>isLeague()?savedSlot().league.party[savedSlot().league.member]:savedSlot(),current=()=>slot().stages[slot().stage];
 function save(){try{localStorage.setItem(KEY,JSON.stringify(state));storage=true;}catch(e){storage=false;}return storage;}
 function select(i){if(!Number.isInteger(i)||i<0||i>29)throw Error('Choose a loadout slot.');state.active=i;save();return current();}
 function setFormat(format){if(!['single','league'].includes(format))throw Error('Choose a format.');const s=savedSlot();if(format==='league'&&!s.league){s.league=normalizeLeague({party:[s],onlyOwned:window.EnecoroCollection?.state.onlyOwned});}s.format=format;save();return current();}
 // HP follows the currently played Pokémon across evolution/devolution. Older
 // saves may have no tracked HP yet, so carry the outgoing card's displayed HP.
 function stage(i,baseHp){if(!Number.isInteger(i)||i<0||i>=slot().stages.length)throw Error('Choose a loadout stage.');const value=Number.isFinite(current().hp)?current().hp:Number.isFinite(baseHp)?Math.max(0,baseHp):null;slot().stage=i;current().hp=value;save();return current();}
 function replace(value){const parent=current().parent,hp=slot().stage===0?value.hp:current().hp;slot().stages[slot().stage]={...blank(parent),...value,hp,parent};if(slot().stage===0)slot().stages=slot().stages.slice(0,1);save();return current();}
 function hp(delta,max){const x=current();x.hp=Math.max(0,Math.min(9999,(Number.isFinite(x.hp)?x.hp:Number(max)||0)+delta));save();return x.hp;}
 function species(p){return (p.species||p.name||'').toLowerCase().trim().replace(/^(?:(?:dx|strong|legendary|surfing)\s+)+/,'').trim();}
 function surfing(p){return p.form==='surfing'||/^(?:(?:dx|strong|legendary)\s+)*surfing\s+pikachu$/i.test(String(p.name||'').trim());}
 function movesFor(p,all,edition='RE',chronicle=false){const family=species(p),seen=new Set(),out=[];for(const owner of all){if(species(owner)!==family)continue;for(const move of owner.ownMoves||owner.moves||[]){if(move.year===1997&&!chronicle)continue;if(move.year===1997&&move.edition&&move.edition!==edition)continue;
 if(move.editions&&move.year===1997&&!move.editions[edition])continue;
 const m=move.editions?{...move,...move.editions[edition]}:move;
 // A card's printed owner takes priority over the folder or Pokémon that carries it.
 const declaredOwner=String(m.owner||'').trim();
 const exclusive=m.surfingOnly===true||(declaredOwner?surfing({name:declaredOwner,form:m.form}):m.surfingOnly!==false&&surfing(owner));if(exclusive&&!surfing(p))continue;
 if(!seen.has(m.id)){seen.add(m.id);out.push(m);}}}return out;}
 const isEvolve=m=>m?.action==='evolve'||/^evolve(?:\s|$)/i.test(m?.name||'');
 const isDevolve=m=>m?.action==='devolve'||/^devolve(?:\s|$)/i.test(m?.name||'');
 function selected(index,all,s=slot()){const t=s.stages[index],p=all.find(p=>p.id===t?.pokemon);return p?movesFor(p,all,t.edition,true).filter(m=>t.moves.includes(m.id)):[];}
 function targets(index,all,s=slot()){const t=s.stages[index],p=all.find(p=>p.id===t?.pokemon);return p?[...new Set([...(p.evolvesTo||[]),...selected(index,all,s).filter(isEvolve).flatMap(m=>m.evolutionTargets||[])])]:[];}
 function requirements(all,s=slot()){
  const indices=[],children={};let changed=false,devo=false;
  function visit(index){
   indices.push(index);if(!selected(index,all,s).some(isEvolve))return;
   const existing=s.stages.map((t,i)=>({t,i})).filter(x=>x.i>index&&x.t.parent===index).map(x=>x.i);
   const branching=existing.some(i=>selected(i,all,s).some(isDevolve));devo||=branching;
   const count=branching?3:1;
   while(existing.length<count){existing.push(s.stages.length);s.stages.push(blank(index));changed=true;}
   children[index]=existing.slice(0,count);for(const child of children[index])visit(child);
  }
  visit(0);if(changed)save();
  return {evo:indices.length>1,devo,count:indices.length,indices,children};
 }
 return {state,blank,blankDie,normalizeLeague,savedSlot,isLeague,setFormat,slot,current,save,select,stage,replace,hp,species,surfing,movesFor,isEvolve,isDevolve,selected,targets,requirements,storage:()=>storage};
})();
