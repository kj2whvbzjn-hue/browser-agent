import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const out=path.resolve('artifacts-b928');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});
function assert(c,m,d=null){if(!c){const e=new Error(m);e.details=d;throw e;}}
let result=null,ok=false,failure=null;
try{
 await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});
 assert((await page.title()).includes('GA-B486.262'),'Public build is not GA-B486.262');
 result=await page.evaluate(()=>{
  const Core=globalThis.GKAdventureBattleCore;if(!Core)throw new Error('GKAdventureBattleCore missing');
  const converted=Core.validationEventsToPlaybackEvents([{type:'battle_started',tick:0,seed:1},{type:'formal_attack',tick:1,source_id:'A1',target_id:'E1',skill_id:'S1',damage:0,shield_absorbed:30,hp_after:100},{type:'battle_finished',tick:2,result:'味方勝利'}]);
  const damage=converted.find(x=>x.type==='damage');
  const text=adventurePlaybackEventText(damage,{A1:'味方',E1:'敵'});
  const br={victory:true,result:'味方勝利',reward:{gold:7},statistics:{actions:1,ally_damage:0,enemy_damage:0},unit_final_state:[{id:'A1',name:'味方',side:'味方',hp:100,max_hp:100},{id:'E1',name:'敵',side:'敵',hp:100,max_hp:100}],playback_events:converted};
  const run={timeline_result:[{type:'event',result_index:0,battle_result_index:0,at_seconds:1}],event_results:[{type:'battle',event_id:'EV-1'}],battle_results:[br]};
  const before=JSON.stringify(run.battle_results[0]);
  renderAdventurePlaybackDetail(run,0);
  const detail=document.getElementById('adventurePlaybackDetail');
  const prev=detail.querySelector('[data-adventure-battle-prev]'),next=detail.querySelector('[data-adventure-battle-next]'),play=detail.querySelector('[data-adventure-battle-play]'),speed=detail.querySelector('[data-adventure-battle-speed]'),skip=detail.querySelector('[data-adventure-battle-skip]');
  speed.value='4';speed.dispatchEvent(new Event('change',{bubbles:true}));
  play.click();skip.click();
  const afterCurrent=detail.querySelector('[data-adventure-battle-current]')?.innerText||'';
  const history=detail.querySelector('[data-adventure-battle-events]')?.innerText||'';
  const after=JSON.stringify(run.battle_results[0]);
  const developerButton=document.getElementById('developerModeBtn');
  return{damage,text,afterCurrent,history,unchanged:before===after,speedValue:speed.value,prevDisplay:getComputedStyle(prev).display,nextDisplay:getComputedStyle(next).display,developerButtonHidden:developerButton.hidden,bodyDevEnabled:document.body.classList.contains('dev-enabled'),hasPlaybackSourceText:detail.innerText.includes('保存済みBattle Result / Playback Eventsのみを再生'),hasRewardText:detail.innerText.includes('戦闘報酬'),hasExpGrantText:/EXP\s*\+|経験値\s*\+/.test(detail.innerText)};
 });
 assert(result.damage.value===0&&result.damage.shield_absorbed===30&&result.damage.hp_after===100,'Barrier-only damage payload lost stored values',result.damage);
 assert(result.text.includes('0HPダメージ')&&result.text.includes('BARRIER吸収 30')&&result.text.includes('残HP 100'),'Barrier-only playback text is wrong',result.text);
 assert(result.unchanged,'Speed/Skip mutated stored Battle Result',result);
 assert(result.speedValue==='4'&&result.afterCurrent.includes('戦闘終了'),'Speed/Skip controls did not reach stored final event',result);
 assert(result.history.includes('BARRIER吸収 30'),'Skip/history did not reveal stored barrier event',result.history);
 assert(result.prevDisplay==='none'&&result.nextDisplay==='none','Developer previous/next controls visible in release mode',result);
 assert(result.developerButtonHidden===true&&result.bodyDevEnabled===false,'Developer mode entry is visible/enabled in normal release state',result);
 assert(result.hasPlaybackSourceText,'Battle detail does not identify saved-only playback source',result);
 assert(result.hasRewardText&&!result.hasExpGrantText,'Battle result display should show stored reward without granting/displaying EXP award',result);
 ok=true;await page.screenshot({path:path.join(out,'b928-pass.png'),fullPage:true});
}catch(err){failure=err?.stack||String(err);try{await page.screenshot({path:path.join(out,'b928-failure.png'),fullPage:true});}catch{}}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok,failure,result,url:page.url()},null,2));await browser.close();}
if(!ok){console.error(failure);process.exit(1);}console.log('B928_E2E_PASS');
