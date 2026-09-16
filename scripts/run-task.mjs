import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const requestedTaskPath = process.argv[2] || 'tasks/task.json';
const repoRoot = process.cwd();

async function loadTaskDefinition(requestedPath) {
  const requestedRaw = await fs.readFile(requestedPath, 'utf8');
  const requested = JSON.parse(requestedRaw);
  if (requested && typeof requested.taskFile === 'string' && requested.taskFile.trim()) {
    const taskPath = requested.taskFile.trim();
    const taskRaw = await fs.readFile(taskPath, 'utf8');
    return { task: JSON.parse(taskRaw), taskPath, selectionPath: requestedPath, selection: requested };
  }
  return { task: requested, taskPath: requestedPath, selectionPath: null, selection: null };
}

const { task, taskPath, selectionPath, selection } = await loadTaskDefinition(requestedTaskPath);
const outputDir = path.resolve(task.outputDir || 'artifacts');
await fs.mkdir(outputDir, { recursive: true });
const headless = process.env.BROWSER_HEADLESS !== 'false';
console.log(`BROWSER headless=${headless}`);
const browser = await chromium.launch({ headless });
const context = await browser.newContext({ viewport: task.viewport || { width: 1440, height: 900 }, userAgent: task.userAgent || undefined });

const patchMessages = [];
for (const patch of Array.isArray(task.responsePatches) ? task.responsePatches : []) {
  if (!patch?.url || typeof patch.search !== 'string' || typeof patch.replace !== 'string') throw new Error('responsePatches requires url/search/replace strings');
  await context.route(patch.url, async route => {
    const response = await route.fetch(); const original = await response.text();
    const count = original.split(patch.search).length - 1;
    if (count !== (patch.expectedCount ?? 1)) throw new Error(`Response patch ${patch.label || patch.url}: expected ${patch.expectedCount ?? 1} match(es), found ${count}`);
    patchMessages.push(`${patch.label || patch.url}: applied ${count} replacement(s)`);
    await route.fulfill({ response, body: original.replace(patch.search, patch.replace) });
  });
}

const page = await context.newPage();
const consoleMessages = [], pageErrors = [], dialogMessages = [];
page.on('console', msg => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => pageErrors.push(String(err)));
page.on('dialog', async dialog => { const policy = task.dialogPolicy || 'dismiss'; dialogMessages.push(`[${dialog.type()}] ${dialog.message()} -> ${policy}`); if (policy === 'accept') await dialog.accept(task.dialogPromptText || ''); else await dialog.dismiss(); });

function safeName(name) { return String(name).replace(/[^a-z0-9._-]+/gi, '-'); }
function resolveUploadFiles(step) { const configured = step.files ?? step.file; const files = Array.isArray(configured) ? configured : [configured]; if (!files.length || files.some(file => typeof file !== 'string' || !file.trim())) throw new Error(`${step.action} requires file or files`); return files.map(file => { const resolved = path.resolve(repoRoot, file); const relative = path.relative(repoRoot, resolved); if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Upload file must stay inside repository workspace: ${file}`); return resolved; }); }
async function screenshot(name) { await page.screenshot({ path: path.join(outputDir, `${safeName(name)}.png`), fullPage: true }); }
async function dumpPage(name = 'page-state') { const data = await page.evaluate(() => { const text = document.body?.innerText || ''; const controls = [...document.querySelectorAll('button, input, select, textarea, a, [role]')].map((el,index) => { const r=el.getBoundingClientRect(), cs=getComputedStyle(el); return { index, tag:el.tagName.toLowerCase(), type:el.getAttribute('type'), role:el.getAttribute('role'), text:(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,500), ariaLabel:el.getAttribute('aria-label'), name:el.getAttribute('name'), value:'value' in el?String(el.value??''):null, checked:'checked' in el?Boolean(el.checked):null, disabled:'disabled' in el?Boolean(el.disabled):null, href:el.getAttribute('href'), id:el.id||null, className:typeof el.className==='string'?el.className:null, visible:r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none', x:Math.round(r.x), y:Math.round(r.y), width:Math.round(r.width), height:Math.round(r.height) }; }); return { title:document.title, url:location.href, bodyText:text, controls }; }); await fs.writeFile(path.join(outputDir, `${safeName(name)}.json`), JSON.stringify(data,null,2)); }
async function dumpStorage(name='storage-state') { const data=await page.evaluate(() => { function read(store){const out={};for(let i=0;i<store.length;i++){const key=store.key(i);if(key==null)continue;const raw=store.getItem(key);let parsed=null;try{parsed=JSON.parse(raw)}catch{}out[key]={raw:raw==null?null:raw.slice(0,250000),json:parsed};}return out;} return {url:location.href,capturedAt:new Date().toISOString(),localStorage:read(localStorage),sessionStorage:read(sessionStorage)}; }); await fs.writeFile(path.join(outputDir,`${safeName(name)}.json`),JSON.stringify(data,null,2)); }
async function locatorForSelector(step){if(!step.selector)throw new Error(`${step.action} requires selector`);return page.locator(step.selector).first();}
async function assertLocatorValue(locator,step){const expected=String(step.value??'');const actual=await locator.inputValue({timeout:step.timeout||10000});const matches=step.exact===false?actual.includes(expected):actual===expected;if(!matches)throw new Error(`Value mismatch: expected ${step.exact===false?'to include ':''}${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);}

async function humanPause(step) {
  const ms = Number(step.timeoutMs ?? step.ms ?? 600000);
  if (!Number.isFinite(ms) || ms < 1000) throw new Error('humanPause timeout must be at least 1000 ms');
  const deadline = Date.now() + ms;
  console.log(`HUMAN CONTROL WINDOW OPEN for up to ${Math.round(ms/1000)} seconds.`);
  console.log('Tap the green "操作完了 / RESUME" button in the browser to resume Playwright immediately.');
  while (Date.now() < deadline) {
    try {
      const done = await page.evaluate(() => {
        if (window.__browserAgentHumanDone) return true;
        let button = document.getElementById('__browser_agent_resume__');
        if (!button) {
          button = document.createElement('button');
          button.id = '__browser_agent_resume__';
          button.textContent = '操作完了 / RESUME';
          Object.assign(button.style, { position:'fixed', top:'12px', right:'12px', zIndex:'2147483647', padding:'14px 18px', fontSize:'18px', fontWeight:'700', background:'#16a34a', color:'white', border:'2px solid white', borderRadius:'10px', boxShadow:'0 2px 10px rgba(0,0,0,.35)', cursor:'pointer' });
          button.addEventListener('click', () => { window.__browserAgentHumanDone = true; button.textContent = '再開します…'; button.disabled = true; });
          (document.body || document.documentElement).appendChild(button);
        }
        return false;
      });
      if (done) { console.log('HUMAN CONTROL COMPLETE button received; Playwright resuming.'); return; }
    } catch {}
    await page.waitForTimeout(500);
  }
  console.log('HUMAN CONTROL WINDOW timed out; Playwright resuming.');
}

async function runStep(step,index){
  const label=step.label||`${index+1}-${step.action}`; console.log(`STEP ${index+1}: ${label}`);
  switch(step.action){
    case 'goto': await page.goto(step.url,{waitUntil:step.waitUntil||'domcontentloaded',timeout:step.timeout||30000}); break;
    case 'clickRole': await page.getByRole(step.role,{name:step.name,exact:step.exact??true}).click({timeout:step.timeout||10000}); break;
    case 'clickText': await page.getByText(step.text,{exact:step.exact??true}).click({timeout:step.timeout||10000}); break;
    case 'clickSelector': await (await locatorForSelector(step)).click({timeout:step.timeout||10000}); break;
    case 'checkSelector': await (await locatorForSelector(step)).check({timeout:step.timeout||10000}); break;
    case 'fillSelector': await (await locatorForSelector(step)).fill(step.value??'',{timeout:step.timeout||10000}); break;
    case 'selectSelector': await (await locatorForSelector(step)).selectOption(step.value,{timeout:step.timeout||10000}); break;
    case 'uploadSelector': await (await locatorForSelector(step)).setInputFiles(resolveUploadFiles(step),{timeout:step.timeout||10000}); break;
    case 'fillLabel': await page.getByLabel(step.labelText,{exact:step.exact??true}).fill(step.value??''); break;
    case 'checkLabel': await page.getByLabel(step.labelText,{exact:step.exact??true}).check(); break;
    case 'selectLabel': await page.getByLabel(step.labelText,{exact:step.exact??true}).selectOption(step.value); break;
    case 'uploadLabel': await page.getByLabel(step.labelText,{exact:step.exact??true}).setInputFiles(resolveUploadFiles(step),{timeout:step.timeout||10000}); break;
    case 'waitForText': await page.getByText(step.text,{exact:step.exact??false}).waitFor({state:'visible',timeout:step.timeout||15000}); break;
    case 'waitForSelector': await (await locatorForSelector(step)).waitFor({state:step.state||'visible',timeout:step.timeout||15000}); break;
    case 'wait': await page.waitForTimeout(step.ms||1000); break;
    case 'humanPause': await humanPause(step); break;
    case 'screenshot': await screenshot(step.name||label); break;
    case 'dumpPage': await dumpPage(step.name||label); break;
    case 'dumpStorage': await dumpStorage(step.name||label); break;
    case 'assertText': {const locator=page.getByText(step.text,{exact:step.exact??false});if(await locator.count()===0)throw new Error(`Text not found: ${step.text}`);break;}
    case 'assertSelector': {const locator=await locatorForSelector(step);if(await locator.count()===0)throw new Error(`Selector not found: ${step.selector}`);break;}
    case 'assertValueSelector': await assertLocatorValue(await locatorForSelector(step),step); break;
    case 'assertValueLabel': await assertLocatorValue(page.getByLabel(step.labelText,{exact:step.labelExact??true}),step); break;
    case 'assertUrl': {const expected=String(step.url??''),actual=page.url(),matches=step.exact===false?actual.includes(expected):actual===expected;if(!matches)throw new Error(`URL mismatch: expected ${step.exact===false?'to include ':''}${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);break;}
    default: throw new Error(`Unknown action: ${step.action}`);
  }
  if(step.screenshotAfter)await screenshot(`${index+1}-${label}`);
}

let ok=true,failure=null;
try { console.log(`TASK ${taskPath}${selectionPath?` (selected by ${selectionPath})`:''}`); for(let i=0;i<task.steps.length;i++)await runStep(task.steps[i],i); await screenshot('final'); }
catch(err){ok=false;failure=err?.stack||String(err);console.error(failure);try{await dumpPage('failure-page')}catch{}try{await dumpStorage('failure-storage')}catch{}try{await screenshot('failure')}catch{}}
finally { await fs.writeFile(path.join(outputDir,'console.log'),consoleMessages.join('\n')); await fs.writeFile(path.join(outputDir,'page-errors.log'),pageErrors.join('\n')); await fs.writeFile(path.join(outputDir,'dialogs.log'),dialogMessages.join('\n')); await fs.writeFile(path.join(outputDir,'patches.log'),patchMessages.join('\n')); await fs.writeFile(path.join(outputDir,'result.json'),JSON.stringify({ok,failure,finalUrl:page.url(),taskPath,selectionPath,project:selection?.project||null,label:selection?.label||null,runRequest:selection?.runRequest??null},null,2)); await browser.close(); }
if(!ok)process.exit(1);
