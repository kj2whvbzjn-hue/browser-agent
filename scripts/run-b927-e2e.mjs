import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const out=path.resolve('artifacts-b927');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:800}});
function assert(c,m,d=null){if(!c){const e=new Error(m);e.details=d;throw e;}}
let result=null,ok=false,failure=null;
try{
 await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});
 assert((await page.title()).includes('GA-B486.262'),'Public build is not GA-B486.262');
 result=await page.evaluate(()=>{
  const S=globalThis.GKAdventureStorySystem;if(!S)throw new Error('GKAdventureStorySystem missing');
  const scene={id:'SC-E2E',chapter_id:'CH-E2E',section_id:'SEC-E2E',background_ref:'BG-1',effect_ref:'FX-1',dialogues:[{speaker:'A',text:'first'},{speaker:'B',text:'second'}]};
  const quest={id:'Q-E2E',adventure_duration_seconds:100,boxes:[{box_id:'BOX-1',order:1,pre_scene_id:'SC-E2E',mid_scene_id:null,post_scene_id:null,event_zone_before_pre:[],event_zone_pre_to_mid:[],event_zone_mid_to_post:[],event_zone_after_post:[{kind:'fixed_event',event_id:'EV-1',order:1,failure_policy:'continue'}]}]};
  const run=S.simulateQuest({quest,scenes:[scene],events:[{id:'EV-1',type:'special'}],seed:7,playbackStartedAt:'2026-09-13T00:00:00.000Z',resolveEvent:()=>({success:true,reward:{gold:5},flags:{'F-E2E':true}})});
  scene.dialogues[0].text='mutated master';scene.background_ref='BG-MUTATED';scene.effect_ref='FX-MUTATED';
  const beforeRead=S.sceneReadState(run,0);
  const t15=S.playbackState(run,Date.parse(run.playback_started_at)+15000);
  S.markSceneDialogueRead(run,0,0);
  const afterOne=S.sceneReadState(run,0);
  const historyOne=S.sceneDialogueHistory(run,0);
  const skipFromZero=S.nextSceneDialogueIndex(run,0,0,{skipRead:true});
  const t65=S.playbackState(run,Date.parse(run.playback_started_at)+65000);
  const save={gold:0,flags:{},completed:[]};
  const handlers={applyReward:(s,r)=>s.gold+=Number(r.gold||0),applyFlags:(s,f)=>Object.assign(s.flags,f),applyQuestProgress:(s,p)=>s.completed.push(p.complete_quest_id)};
  const firstCommit=S.commitQuestRun(run,save,handlers);
  const afterFirst=JSON.parse(JSON.stringify(save));
  const secondCommit=S.commitQuestRun(run,save,handlers);
  return{snapshot:run.scene_snapshots[0],beforeRead,afterOne,historyOne,skipFromZero,t15,t65,firstCommit,afterFirst,secondCommit,afterSecond:save,storyViewState:run.story_view_state};
 });
 assert(result.snapshot.dialogues[0].text==='first','Master dialogue mutation leaked into Run snapshot',result.snapshot);
 assert(result.snapshot.background_ref==='BG-1'&&result.snapshot.effect_ref==='FX-1','Master display-ref mutation leaked into Run snapshot',result.snapshot);
 assert(result.beforeRead.read_count===0&&result.afterOne.read_count===1,'Read state did not advance independently',result);
 assert(result.historyOne.length===1&&result.historyOne[0].text==='first','History must contain only read dialogue',result.historyOne);
 assert(result.skipFromZero===1,'Read Skip must move to first unread dialogue',result.skipFromZero);
 assert(result.t15.elapsed_seconds===15&&result.t65.elapsed_seconds===65,'Scene viewing/read state stopped or rewound wall-clock playback',{t15:result.t15,t65:result.t65});
 assert(result.firstCommit.applied===true&&result.afterFirst.gold===5&&result.afterFirst.flags['F-E2E']===true,'First stored result commit failed',result);
 assert(result.secondCommit.applied===false&&result.secondCommit.reason==='already_applied','Re-view/second commit must not duplicate result',result.secondCommit);
 assert(JSON.stringify(result.afterSecond)===JSON.stringify(result.afterFirst),'Second commit changed save state',{first:result.afterFirst,second:result.afterSecond});
 ok=true;await page.screenshot({path:path.join(out,'b927-pass.png'),fullPage:true});
}catch(err){failure=err?.stack||String(err);try{await page.screenshot({path:path.join(out,'b927-failure.png'),fullPage:true});}catch{}}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok,failure,result,url:page.url()},null,2));await browser.close();}
if(!ok){console.error(failure);process.exit(1);}console.log('B927_E2E_PASS');
