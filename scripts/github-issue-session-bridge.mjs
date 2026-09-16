import { BrowserAgent } from './browser-agent.mjs';

const repo = process.env.GITHUB_REPOSITORY;
const issueNumber = Number(process.env.BROWSER_SESSION_ISSUE);
const token = process.env.GITHUB_TOKEN;
const pollMs = Number(process.env.BROWSER_SESSION_POLL_MS || 2000);
const idleMs = Number(process.env.BROWSER_SESSION_IDLE_MS || 20 * 60 * 1000);
if (!repo || !issueNumber || !token) throw new Error('GITHUB_REPOSITORY, BROWSER_SESSION_ISSUE and GITHUB_TOKEN are required');
const [owner, name] = repo.split('/');
const api = `https://api.github.com/repos/${owner}/${name}`;
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const agent = new BrowserAgent({ headless: process.env.BROWSER_HEADLESS !== 'false' });
let lastCommentId = 0;
let lastActivity = Date.now();

async function gh(path, options = {}) {
  const r = await fetch(api + path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
async function reply(commandId, payload) {
  const body = `<!-- browser-session-response:${commandId} -->\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
  await gh(`/issues/${issueNumber}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) });
}
async function execute(c) {
  switch (c.action) {
    case 'start': return agent.start(c.url);
    case 'getPage': return agent.getPage();
    case 'goto': return agent.goto(c.url);
    case 'fill': return agent.fill(c.elementId, c.text);
    case 'click': return agent.click(c.elementId);
    case 'press': return agent.press(c.key);
    case 'scroll': return agent.scroll(c.direction, c.amount);
    case 'end': return agent.end();
    default: throw new Error(`Unknown action: ${c.action}`);
  }
}
function parse(body) {
  const m = body.match(/<!--\s*browser-session-command:([^\s]+)\s*-->[\s\S]*?```json\s*([\s\S]*?)```/i);
  if (!m) return null;
  return { commandId: m[1], command: JSON.parse(m[2]) };
}

// Establish the queue cursor before accepting commands. This makes each
// workflow run a fresh session: comments that existed before the bridge
// became ready are history and must never be replayed into a new browser.
const initialComments = await gh(`/issues/${issueNumber}/comments?per_page=100&sort=created&direction=asc`);
lastCommentId = initialComments.reduce((max, comment) => Math.max(max, Number(comment.id) || 0), 0);
console.log(`ISSUE_SESSION_BRIDGE_READY issue=${issueNumber} cursor=${lastCommentId}`);

try {
  while (Date.now() - lastActivity < idleMs) {
    const comments = await gh(`/issues/${issueNumber}/comments?per_page=100&sort=created&direction=asc`);
    for (const comment of comments) {
      if (comment.id <= lastCommentId) continue;
      lastCommentId = comment.id;
      if (comment.user?.login !== process.env.GITHUB_REPOSITORY_OWNER) continue;
      let parsed;
      try { parsed = parse(comment.body || ''); } catch (e) { console.error('parse failed', e); continue; }
      if (!parsed) continue;
      lastActivity = Date.now();
      try {
        const value = await execute(parsed.command);
        await reply(parsed.commandId, { ok: true, value });
        if (parsed.command.action === 'end') process.exitCode = 0;
      } catch (error) {
        await reply(parsed.commandId, { ok: false, error: String(error?.stack || error) });
      }
      if (parsed.command.action === 'end') break;
    }
    if (process.exitCode === 0) break;
    await new Promise(r => setTimeout(r, pollMs));
  }
} finally {
  await agent.end().catch(() => {});
}
