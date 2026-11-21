'use strict';
window.EnecoroCollection=(()=>{
 const key='plakoro-collection-v1',slots=['a','b','s1','s2','d1','d2'];
 const blank=()=>({a:'',b:'',s1:'',s2:'',d1:'',d2:''});
 const face=s=>[...s].sort().join('');
 const catalogue={a:new Set(),b:new Set(),s:new Set(),d:new Set()};
 for(const set of Object.values(window.ENECORO_DATA||{})){for(const c of set.a||[])catalogue.a.add(c);for(const c of set.b||[])catalogue.b.add(c);for(const c of Object.keys(set.single))catalogue.s.add(c);for(const c of Object.keys(set.double))catalogue.d.add(face(c));}
 for(const kind in catalogue)catalogue[kind]=[...catalogue[kind]].sort();
 let state={version:2,products:{},adjustments:{},owned:{},migrated:false,onlyOwned:true,dice:[blank(),blank(),blank()]},storage=true;
 const kind=slot=>slot[0],id=(slot,value)=>kind(slot)+':'+value;
 function productParts(pid){const set=window.ENECORO_DATA[pid];if(!set)throw Error('Contents are not supplied for this product.');const parts={};for(const k of ['a','b'])for(const v of set[k]||[])parts[k+':'+v]=(parts[k+':'+v]||0)+1;for(const [k,src] of [['s','single'],['d','double']])for(const [v,n]of Object.entries(set[src])){const item=k+':'+face(v);parts[item]=(parts[item]||0)+n;}return parts;}
 function baseCounts(products=state.products){const totals={};for(const [pid,qty]of Object.entries(products))for(const [k,n]of Object.entries(productParts(pid)))totals[k]=(totals[k]||0)+n*qty;return totals;}
 function recalculate(){const base=baseCounts();state.owned={};for(const k of new Set([...Object.keys(base),...Object.keys(state.adjustments)])){state.adjustments[k]=Math.max(-(base[k]||0),state.adjustments[k]||0);state.owned[k]=Math.max(0,(base[k]||0)+(state.adjustments[k]||0));}}
 try{const saved=JSON.parse(localStorage.getItem(key));if(saved){state.onlyOwned=saved.onlyOwned!==false;if(saved.version===2){for(const [pid,n]of Object.entries(saved.products||{}))if(window.ENECORO_DATA[pid]&&Number.isInteger(n)&&n>=0&&n<=99)state.products[pid]=n;for(const [k,n]of Object.entries(saved.adjustments||{}))if(catalogue[k.split(':')[0]]?.includes(k.split(':')[1])&&Number.isInteger(n)&&n>=-100000&&n<=999)state.adjustments[k]=n;state.migrated=!!saved.migrated;}else{for(const [k,v]of Object.entries(saved.owned||{}))if(catalogue[k.split(':')[0]]?.includes(k.split(':')[1])&&Number.isInteger(v)&&v>=0&&v<=999)state.adjustments[k]=v;state.migrated=Object.values(state.adjustments).some(n=>n>0);}recalculate();if(Array.isArray(saved.dice)&&saved.dice.length)state.dice=saved.dice.slice(0,24).map(d=>Object.fromEntries(slots.map(s=>[s,catalogue[kind(s)].includes(d[s])?d[s]:''])));}}catch(e){storage=false;}
 function save(){try{localStorage.setItem(key,JSON.stringify(state));storage=true;}catch(e){storage=false;}}
 function used(excludeDie=-1,excludeSlot=''){const counts={};state.dice.forEach((d,i)=>slots.forEach(s=>{if(i===excludeDie&&s===excludeSlot)return;if(d[s])counts[id(s,d[s])]=(counts[id(s,d[s])]||0)+1;}));return counts;}
 function available(d,s,v){return (state.owned[id(s,v)]||0)-(used(d,s)[id(s,v)]||0);}
 function choose(d,s,v){if(!state.dice[d]||!slots.includes(s)||v&&!catalogue[kind(s)].includes(v))throw Error('Choose a valid part.');if(v&&state.onlyOwned&&available(d,s,v)<1)throw Error('All owned copies of this part are already assigned.');state.dice[d][s]=v;save();}
 function setOwned(k,n){if(!catalogue[k.split(':')[0]]?.includes(k.split(':')[1])||!Number.isInteger(n)||n<0||n>999)throw Error('Enter a whole number from 0 to 999.');state.adjustments[k]=n-(baseCounts()[k]||0);recalculate();save();}
 function setProduct(pid,n){if(!window.ENECORO_DATA[pid]||!Number.isInteger(n)||n<0||n>99)throw Error('Enter a product quantity from 0 to 99.');const proposed={...state.products,[pid]:n},base=baseCounts(proposed);if(Object.entries(base).some(([k,v])=>v+(state.adjustments[k]||0)>999))throw Error('Maximum tracked quantity is 999 per part.');state.products=proposed;recalculate();save();}
 function addSet(pid){setProduct(pid,(state.products[pid]||0)+1);}
 function report(){const counts=used();return {complete:state.dice.filter(d=>slots.every(s=>d[s])).length,total:state.dice.length,missing:Object.entries(counts).filter(([k,n])=>n>(state.owned[k]||0)).map(([k,n])=>({key:k,count:n-(state.owned[k]||0)}))};}
 return {state,catalogue,slots,kind,id,available,choose,setOwned,setProduct,baseCounts,productParts,addSet,report,used,storage:()=>storage,toggle:v=>{state.onlyOwned=!!v;save();},addDie:()=>{if(state.dice.length>=24)throw Error('Maximum 24 dice.');state.dice.push(blank());save();},removeDie:i=>{if(state.dice.length<=1)throw Error('Keep at least one die.');state.dice.splice(i,1);save();}};
})();
