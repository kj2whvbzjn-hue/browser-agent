import { execFileSync } from 'node:child_process';
import path from 'node:path';

const workspace = path.resolve(process.argv[2] || process.env.TSUGU_WORKSPACE || 'tsugu');
const maxFiles = Number(process.env.MAX_CHANGED_FILES || 20);
const maxLines = Number(process.env.MAX_CHANGED_LINES || 4000);

function git(args) {
  return execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8' }).trim();
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const fs = requireFs();
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function requireFs() {
  return globalThis.__fs || (globalThis.__fs = awaitImportFs());
}

function awaitImportFs() {
  // eslint-disable-next-line no-eval
  return eval('require')('node:fs');
}

const porcelain = git(['status', '--porcelain=v1', '--untracked-files=all']);
if (!porcelain) {
  console.log('No TSUGU changes were produced.');
  writeOutput('has_changes', 'false');
  process.exit(0);
}

const entries = porcelain.split('\n').map((line) => ({
  status: line.slice(0, 2),
  path: line.slice(3).trim(),
}));

const forbiddenPrefixes = [
  '.github/workflows/',
  '.github/actions/',
  '.git/',
];
const forbiddenPatterns = [
  /(^|\/)\.env($|\.)/i,
  /(^|\/)(credentials?|secrets?|tokens?)(\.|\/|$)/i,
  /\.(pem|p12|pfx|key)$/i,
];

const problems = [];
for (const entry of entries) {
  const normalized = entry.path.replace(/^"|"$/g, '');
  if (entry.status.includes('D')) problems.push(`file deletion is not allowed: ${normalized}`);
  if (forbiddenPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    problems.push(`automation/infrastructure path is protected: ${normalized}`);
  }
  if (forbiddenPatterns.some((pattern) => pattern.test(normalized))) {
    problems.push(`secret-like path is not allowed: ${normalized}`);
  }
}

if (entries.length > maxFiles) {
  problems.push(`too many changed files: ${entries.length} > ${maxFiles}`);
}

let changedLines = 0;
try {
  const numstat = git(['diff', '--numstat']);
  if (numstat) {
    for (const line of numstat.split('\n')) {
      const [added, removed] = line.split('\t');
      if (/^\d+$/.test(added)) changedLines += Number(added);
      if (/^\d+$/.test(removed)) changedLines += Number(removed);
    }
  }
} catch {
  // The file-count and path guards remain authoritative if numstat is unavailable.
}
if (changedLines > maxLines) {
  problems.push(`change is too large: ${changedLines} changed lines > ${maxLines}`);
}

if (problems.length) {
  console.error('TSUGU change guard rejected the generated edit:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`TSUGU change guard passed: ${entries.length} files, ${changedLines} changed lines.`);
for (const entry of entries) console.log(`${entry.status} ${entry.path}`);
writeOutput('has_changes', 'true');
