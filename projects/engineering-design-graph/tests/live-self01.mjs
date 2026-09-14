import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin='https://engineering-design-graph-ja.pzs4d5yv7g.chatgpt.site',url=origin+'/design/index.html';
const run=process.env.GITHUB_RUN_ID||Date.now().toString(),key='E2E-Q-'+run;
const out='artifacts/design-self01';await fs.mkdir(out,{recursive:true});
const report={run,url,key,siteCommit:'07bedcad091448ff30ba799d0786246b20d15228',status:'running',checks:[],writes:[],pageErrors:[],metrics:[],runUrl:`https://github.com/kj2whvbzjn-hue/browser-agent/actions/runs/${run}`};
const browser=await chromium.launch();const ctx=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});const page=await ctx.newPage();
page.on('pageerror',e=>report.pageErrors.push(e.message));
let navigations=0;page.on('framenavigated',f=>{if(f===page.mainFrame())navigations++});
await ctx.addInitScript(()=>{window.__edgMetrics={clicks:0,scrolls:0};document.addEventListener('click',()=>window.__edgMetrics.clicks++,true);document.addEventListener('scroll',()=>window.__edgMetrics.scrolls++,true)});
async function api(){const r=await ctx.request.get(origin+'/api/project');assert.equal(r.status(),200,'API read');return r.json()}
async function check(name,fn){await fn();report.checks.push({name,result:'PASS'});console.log('PASS '+name)}
async function loaded(){await page.locator('#saveStatus[data-state=saved]').waitFor({timeout:45000})}
async function mutate(name,fn){const response=page.waitForResponse(r=>r.url()===origin+'/api/project'&&r.request().method()==='PUT',{timeout:30000});await fn();const r=await response;report.writes.push({name,status:r.status()});assert.equal(r.status(),200,await r.text());await loaded()}
async function capture(name){await page.screenshot({path:`${out}/${name}.png`,fullPage:true});report.metrics.push({name,navigations,...await page.evaluate(()=>({...window.__edgMetrics,listScroll:document.querySelector('#listBody')?.scrollTop,detailScroll:document.querySelector('#detailBody')?.scrollTop,bodyScroll:document.scrollingElement.scrollTop,horizontalOverflow:document.documentElement.scrollWidth>innerWidth}))})}
async function applyOwn(){const d=await api(),cs=d.project.changeSets.find(c=>c.status==='open'&&c.items.some(i=>i.artifact?.key===key||i.artifactId===report.probeId));assert(cs,'own changeset');assert(cs.items.every(i=>i.artifact?.key===key||i.artifactId===report.probeId),'refuse to apply unrelated pending work');
 await page.locator('#nav [data-id=changes]').click();await page.locator(`[data-action=preview][data-id="${cs.id}"]`).click();await capture('before-apply-'+report.writes.length);await mutate('apply own probe',()=>page.locator(`[data-action=apply][data-id="${cs.id}"]`).click())}
let before;
try{
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await loaded();before=await api();
 report.before={name:before.project.name,id:before.project.id,revision:before.revision,artifacts:before.project.artifacts.length,hasPlan:before.project.artifacts.some(a=>a.key==='TASK-IMP-01')};console.log('BEFORE '+JSON.stringify(report.before));
 await fs.writeFile(out+'/before-api.json',JSON.stringify(before,null,2));
 await check('UI export backup matches persisted project',async()=>{await page.locator('.project-menu > summary').click();const download=page.waitForEvent('download');await page.locator('[data-action=export]').click();await(await download).saveAs(out+'/before-project.json');assert.deepEqual(JSON.parse(await fs.readFile(out+'/before-project.json','utf8')),before.project);await page.locator('.project-menu > summary').click()});
 assert(!before.project.changeSets.some(c=>['open','ready'].includes(c.status)&&c.items.length),'Existing pending changes: do not mutate or apply user work');
 assert(!before.project.artifacts.some(a=>a.key===key),'Do not duplicate probe');
 // Compare the rendered project's exported state to the freshest server revision before writes.
 const fresh=await api();assert.deepEqual(fresh,before,'Project changed while creating backup');
 await page.locator('#filterType').selectOption('question');await page.locator('[data-action=new]').click();await page.locator('#dialogForm [name=type]').selectOption('question');await page.locator('#dialogForm [name=key]').fill(key);await page.locator('#dialogForm [name=title]').fill('自己改善01：実画面の登録・保存検査 '+run);
 await mutate('stage new question',()=>page.locator('#dialogForm button[type=submit]').click());
 const staged=await api();report.probeId=staged.project.changeSets.flatMap(c=>c.items).find(i=>i.artifact?.key===key).artifact.id;
 await page.locator('#artifactForm [name="payload.question"]').fill('Playwrightで未解決の課題を正式登録し、保存・再読込後も残ることを検証する。');await page.locator('#artifactForm [name="payload.blocking"]').check();
 await capture('question-edit');await mutate('stage unresolved payload',()=>page.locator('button[form=artifactForm]').click());
 await check('Unresolved blocking question applies through UI',applyOwn);
 await page.reload();await loaded();const afterCreate=await api();const q=afterCreate.project.artifacts.find(a=>a.key===key);assert(q?.payload.blocking&&!q.payload.answer);report.checks.push({name:'Server reload preserves unresolved question',result:'PASS'});
 await page.locator('#search').fill(key);await page.locator(`[data-row-id="${q.id}"]`).click();await page.locator('[data-action=detail-tab][data-id=issues]').click();assert((await page.locator('#detailBody').innerText()).includes('未解決事項'));await capture('unresolved-after-reload');
 await page.locator('#inspector [data-action=edit]').first().click();await page.locator('#artifactForm [name="payload.answer"]').fill('PASS: GitHub Actions上のPlaywrightで登録→変更適用→再読込を検証。未解決状態の保存を確認したためこの検査項目を解決。実行記録: '+report.runUrl+'。元の不具合は自己改善01で修正。タスク別の着手判定や全機能完了を意味しない。');
 await mutate('stage probe resolution',()=>page.locator('button[form=artifactForm]').click());await check('Resolve recorded question through UI',applyOwn);
 await page.reload();await loaded();const after=await api();await fs.writeFile(out+'/after-api.json',JSON.stringify(after,null,2));
 await check('Original artifacts and relations unchanged',async()=>{for(const a of before.project.artifacts)assert.deepEqual(after.project.artifacts.find(x=>x.id===a.id),a);assert.deepEqual(after.project.relations,before.project.relations);assert.equal(after.project.artifacts.length,before.project.artifacts.length+1)});
 await check('Resolved answer survives fresh context',async()=>{const other=await browser.newContext();try{const r=await other.request.get(origin+'/api/project');assert.equal(r.status(),200);const d=await r.json();assert(d.project.artifacts.find(a=>a.id===q.id).payload.answer.includes(report.runUrl))}finally{await other.close()}});
 await page.locator('#search').fill(key);await page.locator(`[data-row-id="${q.id}"]`).click();await capture('resolved-proof');
 await check('No uncaught page errors',async()=>assert.deepEqual(report.pageErrors,[]));
 report.after={revision:after.revision,artifacts:after.project.artifacts.length,probeId:q.id};report.status='success';
}catch(e){report.status='failed';report.error=e.stack;console.error(e.stack);await capture('failure').catch(()=>{});await fs.writeFile(out+'/failure-body.txt',await page.locator('body').innerText().catch(()=>''));}
finally{report.navigations=navigations;await fs.writeFile(out+'/result.json',JSON.stringify(report,null,2));console.log('RESULT '+JSON.stringify(report));await browser.close();}
if(report.status!=='success')process.exitCode=1;
