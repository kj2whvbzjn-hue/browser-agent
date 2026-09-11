import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const workspace = path.resolve(process.env.TSUGU_WORKSPACE || 'tsugu');
const reportPath = path.resolve(process.env.BROWSER_REPORT || 'artifacts/test-report.md');
const outputPath = path.resolve(process.env.HANDOFF_OUTPUT || 'artifacts/chatgpt-continuation.md');
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

function readIfExists(file, maxChars = 30000) {
  if (!fs.existsSync(file)) return '(not available)';
  const value = fs.readFileSync(file, 'utf8');
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n...[truncated]` : value;
}

const report = readIfExists(reportPath);
const recentLog = runGit(['log', '--oneline', '-12']);
const status = runGit(['status', '--short']);

const handoff = `# TSUGU ChatGPT continuation handoff\n\nContinuation message: **${continuation}**\n\nThis artifact is evidence for the existing ChatGPT-led TSUGU development session.\nGitHub Actions and browser-agent only verify and collect evidence. They must not edit TSUGU source code and must not delegate development work to Codex.\n\n## Run context\n- source ref: ${sourceRef}\n- source SHA: ${sourceSha}\n- continuation cycle: ${cycle}\n- browser-agent outcome: ${browserOutcome}\n\n## Browser-agent evidence\n\n${report}\n\n## Recent Git history\n\n\`\`\`text\n${recentLog}\n\`\`\`\n\n## Working-tree status\n\n\`\`\`text\n${status || '(clean)'}\n\`\`\`\n\n## Handoff rule\n- Development decisions and repository edits belong to the ChatGPT session, not this workflow.\n- This workflow performs no source edits, commits, pushes, or AI coding actions.\n- Use the evidence above when the ChatGPT session is resumed with: ${continuation}\n`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, handoff);
console.log(`Wrote ChatGPT handoff to ${outputPath}`);
