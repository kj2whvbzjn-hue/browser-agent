import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base = process.env.F03_BASE_URL || 'http://127.0.0.1:4173';
const target = `${base}/game/?e2e=f03`;
const artifactDir = 'artifacts';
await fs.mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', error => pageErrors.push(String(error?.stack || error?.message || error)));
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

const fail = message => { throw new Error(message); };
try {
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.GKGameSaveCore && window.GKRuntimeBoundaryContracts && window.GA_PROJECT_CONFIG));

  const builds = await page.evaluate(() => ({
    game: window.GA_PROJECT_CONFIG.gameBuild,
    studio: window.GA_PROJECT_CONFIG.studioBuild,
  }));
  if (builds.game !== 'GA-B486.243' || builds.studio !== 'GKS-B912') {
    fail(`Unexpected build markers: ${JSON.stringify(builds)}`);
  }

  await page.waitForFunction(() => {
    const game = window.GKGameFormalConfig?.bridge?.status;
    const equipment = window.GKGameEquipmentRuntime?.bridge?.status;
    const passive = window.GKGameFormalConfig?.passiveBridge?.status;
    return [game, equipment, passive].every(status => status === 'loaded' || status === 'failed');
  }, null, { timeout: 15000 });
  const formalStatuses = await page.evaluate(() => ({
    game: { status: window.GKGameFormalConfig?.bridge?.status, errors: [...(window.GKGameFormalConfig?.bridge?.errors || [])] },
    equipment: { status: window.GKGameEquipmentRuntime?.bridge?.status, errors: [...(window.GKGameEquipmentRuntime?.bridge?.errors || [])] },
    passive: { status: window.GKGameFormalConfig?.passiveBridge?.status, errors: [...(window.GKGameFormalConfig?.passiveBridge?.errors || [])] },
  }));
  for (const [name, state] of Object.entries(formalStatuses)) {
    if (state.status !== 'loaded') fail(`Formal ${name} load failed: ${JSON.stringify(state)}`);
  }
  const initialized = await page.evaluate(() => {
    const Core = window.GKGameSaveCore;
    const prepared = Core.prepareNewGameSnapshot();
    const committed = Core.commitPreparedNewGame(prepared);
    return { characterCount: committed.characters.length, gold: Number(committed.guild?.gold || 0) };
  });
  if (initialized.characterCount !== 6 || initialized.gold !== 500) {
    fail(`New Game core initialization mismatch: ${JSON.stringify(initialized)}`);
  }

  const result = await page.evaluate(async () => {
    const Core = window.GKGameSaveCore;
    const Boundary = window.GKRuntimeBoundaryContracts;
    const mainKey = Core.slotKey;
    const backupKey = Core.backupKey;
    const tempKey = Core.tempKey;
    const readGold = raw => Number(JSON.parse(raw).guild?.gold || 0);
    const main0 = localStorage.getItem(mainKey);
    if (main0 == null) throw new Error('Current save is missing after New Game.');
    const startGold = readGold(main0);

    const first = Core.transaction('F03_E2E_SERIAL_A', async state => {
      await new Promise(resolve => setTimeout(resolve, 50));
      state.guild.gold = Number(state.guild.gold || 0) + 1;
      return { delta: 1 };
    }, { transactionId: 'F03-E2E-A' });
    const second = Core.transaction('F03_E2E_SERIAL_B', state => {
      state.guild.gold = Number(state.guild.gold || 0) + 2;
      return { delta: 2 };
    }, { transactionId: 'F03-E2E-B' });
    const [a, b] = await Promise.all([first, second]);
    const afterSerialRaw = localStorage.getItem(mainKey);
    const serialGold = readGold(afterSerialRaw);
    if (serialGold !== startGold + 3) throw new Error(`Lost update: expected ${startGold + 3}, got ${serialGold}`);
    if (Number(a.state.guild.gold) !== startGold + 1 || Number(b.state.guild.gold) !== startGold + 3) {
      throw new Error(`Transactions did not execute serially: A=${a.state.guild.gold} B=${b.state.guild.gold}`);
    }
    if (Core.persistentTempPayload !== false) throw new Error('persistentTempPayload must be false.');
    if (localStorage.getItem(tempKey) !== null) throw new Error(`Persistent temp payload exists at ${tempKey}.`);

    let afterCommitObserved = null;
    await Core.transaction('F03_E2E_AFTER_COMMIT', state => {
      state.guild.gold = Number(state.guild.gold || 0) + 4;
      return { delta: 4 };
    }, {
      transactionId: 'F03-E2E-POST',
      afterCommit: ({ state }) => {
        const persisted = JSON.parse(localStorage.getItem(mainKey));
        afterCommitObserved = {
          persistedGold: Number(persisted.guild?.gold || 0),
          committedGold: Number(state.guild?.gold || 0),
        };
        if (afterCommitObserved.persistedGold !== afterCommitObserved.committedGold) {
          throw new Error('afterCommit ran before persistent commit.');
        }
      },
    });
    if (!afterCommitObserved || afterCommitObserved.persistedGold !== startGold + 7) {
      throw new Error(`afterCommit observation mismatch: ${JSON.stringify(afterCommitObserved)}`);
    }

    async function expectWriteFailure(writeIndex, id) {
      const beforeMain = localStorage.getItem(mainKey);
      const beforeBackup = localStorage.getItem(backupKey);
      const metrics = Boundary.createMetrics();
      const probe = Boundary.createPersistenceProbe({ metrics, failOnWriteIndices: [writeIndex] });
      const restore = Boundary.installInstrumentation({ persistenceProbe: probe });
      let failure = null;
      try {
        await Core.transaction(`F03_E2E_FAIL_${writeIndex}`, state => {
          state.guild.gold = Number(state.guild.gold || 0) + 100;
        }, { transactionId: id });
      } catch (error) {
        failure = { code: String(error?.code || ''), message: String(error?.message || error) };
      } finally {
        restore();
      }
      if (!failure) throw new Error(`Injected write ${writeIndex} unexpectedly succeeded.`);
      const afterMain = localStorage.getItem(mainKey);
      const afterBackup = localStorage.getItem(backupKey);
      if (afterMain !== beforeMain || afterBackup !== beforeBackup) {
        throw new Error(`Rollback mismatch after injected write ${writeIndex}.`);
      }
      return { writeIndex, failure, attempts: probe.attempts(), metrics: metrics.snapshot() };
    }

    const backupFailure = await expectWriteFailure(1, 'F03-E2E-FAIL-BACKUP');
    const mainFailure = await expectWriteFailure(2, 'F03-E2E-FAIL-MAIN');

    const continued = await Core.transaction('F03_E2E_QUEUE_CONTINUES', state => {
      state.guild.gold = Number(state.guild.gold || 0) + 5;
      return { delta: 5 };
    }, { transactionId: 'F03-E2E-CONTINUE' });
    const finalRaw = localStorage.getItem(mainKey);
    const finalGold = readGold(finalRaw);
    if (finalGold !== startGold + 12 || Number(continued.state.guild.gold) !== startGold + 12) {
      throw new Error(`Queue did not continue after failure: ${finalGold}`);
    }

    const slotState = Core.inspectSlots();
    if (!slotState || slotState.status !== 'MAIN_VALID' || slotState.normal_key !== mainKey) {
      throw new Error(`Unexpected slot inspection: ${JSON.stringify(slotState)}`);
    }
    const txState = Core.transactionState();
    if (txState.pending !== 0) throw new Error(`Transaction queue still pending: ${txState.pending}`);

    return {
      startGold,
      serialGold,
      afterCommitObserved,
      backupFailure,
      mainFailure,
      finalGold,
      slotStatus: slotState.status,
      persistentTempPayload: Core.persistentTempPayload,
      tempPayloadPresent: localStorage.getItem(tempKey) !== null,
      lastTransactionId: txState.last_transaction?.transaction_id || '',
    };
  });

  await page.screenshot({ path: `${artifactDir}/b912-f03-game.png`, fullPage: true });
  if (pageErrors.length) fail(`Page errors: ${JSON.stringify(pageErrors)}`);
  if (consoleErrors.length) fail(`Console errors: ${JSON.stringify(consoleErrors)}`);

  const output = {
    ok: true,
    target,
    builds,
    formalStatuses,
    initialized,
    checks: [
      'candidate Game build GA-B486.243 / Studio marker GKS-B912',
      'concurrent +1/+2 transactions serialize with no lost update',
      'afterCommit runs only after persistent commit',
      'backup write failure restores exact previous main/backup',
      'main write failure restores exact previous main/backup',
      'queue continues after failed transaction',
      'no third persistent temp payload',
      'slot inspection MAIN_VALID',
      'page errors = 0',
      'console errors = 0',
    ],
    result,
    pageErrors,
    consoleErrors,
  };
  await fs.writeFile(`${artifactDir}/b912-f03-result.json`, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  const output = { ok: false, target, error: String(error?.stack || error), pageErrors, consoleErrors };
  await fs.writeFile(`${artifactDir}/b912-f03-result.json`, JSON.stringify(output, null, 2) + '\n');
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
