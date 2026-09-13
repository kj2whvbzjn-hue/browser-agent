import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const out=path.resolve('artifacts-b924'); await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:1280,height:800}});
function assert(c,m,d=null){if(!c){const e=new Error(m);e.details=d;throw e;}}
let result=null,ok=false,failure=null;
try{
 await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});
 assert((await page.title()).includes('GA-B486.262'),'Public build is not GA-B486.262');
 await page.addScriptTag({url:'https://kj2whvbzjn-hue.github.io/guild-adventure-studio/assets/shared/js/skill-ai-batch-engine.js'});
 result=await page.evaluate(async()=>{
  const [registry,rules,budgetRules]=await Promise.all([
   fetch('../assets/shared/config/skill-registry.json').then(r=>r.json()),
   fetch('../assets/shared/config/skill-ai-generation-rules.json').then(r=>r.json()),
   fetch('../assets/shared/config/skill-budget-rules.json').then(r=>r.json())
  ]);
  const e=globalThis.GKSSkillAiBatchEngine;if(!e)throw new Error('GKSSkillAiBatchEngine missing');
  const gen=req=>e.generateSkill(req,0,{registry,budgetRules,rules,idPrefix:'E2E',mode:'ACTIVE'});
  const capture=req=>{try{return{ok:true,value:gen(req)}}catch(error){return{ok:false,code:error.code,message:error.message}}};
  const phys2=gen({skillLevel:4,intent:'2Hit',statThresholds:{STR:20,AGI:20},abilityKind:'PHYSICAL_DAMAGE',activeBinding:{hitCount:2},target:'ENEMY',range:'SINGLE'});
  const agi19=capture({skillLevel:4,intent:'bad19',statThresholds:{STR:20,AGI:19},abilityKind:'PHYSICAL_DAMAGE',activeBinding:{hitCount:2},target:'ENEMY',range:'SINGLE'});
  const agi100=capture({skillLevel:10,intent:'bad100',statThresholds:{AGI:100},abilityKind:'PHYSICAL_DAMAGE',activeBinding:{hitCount:4},target:'ENEMY',range:'SINGLE'});
  const barrier=gen({skillLevel:4,intent:'Barrier',statThresholds:{MND:40},abilityKind:'BARRIER',activeBinding:{durationBudget:10},target:'ALLY',range:'SINGLE'});
  const critical=gen({skillLevel:3,intent:'Crit',statThresholds:{LUK:30},abilityKind:'CRITICAL_SPLIT',activeBinding:{rateBudget:10,damageBudget:20,duration:5},target:'ALLY',range:'SINGLE'});
  const all=gen({skillLevel:4,intent:'ALL',statThresholds:{STR:40},abilityKind:'PHYSICAL_DAMAGE',target:'ENEMY',range:'ALL'});
  const capIssues=e.validateRequest({skillLevel:11,intent:'cap',statThresholds:{STR:110},abilityKind:'PHYSICAL_DAMAGE',target:'ENEMY',range:'SINGLE'},0,registry,rules,{mode:'ACTIVE'});
  return{phys2,agi19,agi100,barrier,critical,all,capIssues};
 });
 assert(result.phys2.skill.effects.length===2&&result.phys2.skill.effects.every(x=>x.power===70),'STR20/AGI20 2Hit must be 70 each',result.phys2);
 assert(!result.agi19.ok&&result.agi19.code==='ACTIVE_PHYSICAL_MULTI_HIT_BUDGET_INSUFFICIENT','AGI19 2Hit should reject',result.agi19);
 assert(!result.agi100.ok&&result.agi100.code==='ACTIVE_PHYSICAL_MULTI_HIT_BUDGET_INSUFFICIENT','AGI100 4Hit should reject',result.agi100);
 const be=result.barrier.skill.effects[0]; assert(be.effectId==='BARRIER'&&be.power===30&&be.duration===2,'MND40 Barrier durationBudget10 mismatch',be);
 const ce=result.critical.skill.effects; assert(ce.length===2&&ce[0].power===1&&ce[1].power===40,'LUK30 split must be +1pp / relative40%',ce);
 const r=result.all.skill.resource; assert(r.mpCost===96&&r.cooldown===14&&r.castTime===7,'Level4 ALL resource seed mismatch',r);
 assert(result.capIssues.some(x=>x.code==='AI_STAT_THRESHOLD_INVALID'),'Level11 single-stat 110 should reject',result.capIssues);
 ok=true; await page.screenshot({path:path.join(out,'b924-pass.png'),fullPage:true});
}catch(err){failure=err?.stack||String(err);try{await page.screenshot({path:path.join(out,'b924-failure.png'),fullPage:true});}catch{}}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok,failure,result,url:page.url()},null,2));await browser.close();}
if(!ok){console.error(failure);process.exit(1);} console.log('B924_E2E_PASS');
