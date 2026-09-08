import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const taskPath = process.argv[2] || 'tasks/task.json';
const raw = await fs.readFile(taskPath, 'utf8');
const task = JSON.parse(raw);

const outputDir = path.resolve(task.outputDir || 'artifacts');
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: task.viewport || { width: 1440, height: 900 },
  userAgent: task.userAgent || undefined,
});
const page = await context.newPage();

const consoleMessages = [];
const pageErrors = [];
const dialogMessages = [];
page.on('console', msg => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => pageErrors.push(String(err)));
page.on('dialog', async dialog => {
  const policy = task.dialogPolicy || 'dismiss';
  dialogMessages.push(`[${dialog.type()}] ${dialog.message()} -> ${policy}`);
  if (policy === 'accept') await dialog.accept(task.dialogPromptText || '');
  else await dialog.dismiss();
});

async function screenshot(name) {
  const safe = name.replace(/[^a-z0-9._-]+/gi, '-');
  await page.screenshot({ path: path.join(outputDir, `${safe}.png`), fullPage: true });
}

async function dumpPage(name = 'page-state') {
  const safe = name.replace(/[^a-z0-9._-]+/gi, '-');
  const data = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const controls = [...document.querySelectorAll('button, input, select, textarea, a, [role]')].map((el, index) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        index,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type'),
        role: el.getAttribute('role'),
        text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 500),
        ariaLabel: el.getAttribute('aria-label'),
        name: el.getAttribute('name'),
        value: 'value' in el ? String(el.value ?? '') : null,
        checked: 'checked' in el ? Boolean(el.checked) : null,
        disabled: 'disabled' in el ? Boolean(el.disabled) : null,
        href: el.getAttribute('href'),
        id: el.id || null,
        className: typeof el.className === 'string' ? el.className : null,
        visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
        x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)
      };
    });
    return { title: document.title, url: location.href, bodyText: text, controls };
  });
  await fs.writeFile(path.join(outputDir, `${safe}.json`), JSON.stringify(data, null, 2));
}

async function locatorForSelector(step) {
  if (!step.selector) throw new Error(`${step.action} requires selector`);
  return page.locator(step.selector).first();
}

async function runStep(step, index) {
  const label = step.label || `${index + 1}-${step.action}`;
  console.log(`STEP ${index + 1}: ${label}`);

  switch (step.action) {
    case 'goto':
      await page.goto(step.url, { waitUntil: step.waitUntil || 'domcontentloaded', timeout: step.timeout || 30000 });
      break;
    case 'clickRole':
      await page.getByRole(step.role, { name: step.name, exact: step.exact ?? true }).click({ timeout: step.timeout || 10000 });
      break;
    case 'clickText':
      await page.getByText(step.text, { exact: step.exact ?? true }).click({ timeout: step.timeout || 10000 });
      break;
    case 'clickSelector':
      await (await locatorForSelector(step)).click({ timeout: step.timeout || 10000 });
      break;
    case 'checkSelector':
      await (await locatorForSelector(step)).check({ timeout: step.timeout || 10000 });
      break;
    case 'fillSelector':
      await (await locatorForSelector(step)).fill(step.value ?? '', { timeout: step.timeout || 10000 });
      break;
    case 'selectSelector':
      await (await locatorForSelector(step)).selectOption(step.value, { timeout: step.timeout || 10000 });
      break;
    case 'fillLabel':
      await page.getByLabel(step.labelText, { exact: step.exact ?? true }).fill(step.value ?? '');
      break;
    case 'checkLabel':
      await page.getByLabel(step.labelText, { exact: step.exact ?? true }).check();
      break;
    case 'selectLabel':
      await page.getByLabel(step.labelText, { exact: step.exact ?? true }).selectOption(step.value);
      break;
    case 'waitForText':
      await page.getByText(step.text, { exact: step.exact ?? false }).waitFor({ state: 'visible', timeout: step.timeout || 15000 });
      break;
    case 'waitForSelector':
      await (await locatorForSelector(step)).waitFor({ state: step.state || 'visible', timeout: step.timeout || 15000 });
      break;
    case 'wait':
      await page.waitForTimeout(step.ms || 1000);
      break;
    case 'screenshot':
      await screenshot(step.name || label);
      break;
    case 'dumpPage':
      await dumpPage(step.name || label);
      break;
    case 'assertText': {
      const locator = page.getByText(step.text, { exact: step.exact ?? false });
      if (await locator.count() === 0) throw new Error(`Text not found: ${step.text}`);
      break;
    }
    case 'assertSelector': {
      const locator = await locatorForSelector(step);
      if (await locator.count() === 0) throw new Error(`Selector not found: ${step.selector}`);
      break;
    }
    default:
      throw new Error(`Unknown action: ${step.action}`);
  }

  if (step.screenshotAfter) await screenshot(`${index + 1}-${label}`);
}

let ok = true;
let failure = null;
try {
  for (let i = 0; i < task.steps.length; i++) await runStep(task.steps[i], i);
  await screenshot('final');
} catch (err) {
  ok = false;
  failure = err?.stack || String(err);
  console.error(failure);
  try { await screenshot('failure'); } catch {}
} finally {
  await fs.writeFile(path.join(outputDir, 'console.log'), consoleMessages.join('\n'));
  await fs.writeFile(path.join(outputDir, 'page-errors.log'), pageErrors.join('\n'));
  await fs.writeFile(path.join(outputDir, 'dialogs.log'), dialogMessages.join('\n'));
  await fs.writeFile(path.join(outputDir, 'result.json'), JSON.stringify({ ok, failure, finalUrl: page.url() }, null, 2));
  await browser.close();
}

if (!ok) process.exit(1);
