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
page.on('console', msg => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => pageErrors.push(String(err)));

async function screenshot(name) {
  const safe = name.replace(/[^a-z0-9._-]+/gi, '-');
  await page.screenshot({ path: path.join(outputDir, `${safe}.png`), fullPage: true });
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
    case 'wait':
      await page.waitForTimeout(step.ms || 1000);
      break;
    case 'screenshot':
      await screenshot(step.name || label);
      break;
    case 'assertText': {
      const locator = page.getByText(step.text, { exact: step.exact ?? false });
      if (await locator.count() === 0) throw new Error(`Text not found: ${step.text}`);
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
  for (let i = 0; i < task.steps.length; i++) {
    await runStep(task.steps[i], i);
  }
  await screenshot('final');
} catch (err) {
  ok = false;
  failure = err?.stack || String(err);
  console.error(failure);
  try { await screenshot('failure'); } catch {}
} finally {
  await fs.writeFile(path.join(outputDir, 'console.log'), consoleMessages.join('\n'));
  await fs.writeFile(path.join(outputDir, 'page-errors.log'), pageErrors.join('\n'));
  await fs.writeFile(path.join(outputDir, 'result.json'), JSON.stringify({ ok, failure, finalUrl: page.url() }, null, 2));
  await browser.close();
}

if (!ok) process.exit(1);
