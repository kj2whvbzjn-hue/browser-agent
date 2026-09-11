import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const TARGET = 'https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/?e2e=b910';
const OUT = path.resolve('artifacts-public-b910');
await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: 'block',
});
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', err => pageErrors.push(String(err)));
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('dialog', async dialog => dialog.accept());

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}
function locator(sel) { return page.locator(sel).first(); }
async function click(sel, timeout = 20000) { await locator(sel).click({ timeout }); }
async function visible(sel, timeout = 20000) { await locator(sel).waitFor({ state: 'visible', timeout }); }
async function assertCount(sel, expected, label) {
  const count = await page.locator(sel).count();
  if (count !== expected) throw new Error(`${label}: expected count=${expected}, actual=${count}, selector=${sel}`);
}
async function assertAtLeast(sel, min, label) {
  const count = await page.locator(sel).count();
  if (count < min) throw new Error(`${label}: expected count>=${min}, actual=${count}, selector=${sel}`);
}
async function assertBodyIncludes(text, label) {
  const body = await page.locator('body').innerText();
  if (!body.includes(text)) throw new Error(`${label}: missing text ${JSON.stringify(text)}`);
}

let result = { ok: false, target: TARGET, checks: [] };
try {
  await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60000 });
  await visible('#phase-title.active', 30000);
  await assertBodyIncludes('GA-B486.241', 'public-build');
  result.checks.push('public build GA-B486.241');

  await click('#titleStart');
  await visible('#phase-base.active', 30000);
  await click('#developerModeBtn');
  await click('#baseMobileNav [data-base-tab="adventurer"]');
  await visible('#roster .adventurer-row:has-text("アルト")');
  await click('#roster .adventurer-row:has-text("アルト")');
  await click('#openSkillPlaceholder');
  await page.getByText('アルトのSkill / Passive', { exact: true }).waitFor({ state: 'visible', timeout: 20000 });

  await click('[data-assign-formal-skill="SKL-0001"]');
  await click('[data-assign-formal-skill="SKL-0002"]');
  await click('[data-select-skill="SKL-0001"]');
  await assertCount('[data-select-skill="SKL-0001"][data-selected="1"]', 1, 'SKL-0001 selected');
  await assertCount('[data-select-skill="SKL-0002"][data-selected="0"]', 1, 'SKL-0002 unselected');

  await click('[data-open-base-view="adventurer"]');
  await click('#openAiEditor');
  await visible('#aiEditor[aria-hidden="false"]', 30000);
  await click('#aiBoard .ai-formal-cell:not(.occupied)');
  await visible('#aiCandidateScreen.open');
  await click('[data-ai-category="action"]');
  await visible('#aiConfigScreen.open');
  await assertAtLeast('[data-ai-action-choice] option[value*="SKL-0001"]', 1, 'selected SKL-0001 must be AI candidate');
  await assertCount('[data-ai-action-choice] option[value*="SKL-0002"]', 0, 'unselected SKL-0002 must not be AI candidate');
  result.checks.push('AI candidate follows selected SKL-0001 only');
  await shot('selected-0001');

  await click('#aiConfigBack');
  await visible('#aiCandidateScreen.open');
  await click('#aiCandidateBack');
  await click('#aiEditorClose');
  await page.locator('#aiEditor').waitFor({ state: 'hidden', timeout: 15000 });

  await click('#openSkillPlaceholder');
  await click('[data-select-skill="SKL-0001"]');
  await click('[data-select-skill="SKL-0002"]');
  await assertCount('[data-select-skill="SKL-0001"][data-selected="0"]', 1, 'SKL-0001 unselected after swap');
  await assertCount('[data-select-skill="SKL-0002"][data-selected="1"]', 1, 'SKL-0002 selected after swap');

  await click('[data-open-base-view="adventurer"]');
  await click('#openAiEditor');
  await visible('#aiEditor[aria-hidden="false"]', 30000);
  await click('#aiBoard .ai-formal-cell:not(.occupied)');
  await visible('#aiCandidateScreen.open');
  await click('[data-ai-category="action"]');
  await visible('#aiConfigScreen.open');
  await assertAtLeast('[data-ai-action-choice] option[value*="SKL-0002"]', 1, 'selected SKL-0002 must be AI candidate');
  await assertCount('[data-ai-action-choice] option[value*="SKL-0001"]', 0, 'unselected SKL-0001 must not be AI candidate');
  result.checks.push('AI candidate follows selected SKL-0002 only after swap');
  await shot('selected-0002');

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  result.checks.push('page errors = 0');
  result.ok = true;
} catch (error) {
  result.error = error?.stack || String(error);
  try { await shot('failure'); } catch {}
} finally {
  result.pageErrors = pageErrors;
  result.consoleErrors = consoleErrors;
  result.finalUrl = page.url();
  await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
