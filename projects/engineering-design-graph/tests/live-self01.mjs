import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin='https://engineering-design-graph-ja.pzs4d5yv7g.chatgpt.site',out='artifacts/design-self01',run=process.env.GITHUB_RUN_ID,key='E2E-T-'+run;
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch(),ctx=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true}),page=await ctx.newPage();
const report={key,checks:[],status:'running',errors:[]};page.on('pageerror',e=>report.errors.push(e.message));
const get=async()=>{const r=await ctx.request.get(origin+'/api/project');assert.equal(r.status(),200);return r.json()};
const saved=()=>page.locator('#saveStatus[data-state=saved]').waitFor({timeout:45000});
async function save(method,click,status=200){const wait=page.waitForResponse(r=>r.url()===origin+'/api/project'&&r.request().method()===method);await click();const r=await wait;assert.equal(r.status(),status,await r.text());if(status===200)await saved()}
async function op(action,fill=async()=>{},status=200){await page.locator('[data-action=task-operation][data-id='+action+']').click();await fill();await save('POST',()=>page.locator('#dialogForm button[type=submit]').click(),status);if(status!==200)await page.locator('#dialogForm [data-close]').first().click()}
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name)}
let before,taskId;
try{
 await page.goto(origin+'/design/index.html');await saved();before=await get();await fs.writeFile(out+'/before-api.json',JSON.stringify(before));
 assert(!before.project.changeSets.some(c=>c.status==='open'&&c.items.length),'pending user work');
 await page.locator('[data-action=new]').click();await page.locator('#dialogForm [name=type]').selectOption('task');await page.locator('#dialogForm [name=key]').fill(key);await page.locator('#dialogForm [name=title]').fill('自己改善03・05：開始・保留・完了の実画面検証 '+run);
 await save('PUT',()=>page.locator('#dialogForm button[type=submit]').click());
 await page.locator('#artifactForm [name="payload.objective"]').fill('タスクの状態管理を実画面で検証する');
 await page.locator('#artifactForm [name="payload.definitionOfDone"]').fill('開始・保留・再開・完了の保存と再読込を確認');
 await save('PUT',()=>page.locator('button[form=artifactForm]').click());
 let d=await get();const cs=d.project.changeSets.find(c=>c.status==='open'&&c.items.some(i=>i.artifact?.key===key));assert(cs.items.every(i=>i.artifact?.key===key));taskId=cs.items[0].artifact.id;
 await page.locator('#nav [data-id=changes]').click();await page.locator('[data-action=preview][data-id="'+cs.id+'"]').click();await save('PUT',()=>page.locator('[data-action=apply][data-id="'+cs.id+'"]').click());
 await page.locator('#nav [data-id=overview]').click();await page.locator('#search').fill(key);await page.locator('[data-row-id="'+taskId+'"]').click();
 const proof='https://github.com/kj2whvbzjn-hue/browser-agent/actions/runs/'+run;
 await check('Configure assignee and separate start/completion requirements',async()=>{await op('configure',async()=>{
  await page.locator('[name=assignee]').fill('Playwright検証（自己申告）');
  await page.locator('[data-add-condition=startRequirements]').click();
  const row=page.locator('[data-requirements=startRequirements] fieldset');await row.locator('[data-field=label]').fill('検証対象の画面とデータが準備済み');await row.locator('[data-field=result]').selectOption('pass');await row.locator('[data-field=evidence]').fill(proof);
  assert.equal(await page.locator('[data-requirements=completionRequirements] [data-field=result]').inputValue(),'pending');
 });});
 await check('Submit and start before output check is complete',async()=>{await op('submit');await op('start');assert.equal((await get()).project.taskExecutions[taskId].state,'in_progress')});
 await check('Incomplete output check rejects completion',async()=>{await op('complete',async()=>{},422);assert.equal((await get()).project.taskExecutions[taskId].state,'in_progress')});
 await check('Hold and resume with reasons',async()=>{await op('hold',()=>page.locator('[name=reason]').fill('検証用の一時保留'));assert.equal((await get()).project.taskExecutions[taskId].state,'hold');await op('resume',()=>page.locator('[name=reason]').fill('検証を再開できることを確認'))});
 await op('configure',async()=>{const row=page.locator('[data-requirements=completionRequirements] fieldset');await row.locator('[data-field=result]').selectOption('pass');await row.locator('[data-field=evidence]').fill(proof)});
 await check('Complete and reload preserve state and history',async()=>{await op('complete');await page.reload();await saved();await page.locator('#search').fill(key);await page.locator('[data-row-id="'+taskId+'"]').click();const e=(await get()).project.taskExecutions[taskId];assert.equal(e.state,'done');assert(e.history.some(h=>h.action==='hold'));assert(e.history.some(h=>h.action==='resume'));assert.equal(await page.locator('.workflow [data-action=task-operation]').count(),0)});
 await page.screenshot({path:out+'/completed.png',fullPage:true});
 await check('Existing artifacts, relations and work records unchanged',async()=>{const after=await get();for(const a of before.project.artifacts)assert.deepEqual(after.project.artifacts.find(x=>x.id===a.id),a);assert.deepEqual(after.project.relations,before.project.relations);for(const [id,e] of Object.entries(before.project.taskExecutions||{}))assert.deepEqual(after.project.taskExecutions[id],e);assert.equal(after.project.artifacts.length,before.project.artifacts.length+1);await fs.writeFile(out+'/after-api.json',JSON.stringify(after))});
 assert.deepEqual(report.errors,[]);report.status='success';
}catch(e){report.status='failed';report.error=e.stack;await page.screenshot({path:out+'/failure.png',fullPage:true});console.error(e.stack)}
finally{await fs.writeFile(out+'/result.json',JSON.stringify(report,null,2));console.log('RESULT '+JSON.stringify(report));await browser.close()}
if(report.status!=='success')process.exitCode=1;
