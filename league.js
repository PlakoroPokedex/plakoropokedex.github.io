'use strict';
// League parties are stored inside the existing loadout slot. A member owns its
// evolution tree and optional dice plans; switching members never transfers HP.
window.League=(()=>{
 const state=()=>Loadouts.savedSlot().league;
 const member=i=>state().party[i];
 const limit=()=>state().mode==='doubles'?4:3;
 const diceTotal=()=>limit()*3;
 const activeLimit=()=>state().mode==='doubles'?2:1;
 const card=(i,all)=>all.find(p=>p.id===member(i).stages[member(i).stage].pokemon);
 const hp=(i,all)=>{const t=member(i).stages[member(i).stage];return Number.isFinite(t.hp)?t.hp:Number(card(i,all)?.hp)||0;};
 const completeDie=d=>EnecoroCollection.slots.every(s=>EnecoroCollection.catalogue[s[0]].includes(d[s]));
 function selectMember(i){if(!Number.isInteger(i)||i<0||i>=6)throw Error('Choose a party member.');state().member=i;Loadouts.save();return Loadouts.current();}
 function used(excludeMember=-1,excludeDie=-1,excludeFace=''){
  // Only the chosen match team uses inventory. Before team selection, each
  // member's optional plan can be edited independently with the same parts.
  let indices=state().selected.length?state().selected:[state().member];
  if(excludeMember>=0&&!indices.includes(excludeMember))indices=[excludeMember];
  const counts={};indices.forEach(i=>member(i).dice.forEach((d,j)=>EnecoroCollection.slots.forEach(s=>{
   if(i===excludeMember&&j===excludeDie&&s===excludeFace)return;
   if(d[s]){const k=EnecoroCollection.id(s,d[s]);counts[k]=(counts[k]||0)+1;}
  })));return counts;
 }
 function shortages(){return Object.entries(used()).filter(([k,n])=>n>(EnecoroCollection.state.owned[k]||0)).map(([key,n])=>({key,count:n-(EnecoroCollection.state.owned[key]||0)}));}
 function available(i,j,s,v){const key=EnecoroCollection.id(s,v);return (EnecoroCollection.state.owned[key]||0)-(used(i,j,s)[key]||0);}
 function choosePart(i,j,s,v){
  if(!member(i)?.dice[j]||!EnecoroCollection.slots.includes(s)||v&&!EnecoroCollection.catalogue[s[0]].includes(v))throw Error('Choose a valid die part.');
  if(v&&state().onlyOwned&&available(i,j,s,v)<1)throw Error('All owned copies of this part are already assigned in this party.');
  member(i).dice[j][s]=v;Loadouts.save();
 }
 function copyDice(i,dice){
  if(!Array.isArray(dice)||dice.length<3)throw Error('Build three dice first in Enecoro → Dice builder.');
  const old=member(i).dice;member(i).dice=dice.slice(0,3).map(d=>({...d}));
  if(!member(i).dice.every(completeDie)||state().onlyOwned&&shortages().length){member(i).dice=old;throw Error('The three dice must be complete and fit your collection when its limit is enabled.');}
  Loadouts.save();
 }
 function partyErrors(all){
  const issues=[];
  state().party.forEach((p,i)=>{
   if(!all.some(c=>c.id===p.stages[0].pokemon))issues.push('Party member '+(i+1)+' needs a Pokémon.');
  });
  return issues;
 }
 function moveErrors(all){
  return state().selected.flatMap(i=>{
   const p=member(i),req=Loadouts.requirements(all,p);
   return req.indices.flatMap(j=>{
    const t=p.stages[j],mon=all.find(c=>c.id===t.pokemon),valid=mon?Loadouts.movesFor(mon,all,t.edition,true):[];
    if(!mon||t.moves.length!==4||!t.moves.every(id=>valid.some(m=>m.id===id)))return ['Party member '+(i+1)+(j?' evolution':'')+' needs a Pokémon and four available moves.'];
    const targets=j?Loadouts.targets(t.parent,all,p):[];
    return targets.length&&!targets.some(v=>v===mon.id||String(v).toLowerCase()===Loadouts.species(mon))?['Party member '+(i+1)+' has an evolution that does not match its Evolve card.']:[];
   });
  });
 }
 function setMode(mode){if(state().phase==='battle')throw Error('Start a new match before changing the battle type.');state().mode=mode==='doubles'?'doubles':'singles';state().selected=state().selected.slice(0,limit());state().active=[];Loadouts.save();}
 function toggleMember(i){
  if(state().phase==='battle')throw Error('Start a new match to change your selected team.');
  if(!Number.isInteger(i)||i<0||i>=6)throw Error('Choose a party member.');
  const selected=state().selected,at=selected.indexOf(i);
  if(at>=0)selected.splice(at,1);else{if(selected.length>=limit())throw Error('Choose exactly '+limit()+' Pokémon. Remove one before adding another.');selected.push(i);}
  state().active=[];Loadouts.save();
 }
 function chooseTeam(all){const issues=partyErrors(all);if(issues.length)throw Error(issues[0]);state().phase='choose';Loadouts.save();}
 function lockTeam(){if(state().selected.length!==limit())throw Error('Choose exactly '+limit()+' Pokémon for this match.');state().phase='moves';Loadouts.save();}
 function start(all){
  const issues=[...partyErrors(all),...moveErrors(all)];if(state().selected.length!==limit())issues.unshift('Choose exactly '+limit()+' Pokémon for this match.');if(issues.length)throw Error(issues[0]);
  state().selected.forEach(i=>{const p=member(i);p.stage=0;p.stages.forEach(t=>t.hp=Number(all.find(c=>c.id===t.pokemon)?.hp)||0);});
  state().active=state().selected.slice(0,activeLimit());state().member=state().active[0];state().phase='battle';Loadouts.save();return Loadouts.current();
 }
 function reserves(all){return state().selected.filter(i=>!state().active.includes(i)&&hp(i,all)>0);}
 function switchActive(outgoing,incoming,all){
  if(state().phase!=='battle'||!state().active.includes(outgoing)||!reserves(all).includes(incoming))throw Error('Choose a living reserve from this match’s selected team.');
  state().active[state().active.indexOf(outgoing)]=incoming;state().member=incoming;Loadouts.save();return Loadouts.current();
 }
 function retire(i,all){if(!state().active.includes(i)||hp(i,all)>0||reserves(all).length)throw Error('Replace the KO’d Pokémon with an available reserve.');state().active=state().active.filter(n=>n!==i);Loadouts.save();}
 function newMatch(){state().selected=[];state().active=[];state().phase='party';Loadouts.save();}
 return {state,member,limit,diceTotal,activeLimit,card,hp,completeDie,selectMember,used,available,shortages,choosePart,copyDice,partyErrors,moveErrors,setMode,toggleMember,chooseTeam,lockTeam,start,reserves,switchActive,retire,newMatch};
})();

// Privacy is deliberately session-only. Reopening a saved League loadout shows
// the six-member party without exposing the secret team, moves or reserve HP.
let leaguePrivate=false;
function leaguePokemon(i,base=false){const m=League.member(i),t=m.stages[base?0:m.stage],p=byId(t.pokemon);return p?{...p,...(p.editions?.[t.edition]||{})}:null;}
function leagueName(i){return leaguePokemon(i,true)?.name||'Choose Pokémon';}
function leagueSync(){loadout=Loadouts.current();refreshPokemon();}
function leagueFormatControl(){return `<label class="slot-picker">Format <select data-loadout-format aria-label="Loadout format"><option value="single" ${!Loadouts.isLeague()?'selected':''}>Single Pokémon</option><option value="league" ${Loadouts.isLeague()?'selected':''}>League Format</option></select></label>`;}
function leagueContext(){if(!Loadouts.isLeague())return '';return `<section class="league-context"><a href="#loadout">League party</a><strong>Party member ${League.state().member+1} · ${esc(leagueName(League.state().member))}</strong><span>Changes apply to this member only.</span></section>`;}
function leagueSwitchCard(){const card=window.CHRONICLE_DATA.rules?.switch||window.FORMAT_DATA.switch;showDialog('SWITCH · Player action',`${art(card,false)}<div class="rules"><p>${esc(card.effect)}</p><p><strong>Standing:</strong> ${esc(card.standing)}</p><p class="meta">Available in League Format in addition to each Pokémon’s four moves. Apply the card’s roll and attack effects during play.</p></div>`);}
function leaguePartyCard(i,privateView){
 const s=League.state(),m=League.member(i),p=leaguePokemon(i,true),chosen=s.selected.includes(i),battle=s.phase==='battle',hp=League.hp(i,allCards()),active=s.active.includes(i);
 const selecting=privateView&&s.phase==='choose';
 const status=privateView&&battle&&chosen?`<span class="league-badge ${hp===0?'ko':''}">${hp===0?'KO':active?'Active':'Reserve'} · ${hp} HP</span>`:'';
 return `<article class="league-member ${selecting&&chosen?'chosen':''}"><div class="row"><span class="eyebrow">Party ${i+1}</span>${status}${selecting&&chosen?'<span class="league-badge">Selected</span>':''}</div>${p?art(privateView&&battle&&chosen?leaguePokemon(i)||p:p):'<div class="league-empty-art">Choose a Pokémon</div>'}<h2>${esc((privateView&&battle&&chosen?leaguePokemon(i)?.name:p?.name)||'Empty party member')}</h2>${!privateView||!chosen||s.phase==='choose'?'':`<p class="meta">${m.dice.filter(League.completeDie).length}/3 Enekoro recorded (optional)${chosen&&s.phase!=='choose'?' · '+m.stages[0].moves.length+'/4 base moves':''}</p>`}
 ${!battle&&!privateView?`<div class="league-actions"><button data-league="pokemon" data-member="${i}">${p?'Change Pokémon':'Choose Pokémon'}</button></div>`:''}
 ${selecting?`<button data-league="pick" data-member="${i}" class="${chosen?'selected-button':''}" aria-pressed="${chosen}">${chosen?'Remove from match':'Choose for match'}</button>`:''}
 ${privateView&&s.phase==='moves'&&chosen?`<div class="league-actions"><button data-league="moves" data-member="${i}">Choose moves</button><button data-league="dice" data-member="${i}">Set up 3 dice (optional)</button><button data-league="view" data-member="${i}">View loadout</button></div><p class="meta">${s.selected.indexOf(i)<League.activeLimit()?'Starts active':'Starts in reserve'}</p>`:''}
 ${privateView&&battle&&chosen?`<div class="league-actions"><button data-league="view" data-member="${i}">View loadout</button>${active?`<button data-league="switch" data-member="${i}" ${!League.reserves(allCards()).length&&hp>0?'disabled':''}>${hp===0?'Replace KO':'SWITCH'}</button>`:''}</div>`:''}</article>`;
}
function renderLeague(){
 document.body.classList.remove('loadout-screen');const s=League.state(),privateView=leaguePrivate;
 const teamReady=s.selected.length===League.limit(),battle=s.phase==='battle';
 const partyReady=League.partyErrors(allCards()),moveIssues=s.phase==='moves'?League.moveErrors(allCards()):[];
 app.innerHTML=`${slotControls(false)}<div class="heading"><div><div class="eyebrow">League Format</div><h1>${battle&&privateView?'Your match team':'Your party of six'}</h1><p class="muted">Six Pokémon · ${League.diceTotal()} Enekoro for ${s.mode==='singles'?'Singles':'Doubles'} · ${s.mode==='singles'?'Choose three for Singles':'Choose four for Doubles'}</p></div><a class="button-link" href="#rules/format/league">League rules</a></div>
 <div class="league-controls"><label class="slot-picker">Battle <select data-league-mode ${battle?'disabled':''} aria-label="League battle type"><option value="singles" ${s.mode==='singles'?'selected':''}>Single Battles · 3 Pokémon</option><option value="doubles" ${s.mode==='doubles'?'selected':''}>Double Battles · 4 Pokémon</option></select></label><button data-league="card">Read SWITCH card</button>${privateView?'<button data-league="hide">Hide match choices</button>':''}${battle?'<button data-league="new">New match</button>':''}</div>
 ${!privateView?`${!battle?chronicleControls():''}<p class="notice">Only the six-member party is shown here. Match choices, moves and HP remain hidden.</p><p class="meta">Enekoro setup is optional in the app. You can choose your team and start a match without entering dice.</p>${!battle?`<label class="owned-setting"><input data-league-owned type="checkbox" ${s.onlyOwned?'checked':''}><span><strong>Use only my collection</strong><small>Applies to optional dice setup for your selected match team. Unchosen Pokémon and other loadout slots do not use extra copies.</small></span></label>`:''}<div class="league-grid">${s.party.map((_,i)=>leaguePartyCard(i,false)).join('')}</div>${!battle&&partyReady.length?`<details class="notice"><summary>${partyReady.length} setup item${partyReady.length===1?'':'s'} remaining</summary><ul>${partyReady.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></details>`:''}<button class="primary" data-league="private">${battle?'Continue match privately':s.phase==='moves'?'Continue move setup privately':'Choose your match team privately'}</button><p class="meta">Show your party to your opponent first, then turn the screen toward yourself before continuing.</p>`:
 s.phase==='choose'?`<section class="league-step"><h2>Secretly choose ${League.limit()} Pokémon</h2><p>First ${League.activeLimit()===1?'choice starts active':'two choices start active'}. Remaining choices start in reserve.</p><strong aria-live="polite">${s.selected.length}/${League.limit()} chosen</strong></section><div class="league-grid">${s.party.map((_,i)=>leaguePartyCard(i,true)).join('')}</div><button class="primary" data-league="lock" ${!teamReady?'disabled':''}>Confirm team and choose moves</button>`:
 s.phase==='moves'?`<section class="league-step"><h2>Choose each Pokémon’s four moves</h2><p>Set up any required evolution loadouts too. SWITCH is a separate player action.</p><p>Prepare ${League.diceTotal()} Enekoro for this match. Recording their parts below is optional; empty or unfinished dice will not stop you from starting.</p><button data-league="back-picks">Change secret selections</button></section><div class="league-grid">${s.selected.map(i=>leaguePartyCard(i,true)).join('')}</div>${moveIssues.length?`<ul class="notice">${moveIssues.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:''}<button class="primary" data-league="start" ${moveIssues.length?'disabled':''}>Start match</button><p class="meta">Starting a match resets the chosen Pokémon to their base cards and printed HP.</p>`:
 battle?`<section class="league-step"><h2>${s.selected.every(i=>League.hp(i,allCards())===0)?'All your Pokémon are KO’d':'Match in progress'}</h2><p>${s.selected.every(i=>League.hp(i,allCards())===0)?'Your opponent wins this match.':'At 0 HP, replace your active Pokémon with a living reserve from this selected team. The first player to KO all opposing Pokémon wins.'}</p></section><div class="league-grid">${s.selected.map(i=>leaguePartyCard(i,true)).join('')}</div>`:''}`;
}
function renderLeagueDice(){
 document.body.classList.remove('loadout-screen');const s=League.state(),i=s.member,p=League.member(i),labels={a:'A side · Fixed',b:'B side · Fixed',s1:'Single chip 1',s2:'Single chip 2',d1:'Double chip 1',d2:'Double chip 2'};
 app.innerHTML=`<a class="back" href="#loadout">League party</a><h1>${esc(leagueName(i))} · Three Enecoro</h1><p class="muted">Optional: record this Pokémon’s dice, or return to the match team to continue without them. Prepare ${League.diceTotal()} Enekoro in total for ${s.mode==='singles'?'Single':'Double'} Battles. Each die uses one A side, one B side, two single chips and two double chips.</p><label class="owned-setting"><input data-league-owned type="checkbox" ${s.onlyOwned?'checked':''}><span><strong>Use only my collection</strong><small>Counts cover only the ${League.limit()} selected Pokémon (${League.diceTotal()} dice total). Before team selection, each Pokémon’s plan is counted independently.</small></span></label><div class="league-actions"><button data-league="copy-dice">Copy first 3 dice from Dice builder</button><a class="button-link" href="#collection">Update collection</a></div>
 ${s.onlyOwned&&League.shortages().length?'<p class="notice">Your collection is short of assigned parts for this match team. Change highlighted choices or update your inventory. Dice records are optional and do not block the match.</p>':''}<div class="dice-grid">${p.dice.map((d,j)=>`<section class="enecoro-card"><h2>Die ${j+1}</h2><div class="dice-faces">${EnecoroCollection.slots.map(k=>{const v=d[k],over=v&&s.onlyOwned&&League.available(i,j,k,v)<1;return `<div class="dice-face ${over?'overdrawn':''}"><label for="league-die-${j}-${k}">${labels[k]}</label><div class="face-preview">${v?partArt(v):'<span class="muted">Choose a part</span>'}</div><select id="league-die-${j}-${k}" data-league-die="${j}" data-league-face="${k}" ${over?'aria-invalid="true"':''}><option value="">Not selected</option>${EnecoroCollection.catalogue[k[0]].filter(c=>!s.onlyOwned||c===v||League.available(i,j,k,c)>0).map(c=>`<option value="${esc(c)}" ${v===c?'selected':''}>${esc(partName(k[0]+':'+c))}${s.onlyOwned?' · '+Math.max(0,League.available(i,j,k,c))+' available':''}</option>`).join('')}</select>${over?'<p class="shortage">Not enough owned</p>':''}</div>`;}).join('')}</div></section>`).join('')}</div><a href="#loadout" class="button-link">Save and return to match team</a>`;
}
function leagueBattleToolbar(){
 if(!Loadouts.isLeague())return '';
 const i=League.state().member,battle=League.state().phase==='battle',active=League.state().active.includes(i),hp=League.hp(i,allCards());
 return `<a href="#loadout">League party</a><span class="league-toolbar-label">Party ${i+1}${battle?' · '+(hp===0?'KO':active?'Active':'Reserve'):''}</span><button data-league="show-dice">Enekoro (optional)</button><button data-league="card">SWITCH card</button>${battle&&active?`<button data-league="switch" data-member="${i}">${hp===0?'Replace KO':'SWITCH'}</button>`:''}`;
}
function leagueSwitchDialog(i){
 const all=allCards(),choices=League.reserves(all),ko=League.hp(i,all)===0;
 showDialog(ko?'Replace KO’d Pokémon':'SWITCH your active Pokémon',`<p>${ko?'Choose a living reserve from your selected match team.':'Choose a living reserve, then roll your Characoro. On Standing, your new active Pokémon may attack.'}</p>${choices.map(j=>`<button class="league-switch-choice" data-league="replace" data-outgoing="${i}" data-member="${j}">${esc(leagueName(j))} · ${League.hp(j,all)} HP</button>`).join('')}${!choices.length?`<p>No living reserves remain.${League.state().selected.every(j=>League.hp(j,all)===0)?' All your chosen Pokémon are KO’d; your opponent wins.':''}</p>${ko?`<button data-league="retire" data-member="${i}">Remove KO’d Pokémon from active position</button>`:''}`:''}<button data-league="card">Read SWITCH card</button>`);
}
document.addEventListener('change',e=>{
 const t=e.target;try{
  if(t.matches('[data-loadout-format]')){persist();loadout=Loadouts.setFormat(t.value);leaguePrivate=false;refreshPokemon();if(modal.open)modal.close();setRoute('loadout');render();}
  if(t.matches('[data-league-mode]')){League.setMode(t.value);render();}
  if(t.matches('[data-league-owned]')){League.state().onlyOwned=t.checked;Loadouts.save();render();}
  if(t.matches('[data-league-die]')){League.choosePart(League.state().member,Number(t.dataset.leagueDie),t.dataset.leagueFace,t.value);renderLeagueDice();}
 }catch(err){toast(err.message);render();}
});
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-league]');if(!b)return;
 try{
  const i=Number(b.dataset.member),s=League.state();
  switch(b.dataset.league){
   case 'pokemon': persist();League.selectMember(i);Loadouts.slot().stage=0;Loadouts.save();leagueSync();showDialog('Choose party member '+(i+1),`<p>Choose this member’s base Pokémon. Its evolution loadouts are configured with Evolve.</p><div class="stage-pokemon-list">${pokemon.filter(p=>Loadouts.state.chronicle||p.year!==1997).map(p=>`<button data-league="set-pokemon" data-pokemon="${esc(p.id)}">${esc(p.name)} · ${p.year} ${p.year===1997?p.edition:''}</button>`).join('')}</div>`);break;
   case 'set-pokemon':{const p=byId(b.dataset.pokemon);if(!p)throw Error('Choose an available Pokémon.');if(loadout.pokemon===p.id){modal.close();render();break;}if(loadout.pokemon&&loadout.pokemon!==p.id){showDialog('Replace party member?',`<p>Replace ${esc(leagueName(s.member))} with ${esc(p.name)}? This member’s moves and evolution stages will be cleared; its dice are kept.</p><button data-league="confirm-pokemon" data-pokemon="${esc(p.id)}">Use ${esc(p.name)}</button>`);break;}loadout=Loadouts.replace({pokemon:p.id,moves:loadout.pokemon===p.id?loadout.moves:[],hp:p.hp,edition:p.edition||'RE'});refreshPokemon();modal.close();render();break;}
   case 'confirm-pokemon':{const p=byId(b.dataset.pokemon);if(!p)throw Error('Choose an available Pokémon.');loadout=Loadouts.replace({pokemon:p.id,moves:[],hp:p.hp,edition:p.edition||'RE'});refreshPokemon();modal.close();render();break;}
   case 'dice':persist();League.selectMember(i);leagueSync();setRoute('league/dice');break;
   case 'copy-dice':League.copyDice(s.member,EnecoroCollection.state.dice);renderLeagueDice();toast('Three dice copied into this party member.');break;
   case 'private':if(s.phase==='party')League.chooseTeam(allCards());leaguePrivate=true;renderLeague();break;
   case 'hide':leaguePrivate=false;renderLeague();break;
   case 'pick':League.toggleMember(i);renderLeague();break;
   case 'lock':League.lockTeam();renderLeague();break;
   case 'back-picks':s.phase='choose';Loadouts.save();renderLeague();break;
   case 'moves':persist();League.selectMember(i);Loadouts.slot().stage=0;Loadouts.save();leagueSync();if(!loadout.pokemon)throw Error('Choose a Pokémon first.');setRoute('build/'+loadout.pokemon);break;
   case 'view':leaguePrivate=true;persist();League.selectMember(i);leagueSync();setRoute('loadout/board');break;
   case 'start':loadout=League.start(allCards());refreshPokemon();renderLeague();break;
   case 'switch':leagueSwitchDialog(i);break;
   case 'replace':{const ko=League.hp(Number(b.dataset.outgoing),allCards())===0;loadout=League.switchActive(Number(b.dataset.outgoing),i,allCards());refreshPokemon();modal.close();setRoute('loadout/board');render();toast(ko?'KO’d Pokémon replaced.':'Active Pokémon changed. Roll your Characoro and apply SWITCH.');break;}
   case 'retire':League.retire(i,allCards());modal.close();setRoute('loadout');render();break;
   case 'card':leagueSwitchCard();break;
   case 'show-dice':showDialog(leagueName(s.member)+' · Enecoro',`<div class="league-dice-summary">${League.member(s.member).dice.map((d,j)=>`<section><h3>Die ${j+1}</h3>${EnecoroCollection.slots.map(k=>`<div><span>${{a:'A side',b:'B side',s1:'Single 1',s2:'Single 2',d1:'Double 1',d2:'Double 2'}[k]}</span>${d[k]?partArt(d[k]):'Not selected'}</div>`).join('')}</section>`).join('')}</div>`);break;
   case 'new':showDialog('Prepare a new match?',`<p>Keep all six Pokémon, their dice and move setups. Clear the current match selections; HP resets when you start the next match.</p><button data-league="confirm-new">Prepare new match</button>`);break;
   case 'confirm-new':League.newMatch();leaguePrivate=false;modal.close();renderLeague();break;
  }
 }catch(err){toast(err.message);}
});
