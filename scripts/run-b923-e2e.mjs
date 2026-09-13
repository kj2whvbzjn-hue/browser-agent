import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const outputDir=path.resolve('artifacts-b923'); await fs.mkdir(outputDir,{recursive:true});
const browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:1280,height:800}});
const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(String(e)));
function assert(c,m,d=null){if(!c){const e=new Error(m);e.details=d;throw e;}}
let result=null,ok=false,failure=null;
try{
 await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});
 assert((await page.title()).includes('GA-B486.262'),'Public build is not GA-B486.262');
 result=await page.evaluate(()=>{
  const d=globalThis.GKEquipmentModRarityDomain; if(!d)throw new Error('GKEquipmentModRarityDomain missing');
  const config={schema_version:'1',balance_ref:'BAL',instance_id_prefix:'E2E-',allowed_mod_schema_versions:['1'],routes:{NORMAL:{rarity_weights:[{id:'NORMAL',weight:1},{id:'UNIQUE',weight:100},{id:'LEGENDARY',weight:100},{id:'MYTHIC',weight:100}]},LOOT:{rarity_weights:[{id:'UNIQUE',weight:1}]}},mod_count_by_rarity:{NORMAL:[{count:2,weight:1}],UNIQUE:[{count:1,weight:1}],LEGENDARY:[{count:1,weight:1}],MYTHIC:[{count:1,weight:1}]},ability_slot:{enabled:false},normal_slot_allocations:{NORMAL:[{id:'N2',attack:2,defense:0,weight:1}],UNIQUE:[{id:'U1',attack:1,defense:0,weight:1}],LEGENDARY:[{id:'L1',attack:1,defense:0,weight:1}],MYTHIC:[{id:'M1',attack:1,defense:0,weight:1}]},category_weights:{ATTACK:[{id:'OFF',weight:1}],DEFENSE:[{id:'DEF',weight:1}],ABILITY:[{id:'ABL',weight:1}]},tier_weights:{ATTACK:[{id:'T1',weight:1}],DEFENSE:[{id:'T1',weight:1}],ABILITY:[{id:'T1',weight:1}]},quality_to_rarity:{common:'NORMAL',unique:'UNIQUE'}};
  const mods=[{id:'MOD-A',schema_version:'1',balance_ref:'BAL',slot_kind:'ATTACK',category:'OFF',weight:1,required_tags:[],any_tags:[],forbidden_tags:[]},{id:'MOD-B',schema_version:'1',balance_ref:'BAL',slot_kind:'ATTACK',category:'OFF',weight:1,required_tags:[],any_tags:[],forbidden_tags:[]}];
  const base={id:'ITEM-A',tags:[]};
  const input={config,route:'NORMAL',base_item:base,mods,seed:'SEED-42'};
  const a=d.generate(input),b=d.generate(input);
  const secondItem=d.generate({...input,base_item:{id:'ITEM-B',tags:[]}});
  const shortage=d.generate({...input,mods:[mods[0]]});
  const normalRarities=[]; for(let i=0;i<40;i++)normalRarities.push(d.generate({...input,seed:`S-${i}`}).rarity);
  const forbidden=d.generate({...input,requested_rarity:'UNIQUE'});
  const loot=d.generate({...input,route:'LOOT',requested_rarity:'UNIQUE'});
  return{version:d.VERSION,a,b,secondItem,shortage,normalRarities,forbidden,loot};
 });
 assert(result.a.ok&&result.b.ok,'Deterministic generation failed',result);
 assert(JSON.stringify(result.a.mods)===JSON.stringify(result.b.mods),'Same seed/settings changed MOD history',result);
 assert(JSON.stringify(result.a.draw_history)===JSON.stringify(result.b.draw_history),'Same seed/settings changed draw history',result);
 assert(new Set(result.a.mods.map(x=>x.mod_id)).size===result.a.mods.length,'Duplicate MOD within one item',result.a);
 const overlap=result.a.mods.map(x=>x.mod_id).filter(id=>result.secondItem.mods.some(x=>x.mod_id===id));
 assert(overlap.length>0,'Same MOD should be allowed across different items',{a:result.a.mods,b:result.secondItem.mods});
 assert(result.shortage.ok===false&&result.shortage.code==='MOD_CANDIDATE_EXHAUSTED','Candidate shortage did not fail finitely',result.shortage);
 assert(result.normalRarities.every(x=>!['UNIQUE','LEGENDARY','MYTHIC'].includes(x)),'NORMAL route generated blocked rarity',result.normalRarities);
 assert(result.forbidden.ok===false&&result.forbidden.code==='NORMAL_ROUTE_RARITY_FORBIDDEN','NORMAL explicit UNIQUE was not rejected',result.forbidden);
 assert(result.loot.ok===true&&result.loot.rarity==='UNIQUE','LOOT route could not generate configured UNIQUE',result.loot);
 ok=true; await page.screenshot({path:path.join(outputDir,'b923-pass.png'),fullPage:true});
}catch(err){failure=err?.stack||String(err);try{await page.screenshot({path:path.join(outputDir,'b923-failure.png'),fullPage:true});}catch{}}
finally{await fs.writeFile(path.join(outputDir,'result.json'),JSON.stringify({ok,failure,result,url:page.url()},null,2));await fs.writeFile(path.join(outputDir,'page-errors.log'),pageErrors.join('\n'));await browser.close();}
if(!ok){console.error(failure);process.exit(1);} console.log('B923_E2E_PASS');
