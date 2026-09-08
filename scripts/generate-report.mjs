import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const requestedTaskPath = process.argv[2] || 'tasks/task.json';

async function readText(filePath) {
  try { return await fs.readFile(filePath, 'utf8'); } catch { return ''; }
}

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { return null; }
}

async function loadTaskDefinition(requestedPath) {
  const requested = await readJson(requestedPath) || {};
  if (typeof requested.taskFile === 'string' && requested.taskFile.trim()) {
    const taskPath = requested.taskFile.trim();
    return {
      task: await readJson(taskPath) || {},
      taskPath,
      selectionPath: requestedPath,
      selection: requested,
    };
  }
  return {
    task: requested,
    taskPath: requestedPath,
    selectionPath: null,
    selection: null,
  };
}

function lines(text) {
  return String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function safeOneLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function collectQuestOutcomes(value, out, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectQuestOutcomes(item, out, seen);
    return;
  }

  const questId = value.quest_id ?? value.questId;
  const finalResult = value.final_result ?? value.finalResult;
  if (questId && finalResult && typeof finalResult === 'object') {
    const startedAt = value.playback_started_at ?? value.playbackStartedAt ?? null;
    out.push({
      questId: String(questId),
      startedAt,
      success: typeof finalResult.success === 'boolean' ? finalResult.success : null,
      status: finalResult.final_state?.status ?? finalResult.finalState?.status ?? null,
      failureReason: finalResult.failure?.reason ?? null,
    });
  }

  for (const child of Object.values(value)) collectQuestOutcomes(child, out, seen);
}

function uniqueQuestOutcomes(items) {
  const map = new Map();
  for (const item of items) {
    const key = [item.questId, item.startedAt, item.success, item.status, item.failureReason].join('|');
    map.set(key, item);
  }
  return [...map.values()].sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
}

const { task, taskPath, selectionPath, selection } = await loadTaskDefinition(requestedTaskPath);
const outputDir = path.resolve(task.outputDir || 'artifacts');
await fs.mkdir(outputDir, { recursive: true });

const result = await readJson(path.join(outputDir, 'result.json')) || {
  ok: false,
  failure: 'result.json is missing or unreadable',
  finalUrl: null,
};
const consoleLines = lines(await readText(path.join(outputDir, 'console.log')));
const pageErrorLines = lines(await readText(path.join(outputDir, 'page-errors.log')));
const dialogLines = lines(await readText(path.join(outputDir, 'dialogs.log')));
const patchLines = lines(await readText(path.join(outputDir, 'patches.log')));

let evidence = [];
try {
  const names = await fs.readdir(outputDir);
  evidence = (await Promise.all(names.map(async name => {
    const stat = await fs.stat(path.join(outputDir, name));
    return stat.isFile() ? { name, bytes: stat.size } : null;
  }))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
} catch {}

const questOutcomes = [];
for (const item of evidence.filter(x => x.name.endsWith('-storage.json'))) {
  const storage = await readJson(path.join(outputDir, item.name));
  if (!storage || typeof storage !== 'object') continue;
  for (const storeName of ['localStorage', 'sessionStorage']) {
    const store = storage[storeName];
    if (!store || typeof store !== 'object') continue;
    for (const entry of Object.values(store)) {
      if (entry?.json && typeof entry.json === 'object') collectQuestOutcomes(entry.json, questOutcomes);
    }
  }
}
const gameOutcomes = uniqueQuestOutcomes(questOutcomes);
const latestGameOutcome = gameOutcomes.at(-1) || null;

const steps = Array.isArray(task.steps) ? task.steps.map((step, index) => ({
  index: index + 1,
  action: step.action || null,
  label: step.label || `${index + 1}-${step.action || 'unknown'}`,
})) : [];

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  selection: selectionPath ? {
    path: selectionPath,
    project: selection?.project || null,
    label: selection?.label || null,
    runRequest: selection?.runRequest ?? null,
  } : null,
  task: {
    path: taskPath,
    outputDir: task.outputDir || 'artifacts',
    stepCount: steps.length,
    steps,
    responsePatchLabels: Array.isArray(task.responsePatches)
      ? task.responsePatches.map(p => p?.label || p?.url || 'unnamed-patch')
      : [],
  },
  automation: {
    ok: Boolean(result.ok),
    verdict: result.ok ? 'PASS' : 'FAIL',
    finalUrl: result.finalUrl || null,
    failure: result.failure || null,
    consoleMessageCount: consoleLines.length,
    pageErrorCount: pageErrorLines.length,
    dialogCount: dialogLines.length,
    patchLog: patchLines,
  },
  game: {
    verdict: latestGameOutcome == null ? 'UNKNOWN' : latestGameOutcome.success === true ? 'SUCCESS' : latestGameOutcome.success === false ? 'FAILURE' : 'UNKNOWN',
    latestOutcome: latestGameOutcome,
    observedOutcomes: gameOutcomes,
    note: 'Game outcome is reported separately from Browser Agent automation success/failure.',
  },
  evidence,
  privacy: {
    rawStorageIncludedInReport: false,
    note: 'The report indexes evidence files but does not embed raw storage, cookies, tokens, secrets, or email addresses.',
  },
};

await fs.writeFile(path.join(outputDir, 'test-report.json'), `${JSON.stringify(report, null, 2)}\n`);

const md = [];
md.push('# Browser Agent Test Report', '');
md.push(`- Generated: ${report.generatedAt}`);
if (report.selection) {
  md.push(`- Project: ${safeOneLine(report.selection.project || '(unspecified)')}`);
  md.push(`- Selection: \`${safeOneLine(report.selection.path)}\``);
  md.push(`- Run request: ${safeOneLine(report.selection.runRequest ?? '(none)')}`);
}
md.push(`- Task: \`${safeOneLine(taskPath)}\``);
md.push(`- Automation verdict: **${report.automation.verdict}**`);
md.push(`- Final URL: ${safeOneLine(report.automation.finalUrl || '(none)')}`);
md.push(`- Game verdict: **${report.game.verdict}**`);
if (latestGameOutcome) {
  md.push(`- Quest: \`${safeOneLine(latestGameOutcome.questId)}\``);
  if (latestGameOutcome.status) md.push(`- Game final status: \`${safeOneLine(latestGameOutcome.status)}\``);
  if (latestGameOutcome.failureReason) md.push(`- Game failure reason: \`${safeOneLine(latestGameOutcome.failureReason)}\``);
}
md.push('', '> Browser Agentの操作成功/失敗と、ゲーム内の勝敗・仕様不具合は別判定です。', '');

md.push('## Browser task', '');
md.push(`Steps: ${steps.length}`);
for (const step of steps) md.push(`- ${step.index}. \`${safeOneLine(step.action)}\` — ${safeOneLine(step.label)}`);

md.push('', '## Execution result', '');
md.push(`- Console messages: ${consoleLines.length}`);
md.push(`- Page errors: ${pageErrorLines.length}`);
md.push(`- Dialogs: ${dialogLines.length}`);
md.push(`- Response patches applied/logged: ${patchLines.length}`);
if (result.failure) md.push(`- Automation failure: ${safeOneLine(result.failure)}`);

md.push('', '## Evidence index', '');
for (const item of evidence) md.push(`- \`${safeOneLine(item.name)}\` (${item.bytes} bytes)`);

md.push('', '## Privacy', '');
md.push('This report does not embed raw localStorage/sessionStorage, cookies, tokens, Secrets, or personal email addresses. Raw evidence remains in the Actions artifact for controlled inspection.');

await fs.writeFile(path.join(outputDir, 'test-report.md'), `${md.join('\n')}\n`);
console.log(`Generated ${path.join(outputDir, 'test-report.md')} and test-report.json`);
