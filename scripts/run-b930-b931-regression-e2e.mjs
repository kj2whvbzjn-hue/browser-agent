import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const out=path.resolve('artifacts-b930-b931');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
function assert(c,m,d=null){if(!c){const e=new Error(m);e.details=d;throw e;}}
let result=null,ok=false,failure=null;
try{
  await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});
  const title=await page.title();assert(title.includes('GA-B486.262'),'Public build is not GA-B486.262',{title});
  const pre=await page.evaluate(()=>({
    resultToEventPresent:!!document.getElementById('resultToEvent'),
    runtimeLoaded:typeof window.GKNewGameDomain==='object',
    phase:document.querySelector('.phase-screen.active')?.dataset?.phase||''
  }));
  assert(pre.resultToEventPresent===false,'B930 obsolete resultToEvent button still exists',pre);
  assert(pre.runtimeLoaded===true,'New Game Domain not loaded',pre);
  assert(pageErrors.length===0,'B930 page error occurred before New Game',pageErrors);

  await page.locator('#titleStart').click();
  await page.locator('#phase-base.active').waitFor({timeout:30000});
  result=await page.evaluate(()=>{
    const raw=localStorage.getItem('guildAdventureV10.save.v4');
    const save=raw?JSON.parse(raw):null;
    const rootHas=save?Object.prototype.hasOwnProperty.call(save,'starter_equipment_instances'):false;
    const memoryHas=Object.prototype.hasOwnProperty.call(data,'starter_equipment_instances');
    const chars=(data.characters||[]).map(c=>({id:c.id,name:c.name,equipment:{...(c.equipment||{})}}));
    const equippedCount=chars.reduce((n,c)=>n+Object.values(c.equipment).filter(Boolean).length,0);
    const appSourcePromise=fetch('assets/js/app-runtime.js',{cache:'no-store'}).then(r=>r.text());
    return Promise.resolve(appSourcePromise).then(appSource=>({
      savePresent:!!save,
      rootHas,
      memoryHas,
      chars,
      equippedCount,
      sourceChecks:{
        guardedResultBinding:appSource.includes("if($('resultToEvent'))$('resultToEvent').onclick=launchStandaloneBattle"),
        transientStarterInstances:appSource.includes('const starterEquipmentInstances=GKNewGameDomain.buildStarterEquipmentInstances'),
        persistedStarterInstances:appSource.includes('candidate.starter_equipment_instances=GKNewGameDomain.buildStarterEquipmentInstances')
      }
    }));
  });
  assert(result.savePresent,'New Game save was not persisted',result);
  assert(result.rootHas===false,'B931 starter_equipment_instances persisted in save root',result);
  assert(result.memoryHas===false,'B931 starter_equipment_instances remained in live persistent state',result);
  assert(result.equippedCount>0,'Starter equipment was not applied to character equipment state',result);
  assert(result.sourceChecks.guardedResultBinding===true,'B930 resultToEvent null guard missing',result.sourceChecks);
  assert(result.sourceChecks.transientStarterInstances===true&&result.sourceChecks.persistedStarterInstances===false,'B931 starter equipment instances are not transient-only',result.sourceChecks);
  assert(pageErrors.length===0,'Page errors occurred during B930/B931 flow',pageErrors);
  ok=true;await page.screenshot({path:path.join(out,'b930-b931-pass.png'),fullPage:true});
}catch(err){failure=err?.stack||String(err);try{await page.screenshot({path:path.join(out,'b930-b931-failure.png'),fullPage:true});}catch{}}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok,failure,result,pageErrors,url:page.url()},null,2));await fs.writeFile(path.join(out,'page-errors.log'),pageErrors.join('\n'));await browser.close();}
if(!ok){console.error(failure);process.exit(1);}console.log('B930_B931_REGRESSION_E2E_PASS');
