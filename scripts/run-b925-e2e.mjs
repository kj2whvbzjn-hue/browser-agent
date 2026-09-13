import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const out=path.resolve('artifacts-b925');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:800}});
function assert(c,m,d=null){if(!c){const e=new Error(m);e.details=d;throw e;}}
let result=null,ok=false,failure=null;
try{
 await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});
 assert((await page.title()).includes('GA-B486.262'),'Public build is not GA-B486.262');
 result=await page.evaluate(async()=>{
  const e=globalThis.GKSTriggerEngine;if(!e)throw new Error('GKSTriggerEngine missing');
  let calls=0;const rnd=()=>{calls++;return .9};
  const c0=e.createActionContext({actionId:'condition'});const condition=e.prepareActivation(c0,'P:A',{eligible:false,chance:.5,random:rnd});
  const z=e.createActionContext({actionId:'zero'});calls=0;const zero=e.prepareActivation(z,'P:0',{eligible:true,chance:0,random:rnd});const zeroCalls=calls;
  const one=e.createActionContext({actionId:'one'});calls=0;const onePrepared=e.prepareActivation(one,'P:1',{eligible:true,chance:1,random:rnd});const oneCalls=calls;const oneToken=e.activatePrepared(one,onePrepared);const reentry=e.canActivate(one,'P:1');
  const fail=e.createActionContext({actionId:'fail'});calls=0;const failChance=e.prepareActivation(fail,'P:F',{eligible:true,chance:.5,random:rnd});const failCalls=calls;
  oneToken.release();
  const cap=e.createActionContext({actionId:'cap'});const activations=[];for(let i=0;i<16;i++){const p=e.prepareActivation(cap,`P:${i}`,{chance:1});const t=e.activatePrepared(cap,p);activations.push(t.ok);t.release();}const seventeenth=e.prepareActivation(cap,'P:17',{chance:1});
  const ordered=e.orderReactiveEventCandidates([{id:'late',eventSequence:2,priority:5,sequence:0},{id:'tie2',eventSequence:1,priority:9,sequence:2},{id:'tie1',eventSequence:1,priority:9,sequence:1},{id:'low',eventSequence:1,priority:1,sequence:0}]).map(x=>x.id);
  const source=await fetch('assets/js/tag-skill-runtime.js').then(r=>r.text());
  const anchor=source.indexOf('projectedHp<=0?resolveFatalDamageInterrupt');
  const hpCommit=source.indexOf('target.hp=',anchor);
  const generalHit=source.indexOf("queueCurrentBattlePassiveReactive(target,'hit_received'",anchor);
  return{version:e.VERSION,condition:{...condition,count:c0.activationCount},zero:{...zero,count:z.activationCount,calls:zeroCalls},one:{prepared:onePrepared,count:one.activationCount,calls:oneCalls,reentry},fail:{...failChance,count:fail.activationCount,calls:failCalls},cap:{count:cap.activationCount,all16:activations.every(Boolean),seventeenth},ordered,orderingPositions:{anchor,hpCommit,generalHit}};
 });
 assert(result.condition.passed===false&&result.condition.count===0,'Condition fail consumed activation',result.condition);
 assert(result.zero.passed===false&&result.zero.count===0&&result.zero.calls===0,'chance=0 consumed RNG/commit',result.zero);
 assert(result.one.prepared.passed===true&&result.one.calls===0&&result.one.count===1,'chance=1 should commit with zero RNG',result.one);
 assert(result.one.reentry.ok===false&&result.one.reentry.reason==='TRIGGER_REENTRY_BLOCKED','Same passive re-entry not blocked',result.one.reentry);
 assert(result.fail.passed===false&&result.fail.count===0&&result.fail.calls===1,'Failed probabilistic chance consumed commit incorrectly',result.fail);
 assert(result.cap.all16&&result.cap.count===16&&result.cap.seventeenth.ok===false&&result.cap.seventeenth.reason==='TRIGGER_ACTION_LIMIT_REACHED','17th activation must be rejected',result.cap);
 assert(JSON.stringify(result.ordered)===JSON.stringify(['tie1','tie2','low','late']),'Reactive ordering must be event sequence, priority desc, sequence asc',result.ordered);
 const p=result.orderingPositions;assert(p.anchor>=0&&p.hpCommit>p.anchor&&p.generalHit>p.hpCommit,'Fatal interrupt must precede HP commit and general hit trigger must follow commit',p);
 ok=true;await page.screenshot({path:path.join(out,'b925-pass.png'),fullPage:true});
}catch(err){failure=err?.stack||String(err);try{await page.screenshot({path:path.join(out,'b925-failure.png'),fullPage:true});}catch{}}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok,failure,result,url:page.url()},null,2));await browser.close();}
if(!ok){console.error(failure);process.exit(1);}console.log('B925_E2E_PASS');
