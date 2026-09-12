import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const fixturePath='projects/tsugu/fixtures/implementation-plan.json';
const raw=await fs.readFile(fixturePath,'utf8'),source=JSON.parse(raw),fixture=source.projects[0];
const live=process.env.TSUGU_TEST_MODE==='live';
const root=live?'artifacts/tsugu-live':'artifacts/tsugu';await fs.mkdir(root,{recursive:true});
const report={tested_commit:'0e763949abec7bfb0def2d5840c4857f13cfe0b0',fixture_sha256:createHash('sha256').update(raw).digest('hex'),mode:live?'REAL_GITHUB':'STATEFUL_API_FIXTURE',real_save:live?'PENDING':'NOT_RUN_NO_AUTH',counts:Object.fromEntries(Object.entries(fixture).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length])),viewports:[],failures:[]};
if(live&&!process.env.TSUGU_E2E_TOKEN){report.real_save='BLOCKED_MISSING_TSUGU_E2E_TOKEN';await fs.writeFile(`${root}/real-save-status.json`,JSON.stringify(report,null,2));console.log('REAL_SAVE_BLOCKED: TSUGU_E2E_TOKEN is not configured');process.exit(2);}
const browser=await chromium.launch({headless:true});
try{
 for(const viewport of (live?[{width:1440,height:1000}]:[{width:390,height:844},{width:1440,height:1000}])){
  const label=viewport.width<700?'mobile':'desktop',page=await browser.newPage({viewport}),files=new Map();let writes=0,conflict=false,journey=null;
  const result={label,viewport,checks:[],journeys:[],forms:[],screens:[],consoleErrors:[],pageErrors:[]};report.viewports.push(result);
  page.on('pageerror',e=>result.pageErrors.push(e.message));page.on('dialog',d=>d.accept());
  page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});
  if(!live)await page.route('https://api.github.com/**',async route=>{
   const req=route.request(),u=new URL(req.url()),path=u.pathname.split('/contents/')[1];let body={},status=200;
   if(u.pathname==='/user')body={login:'e2e-operator',type:'User'};
   else if(u.pathname==='/repos/kj2whvbzjn-hue/tsugu-data')body={private:true,permissions:{push:true}};
   else if(u.pathname.includes('/branches/'))body={name:'main'};
   else if(req.method()==='PUT'){
    const b=req.postDataJSON(),old=files.get(path);assert.equal(b.branch,'main');
    if(conflict||(old&&b.sha!==old.sha)||(!old&&b.sha)){status=409;body={message:'Conflict'};}else{writes++;files.set(path,{content:b.content,sha:'blob-'+writes});body={content:{sha:'blob-'+writes},commit:{sha:writes.toString(16).padStart(40,'0')}};}
   }else if(path==='data/workflow-projects')body=[...files.keys()].map(path=>({type:'file',name:path.split('/').at(-1),path}));
   else if(path?.startsWith('data/workflow-projects/')){body=files.get(path);if(!body){status=404;body={message:'Not Found'};}}
   else throw Error('Unexpected API '+u.pathname);
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  function begin(name){journey={name,clicks:0,tab_transitions:0,dialog_transitions:0,page_scrolls:0,dialog_scrolls:0,scroll_up:0,scroll_down:0,vertical_px:0,horizontal_px:0,trace:[]};}
  function end(){result.journeys.push(journey);journey=null;}
  async function reveal(locator){
   for(let i=0;i<160;i++){
    const v=await locator.evaluate(el=>{const r=el.getBoundingClientRect(),d=el.closest('.dialog');let top=0,bottom=innerHeight;if(d){const b=d.getBoundingClientRect();top=b.top+(el.closest('.dialog-head')?0:65);bottom=b.bottom-12;}return {top:r.top,bottom:r.bottom,x:r.x,y:r.y,width:r.width,height:r.height,upper:top+8,lower:bottom-8,modal:!!d};});
    if(v.bottom>=v.upper&&v.top<=v.lower&&v.top>=v.upper-1&&Math.min(v.height,44)+v.top<=v.lower){break;}
    const needed=(v.top+Math.min(v.height,44)/2)-(v.upper+v.lower)/2;
    const delta=Math.sign(needed)*Math.min(Math.floor(viewport.height*.7),Math.ceil(Math.abs(needed)));
    const before=await page.evaluate(()=>({y:scrollY,m:document.querySelector('.dialog')?.scrollTop||0}));
    await page.mouse.move(v.modal?viewport.width/2:viewport.width-8,v.modal?viewport.height*.6:viewport.height*.8);await page.mouse.wheel(0,delta);await page.waitForTimeout(70);
    const after=await page.evaluate(()=>({y:scrollY,m:document.querySelector('.dialog')?.scrollTop||0}));const moved=after.y-before.y+after.m-before.m;
    if(journey){journey[v.modal?'dialog_scrolls':'page_scrolls']++;journey[delta<0?'scroll_up':'scroll_down']++;journey.vertical_px+=Math.abs(moved);}
    if(!moved)break;
   }
  }
  async function click(locator,name,kind='click'){
   await reveal(locator);const before=await page.evaluate(()=>({y:scrollY,m:document.querySelector('.dialog')?.scrollTop||0,x:document.querySelector('.tabs')?.scrollLeft||0}));
   await locator.click();
   await page.waitForFunction(()=>!document.querySelector('main[aria-busy="true"]')&&[...document.querySelectorAll('button')].some(b=>!b.disabled));
   if(journey){journey.clicks++;if(kind==='tab')journey.tab_transitions++;if(kind==='dialog')journey.dialog_transitions++;journey.trace.push(name);const after=await page.evaluate(()=>({x:document.querySelector('.tabs')?.scrollLeft||0}));journey.horizontal_px+=Math.abs(after.x-before.x);}
  }
  const button=name=>page.getByRole('button',{name,exact:true});
  const tab=name=>click(page.getByRole('tab',{name,exact:true}),name,'tab');
  const close=()=>click(button('閉じる'),'閉じる','dialog');
  async function screen(name){const path=`${root}/${label}-${name}.png`;await page.screenshot({path,fullPage:false});result.screens.push(path);if(label==='mobile'&&['task-z02','spec-longest'].includes(name)){const jpeg=await page.screenshot({type:'jpeg',quality:40});console.log('TSUGU_SCREENSHOT='+name+':'+jpeg.toString('base64'));}}
  async function form(name){
   const fields=await page.locator('.dialog input,.dialog textarea,.dialog select').evaluateAll(els=>els.map(e=>({name:e.name,tag:e.tagName,type:e.type,chars:e.value.length,width:Math.round(e.getBoundingClientRect().width),height:Math.round(e.getBoundingClientRect().height),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,fontSize:getComputedStyle(e).fontSize,visibleLines:e.tagName==='TEXTAREA'?Math.round(e.clientHeight/parseFloat(getComputedStyle(e).lineHeight)):null})));
   result.forms.push({name,fields,dialog:await page.locator('.dialog').evaluate(e=>({height:e.clientHeight,contentHeight:e.scrollHeight,scrollTop:e.scrollTop})),focus:await page.evaluate(()=>({tag:document.activeElement.tagName,name:document.activeElement.getAttribute('name')}))});await screen(name);
  }
  async function connect(){const details=page.locator('.connection');if(await details.getAttribute('open')===null)await details.locator('summary').click();if(live){await page.locator('[name=owner]').fill(process.env.TSUGU_E2E_OWNER||'kj2whvbzjn-hue');await page.locator('[name=repo]').fill(process.env.TSUGU_E2E_REPO||'tsugu-data');await page.locator('[name=branch]').fill(process.env.TSUGU_E2E_BRANCH||'main');}await page.locator('[name=token]').fill(live?process.env.TSUGU_E2E_TOKEN:'e2e-fixture-token');await button('接続').click();await page.getByRole('status').filter({hasText:'として接続'}).waitFor();}
  async function openTask(id){await click(page.locator(`[data-action=edit][data-collection=tasks][data-id="${id}"]`).first(),id,'dialog');}
  async function addCheck(values){await tab('工程・確認');await click(page.locator('[data-action=add][data-collection=checks]'),'確認追加','dialog');for(const [k,v]of Object.entries(values)){const e=page.locator(`#record-editor [name=${k}]`);if(await e.evaluate(x=>x.tagName)==='SELECT')await e.selectOption(v);else await e.fill(v);}await click(button('変更を反映'),'変更を反映','dialog');await page.locator('.dialog').waitFor({state:'hidden'});}
  try{
   await page.goto('http://127.0.0.1:4173/');await connect();begin('一覧からJSON登録・保存');await click(button('JSON一括取り込み'),'JSON一括取り込み','dialog');
   if(live){const copy=structuredClone(source);copy.projects[0].name=`[E2E ${process.env.GITHUB_RUN_ID}] ${fixture.name}`;await page.locator('#import-editor textarea').fill(JSON.stringify(copy));}else await page.locator('#import-file').setInputFiles(fixturePath);
   await click(button('取り込み内容を確認'),'取り込み内容を確認','dialog');await button('1案件をGitHubへ登録').waitFor();await screen('import-preview');await click(button('1案件をGitHubへ登録'),'GitHubへ登録');await page.getByRole('status').filter({hasText:'1案件をGitHubへ登録しました'}).waitFor();end();
   const dl=page.waitForEvent('download');await button('登録結果JSONを保存').click();await (await dl).saveAs(`${root}/${label}-receipt.json`);
   await close();await page.locator('[data-action=open]').filter({hasText:fixture.name}).click();await page.getByRole('heading',{name:live?`[E2E ${process.env.GITHUB_RUN_ID}] ${fixture.name}`:fixture.name,exact:true}).waitFor();
   result.checks.push('UI import, canonical save, open');if(live){report.real_save='PASS_REGISTERED';await page.reload();await connect();await page.locator('[data-action=open]').filter({hasText:`[E2E ${process.env.GITHUB_RUN_ID}]`}).click();await tab('Task');assert.equal(await page.locator('[data-action=edit][data-collection=tasks]').count(),89);result.checks.push('Real GitHub reload retains 89 tasks');await screen('live-reload');continue;}
   assert.equal(writes,1);const saved=JSON.parse(Buffer.from([...files.values()][0].content,'base64').toString());assert.equal(saved.tasks.length,89);assert.equal(saved.specifications.length,34);assert.equal(saved.work_boxes.length,37);for(const collection of ['tasks','specifications','work_boxes','checks'])for(const original of fixture[collection]){const row=saved[collection].find(r=>r.id===original.id);for(const [k,v]of Object.entries(original))assert.deepEqual(row[k],v,collection+'.'+original.id+'.'+k);}result.checks.push('All input fields, 345 dependencies and 68 specification links survive save unchanged');
   const state=()=>JSON.parse(Buffer.from([...files.values()][0].content,'base64').toString());
   await screen('overview');begin('概要から末尾Task Z02の依存を確認');await tab('Task');await openTask('TASK-NIP-Z02');await form('task-z02');const deps=await page.locator('[name=depends_on]').inputValue();assert.equal(deps.split(',').length,35);end();
   begin('Z02から依存先34-02へ移動');await close();await openTask('TASK-NIP-34-02');await form('task-34-02');end();
   begin('Task34-02から仕様GS-34へ移動');assert.equal(await page.locator('[name=specification_ids]').inputValue(),'GS-34');await close();await tab('議論・仕様');await click(page.locator('[data-action=edit][data-collection=specifications][data-id="GS-34"]'),'GS-34','dialog');await form('spec-34');end();
   begin('仕様GS-34からTask34-02へ戻る');await close();await tab('Task');await openTask('TASK-NIP-34-02');end();await close();
   begin('Taskから対応する確認事項へ移動');await tab('工程・確認');await click(page.locator('[data-action=edit][data-collection=checks][data-id="CHECK-NIP-34"]'),'CHECK-NIP-34','dialog');await form('check-34');end();await close();
   begin('構成から末尾WorkBoxとTaskを探す');await tab('構成');await openTask('TASK-NIP-34-02');end();await close();
   await tab('議論・仕様');await click(page.locator('[data-action=edit][data-collection=specifications][data-id="GS-16"]'),'GS-16','dialog');await form('spec-longest');await close();
   await tab('工程・確認');await click(button('実装準備へ'),'実装準備へ');assert.equal(await button('実装開始を承認').isDisabled(),true);result.checks.push('Original plan contains no Implementation checks: start approval blocked');
   await addCheck({title:'E2E ONLY: 開始確認',gate:'Implementation',status:'Passed',result:'画面試験用。ゲーム実装の承認ではない',evidence:'Actions isolated fixture'});await click(button('実装開始を承認'),'実装開始を承認');
   await tab('Task');const card=id=>page.locator('article.card').filter({has:page.locator(`[data-id="${id}"][data-action=edit]`)});assert.equal(await card('TASK-NIP-F02').getByRole('button',{name:'開始',exact:true}).isDisabled(),true);assert.equal(await card('TASK-NIP-F01').getByRole('button',{name:'開始',exact:true}).isEnabled(),true);await click(card('TASK-NIP-F01').getByRole('button',{name:'開始',exact:true}),'F01開始');
   await click(card('TASK-NIP-F01').getByRole('button',{name:'完了',exact:true}),'F01完了を試す');await page.getByRole('alert').first().waitFor();result.checks.push('Dependency blocks F02; F01 starts; completion without Task Completion check is rejected');
   await addCheck({title:'E2E ONLY: F01完了確認',gate:'Completion',target_type:'Task',target_id:'TASK-NIP-F01',status:'Passed',result:'UI試験用',evidence:'fixture, actual task work not performed'});await tab('Task');await click(card('TASK-NIP-F01').getByRole('button',{name:'完了',exact:true}),'F01完了');assert.equal(await card('TASK-NIP-F02').getByRole('button',{name:'開始',exact:true}).isEnabled(),true);result.checks.push('Completing F01 enables F02');
   await openTask('TASK-NIP-F02');await page.locator('[name=requires_human_approval]').check();await click(button('変更を反映'),'承認要件変更');await tab('工程・確認');assert.equal(await button('実装開始を承認').isVisible(),true);await click(button('実装開始を承認'),'再承認');await tab('Task');assert.equal(await card('TASK-NIP-F02').getByRole('button',{name:'開始',exact:true}).isDisabled(),true);await click(card('TASK-NIP-F02').getByRole('button',{name:'Taskを承認',exact:true}),'F02承認');await click(card('TASK-NIP-F02').getByRole('button',{name:'開始',exact:true}),'F02開始');result.checks.push('Plan edit invalidates start approval; required Task approval gates execution');
   await addCheck({title:'E2E ONLY: F02確認',gate:'Completion',target_type:'Task',target_id:'TASK-NIP-F02',status:'Passed',result:'試験',evidence:'fixture'});await tab('Task');await click(card('TASK-NIP-F02').getByRole('button',{name:'完了',exact:true}),'F02完了を試す');await page.getByRole('alert').first().filter({hasText:'実装記録'}).waitFor();result.checks.push('SOURCE_UPDATE completion blocked without Applied implementation record');
   await click(button('GitHubへ保存'),'変更を保存');await page.getByRole('status').filter({hasText:'GitHubへ保存しました'}).waitFor();assert.equal(state().tasks.find(t=>t.id==='TASK-NIP-F01').status,'Done');assert.equal(state().tasks.find(t=>t.id==='TASK-NIP-F02').status,'Doing');
   await page.reload();await connect();await page.locator('[data-action=open]').click();await tab('Task');assert.equal(await page.locator('[data-action=edit][data-collection=tasks]').count(),89);await card('TASK-NIP-F02').getByText('Doing',{exact:true}).waitFor();result.checks.push('Reload preserves changes, 89 tasks, and 34 specs');
   await openTask('TASK-NIP-F02');await page.locator('[name=acceptance_criteria]').fill('E2E revision conflict probe');await click(button('変更を反映'),'競合用変更');const before=writes;conflict=true;await click(button('GitHubへ保存'),'競合保存');await page.getByRole('alert').first().waitFor();assert.equal(writes,before);result.checks.push('409 conflict rejects save and retains canonical revision');
   result.layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,viewportHeight:innerHeight}));result.writes=writes;assert.deepEqual(result.pageErrors,[]);result.status='PASS';
  }catch(e){result.status='FAIL';result.error=e.stack;report.failures.push({label,error:e.message});await screen('failure');}
  finally{if(journey)end();await page.close();}
 }
}finally{await browser.close();report.status=report.failures.length?'FAIL':'PASS';await fs.writeFile(`${root}/result.json`,JSON.stringify(report,null,2));console.log('TSUGU_E2E_RESULT='+JSON.stringify(report));}
if(report.failures.length)process.exit(1);
