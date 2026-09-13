import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const out=path.resolve('artifacts-b941-weapon'); await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:1280,height:900}});
const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(String(e)));
let result=null,ok=false,failure=null;
try{
 await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});
 result=await page.evaluate(async()=>{
   const build=window.GA_PROJECT_CONFIG||{};
   const res=await fetch('../Export/equipment/equipment.json',{cache:'no-store'}); const payload=await res.json();
   const row=(payload.data||[]).find(x=>x.id==='EQP-0001');
   return {build,row,domain:!!window.GKWeaponGenerationDomain,runtime:!!window.GKGameEquipmentRuntime,
     snapshot:window.GKGameEquipmentRuntime?.weaponBaseItemRuntimeSnapshot?.('EQP-0001')||null};
 });
 if(result.build.gameBuild!=='GA-B486.272'||result.build.studioBuild!=='GKS-B941')throw new Error('Public build mismatch '+JSON.stringify(result.build));
 if(!result.domain||!result.runtime)throw new Error('GS07/GS06 runtime missing');
 const r=result.row,s=result.snapshot;
 if(!r||!s)throw new Error('EQP-0001 missing');
 if([r.required_str,r.required_dex,r.required_int,r.attack,r.accuracy,r.magic_weapon_bonus,r.magic_accuracy].join(',')!=='6,3,1,12,6,6,8')throw new Error('Formal weapon values mismatch');
 if(s.bonuses.attack!==12||s.required.STR!==6)throw new Error('Runtime snapshot does not use saved/exported values');
 if(pageErrors.length)throw new Error('page errors '+JSON.stringify(pageErrors));
 ok=true; await page.screenshot({path:path.join(out,'b941-weapon-pass.png'),fullPage:true});
}catch(e){failure=e?.stack||String(e);try{await page.screenshot({path:path.join(out,'b941-weapon-fail.png'),fullPage:true});}catch{}}
finally{await fs.writeFile(path.join(out,'result.json'),JSON.stringify({ok,failure,result,pageErrors,url:page.url()},null,2));await browser.close();}
if(!ok){console.error(failure);process.exit(1);} console.log('B941_WEAPON_E2E_PASS');
