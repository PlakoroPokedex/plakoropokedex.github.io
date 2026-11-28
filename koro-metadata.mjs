// .koro files are JSON, but mon_data.data may contain tens of megabytes of
// editor artwork as a string. None of that artwork belongs in the catalogue;
// the separately uploaded PNG is the exact image we store for offline use.
const encoder=new TextEncoder();
const fields=new Set(['mon_name','hp','type','weakness','weakness_visible','move_name','damage',
 ...['grass','fire','water','electric','psychic','fighting','dark','steel','dragon','flying','normal'].map(s=>s+'_energy'),
 ...Array.from({length:4},(_,i)=>'move_text_'+i),
 ...Array.from({length:3},(_,i)=>Array.from({length:6},(_,j)=>`move_${i+1}_facing_${j}`)).flat()]);
export const KORO_MAX_BYTES=128*1024*1024;
const fail=message=>Object.assign(Error(message),{retryable:false});

export async function readKoroMetadata(stream,{maxBytes=KORO_MAX_BYTES,maxJson=1024*1024,maxString=65536}={}){
 const reader=stream.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let bytes=0,output='',token='',depth=0,inString=false,escape=false,unicode=0,discard=false;
 function append(text){if(output.length+text.length>maxJson)throw fail('Card metadata exceeds the supported size.');output+=text;}
 function consume(text){
  for(let i=0;i<text.length;i++){
   const c=text[i];
   if(!inString){
    if(c==='"'){inString=true;token='"';discard=false;}
    else{append(c);if(c==='{'||c==='[')depth++;else if(c==='}'||c===']')depth--;}
    continue;
   }
   // Validate escapes/control characters even inside discarded artwork. A
   // truncated or malformed upload must never replace a complete catalogue.
   if(unicode){if(!/[0-9a-f]/i.test(c))throw fail('Invalid Unicode escape in .koro.');unicode--;}
   else if(escape){if(!'"\\/bfnrtu'.includes(c))throw fail('Invalid escape in .koro.');if(c==='u')unicode=4;escape=false;}
   else if(c==='\\')escape=true;
   else if(c==='"'){
    append(discard?'""':token+'"');inString=false;token='';continue;
   }else if(c.charCodeAt(0)<32)throw fail('Invalid control character in .koro.');
   if(!discard){
    token+=c;
    if(token.length>maxString){
     // Card text is always top-level. Never silently truncate names/effects.
     if(depth<=1)throw fail('Card text exceeds the supported size.');
     discard=true;token='';
    }
   }
  }
 }
 try{
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw fail('Drive editor file exceeds the supported size.');consume(decoder.decode(value,{stream:true}));}
  consume(decoder.decode());
  if(inString||depth!==0)throw fail('Incomplete .koro upload.');
  let value;try{value=JSON.parse(output);}catch{throw fail('Invalid .koro JSON.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail('Invalid .koro card.');
  const metadata={};
  for(const key of fields)if(Object.hasOwn(value,key)){
   const v=value[key];if(v!==null&&!['string','number','boolean'].includes(typeof v))throw fail('Invalid .koro card field: '+key);
   metadata[key]=v;
  }
  return encoder.encode(JSON.stringify(metadata));
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
}
