import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const out=path.resolve('artifacts-b942-gs11');
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
 assert(title.includes('GA-B486.273'),'Public build is not GA-B486.273',{title});
 result=await page.evaluate(()=>{
  const D=globalThis.GKHitCriticalDomain;
  if(!D)throw new Error('GKHitCriticalDomain missing');
  let hitCalls=0;
  const crit=D.resolveHit({criticalRatePercent:5.5,accuracy:0,evasion:10,drawCritical:()=>0.01,drawHit:()=>{hitCalls++;return 0.99}});
  const noncrit=D.resolveHit({criticalRatePercent:5.5,accuracy:0,evasion:10,drawCritical:()=>0.9,drawHit:()=>0.5});
  return {
   build:globalThis.GA_PROJECT_CONFIG,
   criticalBase:D.criticalBaseRate({weaponCriticalRate:0.05,luk:10}),
   criticalBonus:D.INITIAL_CRITICAL_BONUS_DAMAGE_PERCENT,
   physicalZero:D.physicalHitRatePercent({accuracy:0,evasion:10}),
   magicHalf:D.magicalHitRatePercent({magicAccuracy:30,magicResistance:60}),
   magicCap:D.magicalHitRatePercent({magicAccuracy:120,magicResistance:60}),
   magicZeroRes:D.magicalHitRatePercent({magicAccuracy:0,magicResistance:0}),
   crit,noncrit,hitCalls
  };
 });
 assert(result.build?.gameBuild==='GA-B486.273'&&result.build?.studioBuild==='GKS-B942','Build metadata mismatch',result.build);
 assert(Math.abs(result.criticalBase-0.055)<1e-12,'5% + LUK10 critical base mismatch',result);
 assert(result.criticalBonus===50,'Critical bonus damage default mismatch',result);
 assert(result.physicalZero===0,'Physical hit must allow 0%',result);
 assert(result.magicHalf===50&&result.magicCap===100&&result.magicZeroRes===100,'Magic hit formula mismatch',result);
 assert(result.crit.critical===true&&result.crit.hit===true&&result.hitCalls===0,'Critical must bypass hit RNG',result);
 assert(result.crit.rng_consumption?.hit===0&&result.noncrit.rng_consumption?.hit===1,'RNG consumption mismatch',result);
 await page.locator('#titleStart').click();
 await page.locator('#phase-base.active').waitFor({timeout:30000});
 assert(pageErrors.length===0,'Page errors occurred',pageErrors);
 ok=true;
 await page.screenshot({path:path.join(out,'b942-gs11-pass.png'),fullPage:true});
}catch(err){failure=err?.stack||String(err);try{await page.screenshot({path:path.join(out,'b942-gs11-failure.png'),fullPage:true});}catch{}}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok,failure,result,url:page.url(),pageErrors,consoleRows},null,2));await browser.close();}
if(!ok){console.error(failure);process.exit(1);}console.log('B942_GS11_E2E_PASS');
