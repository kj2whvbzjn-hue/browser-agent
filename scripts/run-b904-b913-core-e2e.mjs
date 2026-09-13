import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const out=path.resolve('artifacts-b904-b913');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(String(e)));
function assert(c,m,d=null){if(!c){const e=new Error(m);e.details=d;throw e;}}
let result=null,ok=false,failure=null;
try{
  await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});
  const title=await page.title(); assert(title.includes('GA-B486.262'),'Public build is not GA-B486.262',{title});
  await page.locator('#titleStart').click();
  await page.locator('#phase-base.active').waitFor({timeout:30000});
  result=await page.evaluate(async()=>{
    const cfg=requireFormalRuntimeSettings().character;
    const chars=data.characters.map(c=>({id:c.id,name:c.name,skillPoints:c.skillPoints,formation_position:c.formation_position,skills:[...(c.skills||[])],passives:[...(c.passives||[])],passiveIds:[...(c.passiveIds||[])],hasPassiveLoadoutIds:Object.prototype.hasOwnProperty.call(c,'passiveLoadoutIds')}));
    const tempKey='guildAdventureV10.save.v4.tmp';
    const tempValue=localStorage.getItem(tempKey);
    const saveRaw=localStorage.getItem('guildAdventureV10.save.v4');
    const save=saveRaw?JSON.parse(saveRaw):null;

    const B=globalThis.GKRuntimeBoundaryContracts;if(!B)throw new Error('GKRuntimeBoundaryContracts missing');
    const mem=new Map([['main','OLD'],['backup','OLDER']]);
    const read=k=>mem.has(k)?mem.get(k):null;
    let mainCommitAttempted=false;
    const write=(op,k,v,phase)=>{if(phase==='autosave_main_commit'&&!mainCommitAttempted){mainCommitAttempted=true;throw new Error('E2E injected main failure');}if(op==='set')mem.set(k,String(v));else mem.delete(k);};
    let rollbackError='';try{B.commitTwoSlotSnapshot({payload:'NEW',mainKey:'main',backupKey:'backup',read,write,validatePayload:v=>{if(!['OLD','OLDER','NEW'].includes(v))throw new Error('invalid');}})}catch(e){rollbackError=String(e.message||e)}
    const rollbackState={main:read('main'),backup:read('backup'),rollbackError};

    let state={n:0},publishOrder=[];
    const coord=B.createSerialTransactionCoordinator({readState:()=>state,commitState:async s=>structuredClone(s),publishState:async s=>{state=structuredClone(s);publishOrder.push(s.n);}});
    const p1=coord.enqueue({operation:'add1',mutate:async s=>{await new Promise(r=>setTimeout(r,20));s.n+=1;}});
    const p2=coord.enqueue({operation:'add2',mutate:async s=>{s.n+=2;}});
    await Promise.all([p1,p2]); await coord.whenIdle();
    const serial={state:structuredClone(state),publishOrder:[...publishOrder],pending:coord.pendingCount()};

    const metrics=B.createMetrics();
    const probe=B.createRngProbe({sequences:{REWARD:[0.11],QUEST_SELECTION:[0.22],ENCOUNTER_SEED:[0.33]},metrics});
    const rngValues={reward:B.draw(probe,B.RNG_PURPOSES.REWARD,()=>0.9),quest:B.draw(probe,B.RNG_PURPOSES.QUEST_SELECTION,()=>0.9),encounter:B.draw(probe,B.RNG_PURPOSES.ENCOUNTER_SEED,()=>0.9)};
    const rngMetrics=metrics.snapshot();

    const Gate=globalThis.GKFormalRuntimeGate;if(!Gate)throw new Error('GKFormalRuntimeGate missing');
    const settingsPayload=await fetch('../Export/system/adventure_settings.json',{cache:'no-store'}).then(r=>r.json());
    const gateValid=Gate.validateAdventureSettingsPayload(settingsPayload);
    const broken=structuredClone(settingsPayload);const canonical=broken.data.find(x=>x.id==='ADV-0001');delete canonical.params.game_runtime.new_game.starting_gold;
    const gateBroken=Gate.validateAdventureSettingsPayload(broken);

    const appSource=await fetch('assets/js/app-runtime.js',{cache:'no-store'}).then(r=>r.text());
    return {cfg:structuredClone(cfg),chars,tempValue,saveSummary:{present:!!save,characters:(save?.characters||[]).map(c=>({name:c.name,hasPassiveLoadoutIds:Object.prototype.hasOwnProperty.call(c,'passiveLoadoutIds')}))},rollbackState,serial,rngValues,rngMetrics,gateValid,gateBroken,sourceChecks:{allowedSkillIdsLoadout:appSource.includes('allowedSkillIds:character.skillLoadoutIds')||appSource.includes('allowedSkillIds: character.skillLoadoutIds'),tempStorageWrite:appSource.includes('localStorage.setItem(SAVE_TEMP_KEY')}};
  });
  assert(result.chars.length>0,'New game created no characters',result.chars);
  for(const c of result.chars){
    assert(c.skillPoints===result.cfg.initial_skill_points,'B904 initial skill points mismatch',{c,cfg:result.cfg});
    assert(c.formation_position===result.cfg.initial_formation_position,'B904 initial formation mismatch',{c,cfg:result.cfg});
    for(const id of result.cfg.starter_skill_ids||[])assert(c.skills.includes(id),'B904 starter skill missing',{c,id});
    const acquired=new Set([...(c.passives||[]),...(c.passiveIds||[])]);for(const id of result.cfg.starter_passive_ids||[])assert(acquired.has(id),'B904 starter passive missing',{c,id});
    assert(c.hasPassiveLoadoutIds===false,'B907 obsolete passiveLoadoutIds survived in character',c);
  }
  assert(result.tempValue===null,'B906 temporary save key should not persist',result.tempValue);
  assert(result.saveSummary.present,'Current save was not persisted',result.saveSummary);
  assert(result.saveSummary.characters.every(c=>!c.hasPassiveLoadoutIds),'B907 obsolete passiveLoadoutIds survived in save',result.saveSummary);
  assert(result.rollbackState.main==='OLD'&&result.rollbackState.backup==='OLDER'&&result.rollbackState.rollbackError.includes('E2E injected'),'B912 two-slot rollback failed',result.rollbackState);
  assert(result.serial.state.n===3&&JSON.stringify(result.serial.publishOrder)===JSON.stringify([1,3])&&result.serial.pending===0,'B912 serial transaction order failed',result.serial);
  assert(result.rngValues.reward===0.11&&result.rngValues.quest===0.22&&result.rngValues.encounter===0.33,'B911 purpose-specific RNG injection failed',result.rngValues);
  assert(result.rngMetrics.rng_by_purpose.REWARD===1&&result.rngMetrics.rng_by_purpose.QUEST_SELECTION===1&&result.rngMetrics.rng_by_purpose.ENCOUNTER_SEED===1,'B911 RNG purposes not recorded separately',result.rngMetrics);
  assert(result.gateValid.ok===true,'B913 current formal Adventure Settings rejected',result.gateValid);
  assert(result.gateBroken.ok===false&&result.gateBroken.errors.some(e=>e.code==='REQUIRED_SETTING_MISSING'&&e.path.includes('starting_gold')),'B913 missing required setting not rejected',result.gateBroken);
  assert(result.sourceChecks.allowedSkillIdsLoadout===true,'B910 AI editor is not restricted to selected active skill loadout',result.sourceChecks);
  assert(result.sourceChecks.tempStorageWrite===false,'B906 obsolete SAVE_TEMP_KEY write still exists in public app-runtime',result.sourceChecks);
  ok=true; await page.screenshot({path:path.join(out,'b904-b913-pass.png'),fullPage:true});
}catch(err){failure=err?.stack||String(err);try{await page.screenshot({path:path.join(out,'b904-b913-failure.png'),fullPage:true});}catch{}}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok,failure,result,url:page.url()},null,2));await fs.writeFile(path.join(out,'page-errors.log'),pageErrors.join('\n'));await browser.close();}
if(!ok){console.error(failure);process.exit(1);}console.log('B904_B913_CORE_E2E_PASS');
