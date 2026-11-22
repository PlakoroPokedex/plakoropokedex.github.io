'use strict';
// One policy for bundled cards, Drive updates, offline caches and old loadouts.
window.ChronicleOG=(()=>{
 const aliases=new Map();
 const originalId=id=>typeof id==='string'?id.replace(/^RE(?=[CW]\d+-)/i,'OG'):id;
 const edition=c=>String(c?.edition||/^(OG|RE|JP)[CW]\d+-/i.exec(c?.code||c?.id||'')?.[1]||'').toUpperCase();
 function card(c,character=false){
  if(!c||typeof c!=='object')return null;
  const variant=c.editions?.OG;
  if(c.editions&&!variant||!variant&&edition(c)&&edition(c)!=='OG')return null;
  const out={...c,...variant};
  if(character)out.id=originalId(c.id);
  else out.id=originalId(out.id);
  if(variant){const {editions,...og}=variant;out.editions={OG:og};}
  if(variant||edition(c))out.edition='OG';
  return out;
 }
 const key=m=>[m.year||1997,String(m.owner||m.species||'').toLowerCase().trim(),m.variantKey||(m.code||m.id||'').replace(/^(OG|RE)(?=[CW]\d+-)/i,'')].join(':');
 function catalogue(data){
  if(!data||!Array.isArray(data.pokemon)||!Array.isArray(data.moves))return data;
  const originals=[],rawMoves=[...data.moves,...data.pokemon.flatMap(p=>p.ownMoves||p.moves||[])];
  const pokemon=data.pokemon.map(p=>{
   const og=card(p,true),moves=(p.ownMoves||p.moves||[]).map(m=>card(m)).filter(Boolean);
   if(!og){originals.push(...moves);return null;}
   if(p.id!==og.id)aliases.set(p.id,og.id);
   return {...og,moves,...(p.ownMoves?{ownMoves:moves}:{})};
  }).filter(Boolean);
  const moves=[...data.moves.map(m=>card(m)).filter(Boolean),...originals];
  const byVariant=new Map([...moves,...pokemon.flatMap(p=>p.moves)].map(m=>[key(m),m]));
  for(const m of rawMoves){const og=card(m),match=og||byVariant.get(key(m));if(match&&m.id!==match.id)aliases.set(m.id,match.id);}
  return {...data,pokemon,moves,cardPolicy:'og-only',sourceNote:'OG cards included for offline play. Checks on opening and every 30 minutes while open.'};
 }
 return {card,catalogue,originalId:id=>aliases.get(id)||originalId(id)};
})();
