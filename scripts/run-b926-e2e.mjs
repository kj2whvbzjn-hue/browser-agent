import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const out=path.resolve('artifacts-b926');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:800}});
function assert(c,m,d=null){if(!c){const e=new Error(m);e.details=d;throw e;}}
let result=null,ok=false,failure=null;
try{
 await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});
 assert((await page.title()).includes('GA-B486.262'),'Public build is not GA-B486.262');
 result=await page.evaluate(async()=>{
  const V=globalThis.GKSAIProgramValidator,C=globalThis.GKSAIProgramCompiler,E=globalThis.GKSAIDecisionEngine;if(!V||!C||!E)throw new Error('AI V2 runtime missing');
  const dv='e2e';const ports=o=>({inputs:[{id:'in',kind:'flow',data_type:'flow'}],outputs:o.map(id=>({id,kind:'flow',data_type:'flow'}))});
  const project={tag_categories:[{id:'TGC-TARGET',name:'対象'},{id:'TGC-EFFECT',name:'効果'},{id:'TGC-STATE',name:'状態'}],tags:[{id:'TAG-TARGET-SAME',name:'同名',category_id:'TGC-TARGET',runtime_semantic:'ENEMY'},{id:'TAG-EFFECT-SAME',name:'同名',category_id:'TGC-EFFECT'},{id:'TAG-HP',name:'HP',category_id:'TGC-STATE',runtime_semantic:'HP'}],masters:{skills:[],ai_searches:[],ai_conditions:[],ai_target_selectors:[],ai_actions:[{id:'AIA-ATTACK',name:'攻撃',status:'active',data_version:dv,evaluator:'action.attack',ports:ports([]),parameter_schema:{type:'object',properties:{},required:[],additionalProperties:false}}]}};
  const program=(conditionTag)=>({schema_version:'2.0.0',data_version:dv,id:`AIP-${conditionTag}`,name:'E2E',version:1,status:'valid',entry_node_id:'A',nodes:[{instance_id:'A',master_node_id:'AIA-ATTACK',master_data_version:dv,node_type:'action',position:{x:0,y:0},parameters:{},target_tag_id:'TAG-TARGET-SAME',target_condition:{tag_id:conditionTag,params:conditionTag==='TAG-HP'?{value_mode:'CURRENT',order:'MIN'}:{}},target_selector:null,target_source:null}],edges:[],subroutines:[]});
  const hpProgram=program('TAG-HP');const hpValidation=V.validate(hpProgram,project);const hpRuntime=await C.compile(hpProgram,project);
  const context={battle_id:'B',actor_id:'U1',units:[{id:'U1',side:'A',alive:true,hp:100,max_hp:100},{id:'U2',side:'B',alive:true,hp:60,max_hp:100},{id:'U3',side:'B',alive:true,hp:20,max_hp:100},{id:'U4',side:'B',alive:true,hp:20,max_hp:100}]};
  const action=(ev,pa,ctx)=>({action_id:'attack',target_contract:{side:'ENEMY',range:'SINGLE'},legal_candidates:ctx.units.filter(x=>x.side==='B')});
  let playerCalls=0,monsterCalls=0;const player=E.execute(hpRuntime,{...structuredClone(context),actor_kind:'PLAYER'},{action,ai_decision_rng:()=>{playerCalls++;return .75;}});const monster=E.execute(hpRuntime,{...structuredClone(context),actor_kind:'MONSTER'},{action,ai_decision_rng:()=>{monsterCalls++;return .75;}});
  const effectProgram=program('TAG-EFFECT-SAME');const effectValidation=V.validate(effectProgram,project);const effectRuntime=await C.compile(effectProgram,project);const effectContext=structuredClone(context);effectContext.units[2].effect_tag_ids=['TAG-EFFECT-SAME'];let oneCalls=0;const one=E.execute(effectRuntime,effectContext,{action,ai_decision_rng:()=>{oneCalls++;return .5;}});
  const collision={target:V.resolveTargetTag('TAG-TARGET-SAME',project),condition:V.resolveActionConditionTag('TAG-EFFECT-SAME',project),compiled:effectRuntime.instructions[0]};
  const unknown=structuredClone(effectProgram);unknown.id='AIP-UNKNOWN';unknown.nodes[0].target_condition={tag_id:'TAG-UNKNOWN-NONEMPTY',params:{}};const unknownValidation=V.validate(unknown,project);
  return{hpValidation,effectValidation,player:{outcome:player.outcome,calls:playerCalls,rng:player.events.filter(x=>x.event_type==='rng')},monster:{outcome:monster.outcome,calls:monsterCalls,rng:monster.events.filter(x=>x.event_type==='rng')},one:{outcome:one.outcome,calls:oneCalls,rng:one.events.filter(x=>x.event_type==='rng')},collision,unknownValidation};
 });
 assert(result.hpValidation.valid&&result.effectValidation.valid,'Valid AI programs were rejected',result);
 assert(JSON.stringify(result.player.outcome)===JSON.stringify(result.monster.outcome),'Player/Monster common executor diverged',{player:result.player,monster:result.monster});
 assert(result.player.calls===1&&result.monster.calls===1,'Multiple equal MIN candidates must consume one RNG',{player:result.player,monster:result.monster});
 assert(result.player.rng.length===1&&result.player.rng[0].rng_stream==='AI_DECISION','Wrong RNG stream for tie selection',result.player.rng);
 assert(result.one.outcome.target_id==='U3'&&result.one.calls===0&&result.one.rng.length===0,'Single candidate must consume no RNG',result.one);
 assert(result.collision.target?.semantic==='ENEMY','Target-category same-name tag was confused',result.collision);
 assert(result.collision.condition?.kind==='ACTIVE_EFFECT_TAG'&&result.collision.condition?.tag?.id==='TAG-EFFECT-SAME','Effect-category same-name tag was confused',result.collision);
 assert(result.collision.compiled.target_scope==='ENEMY'&&result.collision.compiled.target_condition?.params?.tag_id==='TAG-EFFECT-SAME','Compiled tag categories were crossed',result.collision.compiled);
 assert(result.unknownValidation.valid===false&&result.unknownValidation.issues.length>0,'Unknown non-empty tag must be rejected',result.unknownValidation);
 ok=true;await page.screenshot({path:path.join(out,'b926-pass.png'),fullPage:true});
}catch(err){failure=err?.stack||String(err);try{await page.screenshot({path:path.join(out,'b926-failure.png'),fullPage:true});}catch{}}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok,failure,result,url:page.url()},null,2));await browser.close();}
if(!ok){console.error(failure);process.exit(1);}console.log('B926_E2E_PASS');
