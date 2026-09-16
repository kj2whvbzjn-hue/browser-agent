import assert from 'node:assert/strict';
import { BrowserSessionClient, commandBody, parseSessionResponse, parseSessionStatus } from './browser-session-protocol.mjs';

const status = parseSessionStatus('<!-- browser-session-status:123 -->\n```json\n{"sessionId":"123","state":"ready"}\n```');
assert.equal(status.sessionId, '123');
assert.equal(status.state, 'ready');
const response = parseSessionResponse('<!-- browser-session-response:123:c1 -->\n```json\n{"sessionId":"123","ok":true,"value":{"ok":true}}\n```');
assert.equal(response.commandId, 'c1');
assert.equal(response.ok, true);
assert.match(commandBody('123', 'c2', { action: 'getPage' }), /browser-session-command:123:c2/);

let comments = [{ id: 10, user: { login: 'owner' }, body: '<!-- browser-session-status:123 -->\n```json\n{"sessionId":"123","state":"ready"}\n```' }];
let posted;
const fakeFetch = async (url, options = {}) => {
  if ((options.method || 'GET') === 'POST') {
    posted = JSON.parse(options.body).body;
    const m = posted.match(/browser-session-command:123:([^\s]+)\s*-->/);
    const commandId = m[1];
    comments.push({ id: 11, user: { login: 'owner' }, body: `<!-- browser-session-response:123:${commandId} -->\n\`\`\`json\n{"sessionId":"123","ok":true,"value":{"url":"https://example.com"}}\n\`\`\`` });
    return { ok: true, status: 201, json: async () => ({ id: 99 }) };
  }
  return { ok: true, status: 200, json: async () => comments };
};

const client = new BrowserSessionClient({ repo: 'owner/repo', issueNumber: 1, token: 'test', owner: 'owner', pollMs: 1, timeoutMs: 100, fetchImpl: fakeFetch });
const detected = await client.waitForSession();
assert.equal(detected.sessionId, '123');
const page = await client.getPage();
assert.equal(page.ok, true);
assert.equal(page.value.url, 'https://example.com');
assert.match(posted, /"action":"getPage"/);
console.log('BROWSER_SESSION_PROTOCOL_E2E_OK');
