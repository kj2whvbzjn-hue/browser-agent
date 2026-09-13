import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const out=path.resolve('artifacts-b937-quota');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const pageErrors=[]; const consoleRows=[];
page.on('pageerror',e=>pageErrors.push(String(e)));
page.on('console',m=>consoleRows.push(`${m.type()}: ${m.text()}`));
function assert(c,m,d=null){if(!c){const e=new Error(m);e.details=d;throw e;}}
let result=null,ok=false,failure=null;
try{
  await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});
  const title=await page.title();
  assert(title.includes('GA-B486.268'),'Public build is not GA-B486.268',{title});
  await page.locator('#titleStart').click();
  await page.locator('#phase-base.active').waitFor({timeout:30000});
  result=await page.evaluate(()=>{
    if(typeof writeAutoSaveSnapshotWithQuotaEviction!=='function')throw new Error('quota recovery writer missing');
    if(!globalThis.GKAdventureStorySystem)throw new Error('story system missing');
    const snapshot=structuredClone(data);
    snapshot.adventure={quest_runs:[],active_quest_run_id:'',history_limit:20,stone_selection_by_quest:{}};
    const run=(id,applied,seed)=>({quest_run_id:id,quest_id:'Q-E2E',section_id:'S',chapter_id:'C',seed,adventure_duration_seconds:60,results_applied:applied,final_result:{success:applied,final_state:{status:applied?'success':'failure',processed_box_count:0,last_processed_box_id:''}},playback_started_at:'2026-09-13T00:00:00.000Z'});
    GKAdventureStorySystem.saveQuestRun(snapshot,run('old-1',true,'seed-old-1'),{activate:false});
    GKAdventureStorySystem.saveQuestRun(snapshot,run('old-2',true,'seed-old-2'),{activate:false});
    GKAdventureStorySystem.saveQuestRun(snapshot,run('active-1',false,'seed-active-1'),{activate:true});
    const before=snapshot.adventure.quest_runs.map(r=>({id:r.quest_run_id,applied:r.results_applied}));
    const original=Storage.prototype.setItem;
    let quotaThrows=0;
    Storage.prototype.setItem=function(key,value){
      if((key===SAVE_KEY||key===SAVE_BACKUP_KEY)&&typeof value==='string'){
        try{
          const parsed=JSON.parse(value);
          const runs=parsed?.adventure?.quest_runs;
          if(Array.isArray(runs)&&runs.length>1){
            quotaThrows++;
            throw new DOMException('The quota has been exceeded.','QuotaExceededError');
          }
        }catch(e){if(e?.name==='QuotaExceededError')throw e;}
      }
      return original.call(this,key,value);
    };
    let committed;
    try{committed=writeAutoSaveSnapshotWithQuotaEviction(snapshot);}
    finally{Storage.prototype.setItem=original;}
    const raw=localStorage.getItem(SAVE_KEY),saved=raw?JSON.parse(raw):null;
    return {
      quotaThrows,
      before,
      committedRuns:(committed?.adventure?.quest_runs||[]).map(r=>({id:r.quest_run_id,applied:r.results_applied})),
      savedRuns:(saved?.adventure?.quest_runs||[]).map(r=>({id:r.quest_run_id,applied:r.results_applied})),
      activeId:saved?.adventure?.active_quest_run_id||'',
      recovery:typeof currentSaveRecoveryState==='function'?currentSaveRecoveryState():null,
      build:globalThis.GA_PROJECT_CONFIG
    };
  });
  assert(result.quotaThrows>=2,'Quota injection did not exercise retry path',result);
  assert(result.savedRuns.length===1,'Completed runs were not evicted down to storable size',result);
  assert(result.savedRuns[0].id==='active-1'&&result.savedRuns[0].applied===false,'Active run was not preserved',result);
  assert(result.activeId==='active-1','Active quest run id changed',result);
  assert(!result.savedRuns.some(r=>r.id==='old-1'||r.id==='old-2'),'Old completed runs survived quota eviction',result);
  assert(result.recovery?.visible!==true,'Save recovery modal remained visible after successful quota recovery',result.recovery);
  assert(pageErrors.length===0,'Page errors occurred',pageErrors);
  ok=true;
  await page.screenshot({path:path.join(out,'b937-quota-pass.png'),fullPage:true});
}catch(err){failure=err?.stack||String(err);try{await page.screenshot({path:path.join(out,'b937-quota-failure.png'),fullPage:true});}catch{}}
finally{
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok,failure,result,url:page.url(),pageErrors,consoleRows},null,2));
  await browser.close();
}
if(!ok){console.error(failure);process.exit(1);}console.log('B937_QUOTA_EVICTION_E2E_PASS');
