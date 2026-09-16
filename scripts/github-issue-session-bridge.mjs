import { BrowserAgent } from './browser-agent.mjs';

const repo = process.env.GITHUB_REPOSITORY;
const issueNumber = Number(process.env.BROWSER_SESSION_ISSUE);
const token = process.env.GITHUB_TOKEN;
const sessionId = String(process.env.BROWSER_SESSION_ID || process.env.GITHUB_RUN_ID || '').trim();
const pollMs = Number(process.env.BROWSER_SESSION_POLL_MS || 2000);
const idleMs = Number(process.env.BROWSER_SESSION_IDLE_MS || 20 * 60 * 1000);
const heartbeatMs = Number(process.env.BROWSER_SESSION_HEARTBEAT_MS || 60 * 1000);
if (!repo || !issueNumber || !token || !sessionId) throw new Error('GITHUB_REPOSITORY, BROWSER_SESSION_ISSUE, GITHUB_TOKEN and BROWSER_SESSION_ID/GITHUB_RUN_ID are required');
const [owner, name] = repo.split('/');
const api = `https://api.github.com/repos/${owner}/${name}`;
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const agent = new BrowserAgent({ headless: process.env.BROWSER_HEADLESS !== 'false' });
let lastCommentId = 0;
let lastActivity = Date.now();
let lastHeartbeat = 0;
let statusCommentId = null;
let state = 'starting';

async function gh(path, options = {}) {
  const r = await fetch(api + path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
function statusBody(nextState, extra = {}) {
  return `<!-- browser-session-status:${sessionId} -->\n\`\`\`json\n${JSON.stringify({ sessionId, state: nextState, issueNumber, updatedAt: new Date().toISOString(), ...extra }, null, 2)}\n\`\`\``;
}
async function setStatus(nextState, extra = {}) {
  state = nextState;
  const body = statusBody(nextState, extra);
  if (statusCommentId) {
    await gh(`/issues/comments/${statusCommentId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) });
  } else {
    const created = await gh(`/issues/${issueNumber}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) });
    statusCommentId = created.id;
  }
  lastHeartbeat = Date.now();
}
async function reply(commandId, payload) {
  const body = `<!-- browser-session-response:${sessionId}:${commandId} -->\n\`\`\`json\n${JSON.stringify({ sessionId, ...payload }, null, 2)}\n\`\`\``;
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
  const m = body.match(/<!--\s*browser-session-command:([^:\s]+):([^\s]+)\s*-->[\s\S]*?```json\s*([\s\S]*?)```/i);
  if (!m) return null;
  return { targetSessionId: m[1], commandId: m[2], command: JSON.parse(m[3]) };
}

const initialComments = await gh(`/issues/${issueNumber}/comments?per_page=100&sort=created&direction=asc`);
lastCommentId = initialComments.reduce((max, comment) => Math.max(max, Number(comment.id) || 0), 0);
await setStatus('ready', { cursor: lastCommentId });
console.log(`ISSUE_SESSION_BRIDGE_READY issue=${issueNumber} session=${sessionId} cursor=${lastCommentId}`);

let endReason = 'idle-timeout';
try {
  while (Date.now() - lastActivity < idleMs) {
    if (Date.now() - lastHeartbeat >= heartbeatMs) await setStatus(state === 'busy' ? 'busy' : 'ready', { lastActivityAt: new Date(lastActivity).toISOString() });
    const comments = await gh(`/issues/${issueNumber}/comments?per_page=100&sort=created&direction=asc`);
    for (const comment of comments) {
      if (comment.id <= lastCommentId) continue;
      lastCommentId = comment.id;
      if (comment.user?.login !== process.env.GITHUB_REPOSITORY_OWNER) continue;
      let parsed;
      try { parsed = parse(comment.body || ''); } catch (e) { console.error('parse failed', e); continue; }
      if (!parsed || parsed.targetSessionId !== sessionId) continue;
      lastActivity = Date.now();
      await setStatus('busy', { commandId: parsed.commandId, action: parsed.command.action });
      try {
        const value = await execute(parsed.command);
        await reply(parsed.commandId, { ok: true, value });
        if (parsed.command.action === 'end') {
          endReason = 'command-end';
          process.exitCode = 0;
        } else {
          await setStatus('ready', { lastCommandId: parsed.commandId, lastAction: parsed.command.action });
        }
      } catch (error) {
        await reply(parsed.commandId, { ok: false, error: String(error?.stack || error) });
        await setStatus('ready', { lastCommandId: parsed.commandId, lastAction: parsed.command.action, lastCommandOk: false });
      }
      if (parsed.command.action === 'end') break;
    }
    if (process.exitCode === 0) break;
    await new Promise(r => setTimeout(r, pollMs));
  }
} finally {
  await agent.end().catch(() => {});
  await setStatus('ended', { reason: endReason }).catch(error => console.error('failed to post ended status', error));
}
