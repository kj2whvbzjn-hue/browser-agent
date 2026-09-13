import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const out=path.resolve('artifacts-b928');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
function assert(c,m,d=null){if(!c){const e=new Error(m);e.details=d;throw e;}}
let ok=false,failure=null,result=null;
try{
 await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});
 assert((await page.title()).includes('GA-B486.262'),'Public build mismatch');
 result=await page.evaluate(async()=>{
  const C=globalThis.GKAdventureBattleCore;if(!C)throw new Error('GKAdventureBattleCore missing');
  const events=C.validationEventsToPlaybackEvents([{type:'formal_attack',tick:7,source_id:'A',target_id:'B',skill_id:'S',damage:0,shield_absorbed:25,hp_after:100}]);
  const damage=events.find(x=>x.type==='damage');
  const [runtime,index]=await Promise.all([fetch('assets/js/app-runtime.js',{cache:'no-store'}).then(r=>r.text()),fetch('index.html',{cache:'no-store'}).then(r=>r.text())]);
  const dev=[...document.querySelectorAll('.developer-only')].map(el=>({id:el.id||null,display:getComputedStyle(el).display,visible:!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length)}));
  return{damage,runtimeChecks:{speed:runtime.includes('data-adventure-battle-speed'),skip:runtime.includes('data-adventure-battle-skip'),savedSlice:runtime.includes('events.slice(0,cursor+1)'),barrierText:runtime.includes('BARRIER吸収'),prevDeveloper:runtime.includes('class="developer-only" data-adventure-battle-prev'),nextDeveloper:runtime.includes('class="developer-only" data-adventure-battle-next')},indexChecks:{devHide:index.includes('body:not(.dev-enabled) .developer-only{display:none!important}'),rerun: index.includes('同じFixtureで再戦')},dev};
 });
 assert(result.damage?.value===0&&result.damage?.shield_absorbed===25&&result.damage?.hp_after===100,'Barrier-only playback event corrupted',result.damage);
 assert(Object.values(result.runtimeChecks).every(Boolean),'Battle playback runtime controls/contracts missing',result.runtimeChecks);
 assert(result.indexChecks.devHide===true,'Developer-only release concealment missing',result.indexChecks);
 assert(result.indexChecks.rerun===false,'Immediate result rerun button must not exist',result.indexChecks);
 assert(result.dev.every(x=>x.display==='none'||x.visible===false),'Developer-only element visible in normal player flow',result.dev);
 ok=true;await page.screenshot({path:path.join(out,'b928-pass.png'),fullPage:true});
}catch(e){failure=e?.stack||String(e);try{await page.screenshot({path:path.join(out,'b928-failure.png'),fullPage:true});}catch{}}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok,failure,result,url:page.url()},null,2));await browser.close();}
if(!ok){console.error(failure);process.exit(1);}console.log('B928_E2E_PASS');
