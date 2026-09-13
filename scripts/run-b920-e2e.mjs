import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const outputDir = path.resolve('artifacts-b920');
await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
page.on('dialog', d => d.accept().catch(()=>{}));
const consoleMessages=[]; const pageErrors=[];
page.on('console',m=>consoleMessages.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror',e=>pageErrors.push(String(e)));
function assert(c,m,d=null){if(!c){const e=new Error(m);e.details=d;throw e;}}
async function snapCharacter(){return page.evaluate(()=>{const c=data.characters.find(x=>x.name==='アルト');if(!c)throw new Error('Alto not found');const equip=c.equipment&&typeof c.equipment==='object'?JSON.parse(JSON.stringify(c.equipment)):null;return{gold:data.gold,job:c.job,level:c.level,skillPoints:c.skillPoints,stats:JSON.parse(JSON.stringify(c.stats)),equipment:equip,jobHistory:JSON.parse(JSON.stringify(c.jobHistory||[])),growthHistory:JSON.parse(JSON.stringify(c.growthHistory||[]))};});}
async function waitJobModalClosed(){await page.locator('#jobChangeModal').waitFor({state:'hidden',timeout:15000});}
let result=null,ok=false,failure=null;
try{
 await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/',{waitUntil:'networkidle',timeout:60000});
 const title=await page.title(); assert(title.includes('GA-B486.262'),'Public build is not GA-B486.262',{title});
 const catalog=await page.evaluate(()=>{const rows=[...formalJobCatalog.values()];return rows.map(x=>({id:x.id,name:x.name,aptitudes:{...x.aptitudes},sum:Object.values(x.aptitudes).reduce((a,b)=>a+Number(b||0),0)}));});
 assert(catalog.length===7,'Formal job count must be 7',catalog);
 assert(catalog.every(x=>x.sum===60),'Every job growth total must be 60',catalog);
 const sword=catalog.find(x=>x.id==='JOB-0001');
 assert(JSON.stringify(sword?.aptitudes)===JSON.stringify({STR:15,VIT:13,AGI:4,DEX:10,INT:7,MND:8,LUK:3}),'Swordsman growth coefficients mismatch',sword);
 await page.locator('#titleStart').click();
 await page.locator('#phase-base.active').waitFor({timeout:30000});
 await page.locator('#baseMobileNav [data-base-tab="adventurer"]').click();
 await page.locator('#roster .adventurer-row:has-text("アルト")').click();
 await page.locator('#openJobChange').waitFor({timeout:15000});
 const before=await snapCharacter();
 assert(before.job==='JOB-0001','Alto should start as swordsman',before);
 await page.locator('#openJobChange').click();
 await page.locator('[data-job-confirm="JOB-0002"]').click();
 await waitJobModalClosed();
 const knight=await snapCharacter();
 assert(knight.job==='JOB-0002','Job transfer to knight failed',knight);
 assert(knight.gold===before.gold,'Gold changed on job transfer',{before,knight});
 assert(knight.skillPoints===before.skillPoints,'SP changed on job transfer',{before,knight});
 assert(JSON.stringify(knight.stats)===JSON.stringify(before.stats),'Stats changed on job transfer',{before,knight});
 assert(JSON.stringify(knight.equipment)===JSON.stringify(before.equipment),'Equipment IDs changed on job transfer',{before,knight});
 assert(JSON.stringify(knight.growthHistory)===JSON.stringify(before.growthHistory),'Existing growth history changed on transfer',{before,knight});
 await page.locator('#openJobChange').click();
 await page.locator('[data-job-confirm="JOB-0001"]').click();
 await waitJobModalClosed();
 const roundTrip=await snapCharacter();
 assert(roundTrip.job==='JOB-0001','Round-trip back to swordsman failed',roundTrip);
 assert(roundTrip.gold===before.gold,'Gold changed after round-trip',{before,roundTrip});
 assert(roundTrip.skillPoints===before.skillPoints,'SP changed after round-trip',{before,roundTrip});
 assert(JSON.stringify(roundTrip.stats)===JSON.stringify(before.stats),'Stats changed after round-trip',{before,roundTrip});
 assert(JSON.stringify(roundTrip.equipment)===JSON.stringify(before.equipment),'Equipment changed after round-trip',{before,roundTrip});
 await page.locator('#openJobChange').click();
 await page.locator('[data-job-confirm="JOB-0002"]').click();
 await waitJobModalClosed();
 const preLevel=await snapCharacter();
 await page.locator('#levelBtn').click();
 await page.getByText('Skill Point +1',{exact:false}).waitFor({timeout:15000});
 const postLevel=await snapCharacter();
 assert(postLevel.level===preLevel.level+1,'Level did not increase',{preLevel,postLevel});
 assert(postLevel.growthHistory.length===preLevel.growthHistory.length+1,'Growth history entry not appended',{preLevel,postLevel});
 assert(JSON.stringify(postLevel.growthHistory.slice(0,-1))===JSON.stringify(preLevel.growthHistory),'Prior growth history mutated',{preLevel,postLevel});
 assert(postLevel.growthHistory.at(-1)?.job==='JOB-0002','Level-up did not use current knight job coefficients',postLevel.growthHistory.at(-1));
 result={catalog,before,knight,roundTrip,preLevel,postLevel}; ok=true;
 await page.screenshot({path:path.join(outputDir,'b920-pass.png'),fullPage:true});
}catch(err){failure=err?.stack||String(err);try{await page.screenshot({path:path.join(outputDir,'b920-failure.png'),fullPage:true});}catch{}}
finally{await fs.writeFile(path.join(outputDir,'result.json'),JSON.stringify({ok,failure,result,url:page.url()},null,2));await fs.writeFile(path.join(outputDir,'console.log'),consoleMessages.join('\n'));await fs.writeFile(path.join(outputDir,'page-errors.log'),pageErrors.join('\n'));await browser.close();}
if(!ok){console.error(failure);process.exit(1);} console.log('B920_E2E_PASS');
