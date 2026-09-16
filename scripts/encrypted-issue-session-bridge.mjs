import { BrowserAgent } from './browser-agent.mjs';
import { generateTransportKeyPair, keyFingerprint, encryptEnvelope, decryptEnvelope } from './encrypted-issue-transport.mjs';

const repo = process.env.GITHUB_REPOSITORY;
const issueNumber = Number(process.env.BROWSER_SESSION_ISSUE);
const token = process.env.GITHUB_TOKEN;
const sessionId = String(process.env.BROWSER_SESSION_ID || process.env.GITHUB_RUN_ID || '').trim();
const pollMs = Number(process.env.BROWSER_SESSION_POLL_MS || 2000);
const idleMs = Number(process.env.BROWSER_SESSION_IDLE_MS || 10 * 60 * 1000);
if (!repo || !issueNumber || !token || !sessionId) throw new Error('session env required');
const owner = repo.split('/')[0];
const api = `https://api.github.com/repos/${repo}`;
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const agent = new BrowserAgent({ headless: process.env.BROWSER_HEADLESS !== 'false' });
const agentKeys = generateTransportKeyPair();
const agentFingerprint = keyFingerprint(agentKeys.publicKey);
let clientPublicKey = null;
let clientFingerprint = null;
let lastCommentId = 0;
let lastActivity = Date.now();

async function gh(path, options = {}) {
  const r = await fetch(api + path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
async function post(body) {
  return gh(`/issues/${issueNumber}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) });
}
function jsonBlock(marker, value) { return `${marker}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``; }
function parseJson(body, regex) {
  const m = body.match(regex); if (!m) return null;
  return { captures: m.slice(1, -1), value: JSON.parse(m.at(-1)) };
}
function parseClientKey(body) {
  return parseJson(body, /<!--\s*browser-session-client-key:([^\s]+)\s*-->[\s\S]*?```json\s*([\s\S]*?)```/i);
}
function parseEncryptedCommand(body) {
  return parseJson(body, /<!--\s*browser-session-encrypted-command:([^:\s]+):([^\s]+)\s*-->[\s\S]*?```json\s*([\s\S]*?)```/i);
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
async function encryptedReply(commandId, payload) {
  if (!clientPublicKey) throw new Error('Client public key not registered');
  const envelope = encryptEnvelope(payload, clientPublicKey, { kind: 'response', sessionId, commandId });
  await post(jsonBlock(`<!-- browser-session-encrypted-response:${sessionId}:${commandId} -->`, envelope));
}

const initial = await gh(`/issues/${issueNumber}/comments?per_page=100&sort=created&direction=asc`);
lastCommentId = initial.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0);
await post(jsonBlock(`<!-- browser-session-agent-key:${sessionId} -->`, {
  v: 1, sessionId, alg: 'RSA-OAEP-3072+AES-256-GCM', fingerprint: agentFingerprint, publicKey: agentKeys.publicKey,
}));
console.log(`ENCRYPTED_ISSUE_SESSION_READY issue=${issueNumber} session=${sessionId} agent=${agentFingerprint}`);

let ended = false;
try {
  while (!ended && Date.now() - lastActivity < idleMs) {
    const comments = await gh(`/issues/${issueNumber}/comments?per_page=100&sort=created&direction=asc`);
    for (const comment of comments) {
      if (comment.id <= lastCommentId) continue;
      lastCommentId = comment.id;
      if (comment.user?.login !== process.env.GITHUB_REPOSITORY_OWNER) continue;
      try {
        const ck = parseClientKey(comment.body || '');
        if (ck && ck.captures[0] === sessionId) {
          const candidate = ck.value.publicKey;
          const fingerprint = keyFingerprint(candidate);
          if (ck.value.fingerprint && ck.value.fingerprint !== fingerprint) throw new Error('Client key fingerprint mismatch');
          clientPublicKey = candidate;
          clientFingerprint = fingerprint;
          lastActivity = Date.now();
          await post(jsonBlock(`<!-- browser-session-client-key-accepted:${sessionId} -->`, { sessionId, fingerprint: clientFingerprint }));
          continue;
        }
        const ec = parseEncryptedCommand(comment.body || '');
        if (!ec || ec.captures[0] !== sessionId) continue;
        const commandId = ec.captures[1];
        lastActivity = Date.now();
        const command = decryptEnvelope(ec.value, agentKeys.privateKey);
        if (ec.value.kind !== 'command' || ec.value.sessionId !== sessionId || ec.value.commandId !== commandId) throw new Error('Encrypted command metadata mismatch');
        try {
          const value = await execute(command);
          await encryptedReply(commandId, { ok: true, value });
          if (command.action === 'end') ended = true;
        } catch (error) {
          await encryptedReply(commandId, { ok: false, error: String(error?.stack || error) });
        }
      } catch (error) { console.error('encrypted comment rejected', error); }
    }
    if (!ended) await new Promise(r => setTimeout(r, pollMs));
  }
} finally {
  await agent.end().catch(() => {});
  console.log(`ENCRYPTED_ISSUE_SESSION_ENDED session=${sessionId}`);
}
