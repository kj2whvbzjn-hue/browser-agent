import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const workspace = path.resolve(process.env.TSUGU_WORKSPACE || 'tsugu');
const reportPath = path.resolve(process.env.BROWSER_REPORT || 'artifacts/test-report.md');
const outputPath = path.resolve(process.env.PROMPT_OUTPUT || 'artifacts/tsugu-codex-prompt.md');
const sourceSha = process.env.SOURCE_SHA || 'unknown';
const sourceRef = process.env.SOURCE_REF || 'unknown';
const cycle = process.env.CYCLE || '1';
const browserOutcome = process.env.BROWSER_OUTCOME || 'unknown';
const continuation = process.env.CONTINUATION_TEXT || '続行';

function runGit(args) {
  try {
    return execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8' }).trim();
  } catch (error) {
    return `(git command failed: ${error.message})`;
  }
}

function readIfExists(file, maxChars = 24000) {
  if (!fs.existsSync(file)) return '(not available)';
  const value = fs.readFileSync(file, 'utf8');
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n...[truncated]` : value;
}

const report = readIfExists(reportPath, 30000);
const recentLog = runGit(['log', '--oneline', '-12']);
const status = runGit(['status', '--short']);

const prompt = `# TSUGU autonomous continuation\n\nYou are continuing development of the TSUGU application in the checked-out repository.\nThe user's continuation instruction is exactly: **${continuation}**\n\n## Run context\n- source ref: ${sourceRef}\n- source SHA: ${sourceSha}\n- continuation cycle: ${cycle}\n- browser-agent outcome before this change: ${browserOutcome}\n\n## Mandatory source-of-truth order\nRead these files in the repository before changing code, in this order:\n1. README.md\n2. docs/TSUGU_PROJECT_REFERENCE.md\n3. docs/TSUGU_CORE_VNEXT_PLAN.md\n4. docs/TSUGU_CORE_VNEXT_WBS.md\n5. DEPLOYMENT.md\n6. AI_CONNECTION.md\n\nThe repository itself is the development target. Do not treat TSUGU as the automation controller.\nUse browser-agent evidence only as observed behavior; reconcile it with current source and tests.\n\n## Browser-agent evidence\n\n${report}\n\n## Recent Git history\n\n\`\`\`text\n${recentLog}\n\`\`\`\n\n## Working-tree status before your edits\n\n\`\`\`text\n${status || '(clean)'}\n\`\`\`\n\n## Required behavior for this cycle\n- Inspect the current implementation and WBS, then perform **one coherent next unit of TSUGU development work**.\n- Prefer a small, reviewable change that advances the documented plan or fixes a browser/test failure.\n- You may read and edit files inside this TSUGU workspace and run local commands/tests.\n- Do not use or invent secrets, PATs, cookies, user data, or private tsugu-data contents.\n- Do not edit GitHub Actions workflows, repository permissions, secret handling, or this AI-continuation mechanism.\n- Do not delete files. If deletion is genuinely required, stop and explain it in the final message instead.\n- Do not make destructive migrations or bypass approval/guard rules documented by TSUGU.\n- Preserve the single-app architecture and current canonical paths.\n- Add or update tests when the change can be covered by the existing test style.\n- Do not commit or push; the workflow will validate and commit after you finish.\n- If the repository is already at a sensible stopping point or no safe next change is justified, make no edits and say so.\n\nFinish with a concise summary of what you changed, what you tested, and any remaining blocker.\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, prompt);
console.log(`Wrote Codex prompt to ${outputPath}`);
