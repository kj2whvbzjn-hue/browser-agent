import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const outputDir = path.resolve('artifacts-b914');
await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleMessages = [];
const pageErrors = [];
page.on('console', msg => consoleMessages.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => pageErrors.push(String(err)));

function assert(condition, message, details = null) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

let result = null;
let ok = false;
let failure = null;
try {
  await page.goto('https://kj2whvbzjn-hue.github.io/guild-adventure-studio/game/', { waitUntil: 'networkidle', timeout: 60000 });
  const title = await page.title();
  const body = await page.locator('body').innerText();
  assert(body.includes('GA-B486.262') || title.includes('GA-B486.262'), 'Public build is not GA-B486.262', { title });

  result = await page.evaluate(() => {
    const r = globalThis.GKSFormationTargetResolver;
    if (!r) throw new Error('GKSFormationTargetResolver is not loaded');
    const backline = { id: 'A', side: 'ALLY', alive: true, formationPosition: 'BACKLINE' };
    const frontline = { id: 'F', side: 'ENEMY', alive: true, formationPosition: 'FRONTLINE' };
    const enemyBack = { id: 'B', side: 'ENEMY', alive: true, formationPosition: 'BACKLINE' };
    const randomPool = [frontline, enemyBack];
    const randomDefault = r.sampleTargetsWithReplacement(randomPool, undefined, () => 0);
    const forcedUnits = [
      { id: 'L1', side: 'ALLY', alive: true, formationPosition: 'BACKLINE' },
      { id: 'L2', side: 'ALLY', alive: true, formationPosition: 'BACKLINE' },
      { id: 'LD', side: 'ALLY', alive: false, formationPosition: 'BACKLINE' },
      { id: 'E1', side: 'ENEMY', alive: true, formationPosition: 'FRONTLINE' }
    ];
    const forcedChanged = r.applyForcedAdvance(forcedUnits, 'ALLY');
    const allyRangeUnits = [
      { id: 'SELF', side: 'ALLY', alive: true, formationPosition: 'BACKLINE' },
      { id: 'ALLY2', side: 'ALLY', alive: true, formationPosition: 'FRONTLINE' },
      { id: 'ENEMY1', side: 'ENEMY', alive: true, formationPosition: 'FRONTLINE' }
    ];
    const allyTargets = r.resolveLegalTargetCandidates({
      actor: allyRangeUnits[0],
      units: allyRangeUnits,
      targetContract: { side: 'ALLY', range: 'FRONT' }
    }).map(x => x.id);
    return {
      defaultRandomCount: r.DEFAULT_RANDOM_TARGET_COUNT,
      singleMultiplier: r.attackerDamageMultiplier(backline, 'SINGLE'),
      frontMultiplier: r.attackerDamageMultiplier(backline, 'FRONT'),
      randomMultiplier: r.attackerDamageMultiplier(backline, 'RANDOM'),
      backMultiplier: r.attackerDamageMultiplier(backline, 'BACK'),
      allMultiplier: r.attackerDamageMultiplier(backline, 'ALL'),
      randomDefaultIds: randomDefault.map(x => x.id),
      cover: {
        SINGLE: r.coverEligibleRange('SINGLE'),
        BACK: r.coverEligibleRange('BACK'),
        RANDOM: r.coverEligibleRange('RANDOM'),
        FRONT: r.coverEligibleRange('FRONT'),
        ALL: r.coverEligibleRange('ALL')
      },
      forcedChanged,
      forcedUnits: forcedUnits.map(x => ({ id: x.id, alive: x.alive, position: x.formationPosition })),
      allyTargets
    };
  });

  assert(result.defaultRandomCount === 2, 'RANDOM default count must be 2', result);
  assert(result.singleMultiplier === 0.5, 'BACKLINE SINGLE must be 0.5', result);
  assert(result.frontMultiplier === 0.5, 'BACKLINE FRONT must be 0.5', result);
  assert(result.randomMultiplier === 0.5, 'BACKLINE RANDOM must be 0.5', result);
  assert(result.backMultiplier === 1, 'BACKLINE BACK must be 1.0', result);
  assert(result.allMultiplier === 1, 'BACKLINE ALL must be 1.0', result);
  assert(result.randomDefaultIds.length === 2 && result.randomDefaultIds[0] === 'F' && result.randomDefaultIds[1] === 'F', 'RANDOM must sample twice with replacement', result);
  assert(result.cover.SINGLE && result.cover.BACK && result.cover.RANDOM, 'COVER must apply to SINGLE/BACK/RANDOM', result);
  assert(!result.cover.FRONT && !result.cover.ALL, 'COVER must not apply to FRONT/ALL', result);
  assert(result.forcedChanged === true, 'Forced advance should occur when no living frontline exists', result);
  assert(result.forcedUnits.find(x => x.id === 'L1')?.position === 'FRONTLINE', 'Living backline L1 should advance', result);
  assert(result.forcedUnits.find(x => x.id === 'L2')?.position === 'FRONTLINE', 'Living backline L2 should advance', result);
  assert(result.forcedUnits.find(x => x.id === 'LD')?.position === 'BACKLINE', 'Dead backline must not advance', result);
  assert(result.allyTargets.includes('SELF') && result.allyTargets.includes('ALLY2') && result.allyTargets.length === 2, 'ALLY Heal/Barrier targeting must ignore formation', result);

  ok = true;
  await page.screenshot({ path: path.join(outputDir, 'b914-pass.png'), fullPage: true });
} catch (err) {
  failure = err?.stack || String(err);
  try { await page.screenshot({ path: path.join(outputDir, 'b914-failure.png'), fullPage: true }); } catch {}
} finally {
  await fs.writeFile(path.join(outputDir, 'result.json'), JSON.stringify({ ok, failure, result, url: page.url() }, null, 2));
  await fs.writeFile(path.join(outputDir, 'console.log'), consoleMessages.join('\n'));
  await fs.writeFile(path.join(outputDir, 'page-errors.log'), pageErrors.join('\n'));
  await browser.close();
}

if (!ok) {
  console.error(failure);
  process.exit(1);
}
console.log('B914_E2E_PASS', JSON.stringify(result));
