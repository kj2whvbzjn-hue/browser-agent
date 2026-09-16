import assert from 'node:assert/strict';

function parse(body) {
  const m = body.match(/<!--\s*browser-session-command:([^:\s]+):([^\s]+)\s*-->[\s\S]*?```json\s*([\s\S]*?)```/i);
  if (!m) return null;
  return { targetSessionId: m[1], commandId: m[2], command: JSON.parse(m[3]) };
}

const current = '12345';
const own = parse('<!-- browser-session-command:12345:c1 -->\n```json\n{"action":"getPage"}\n```');
assert.equal(own.targetSessionId, current);
assert.equal(own.commandId, 'c1');
assert.equal(own.command.action, 'getPage');

const other = parse('<!-- browser-session-command:99999:c2 -->\n```json\n{"action":"click","elementId":"g1-e1"}\n```');
assert.notEqual(other.targetSessionId, current);

const legacy = parse('<!-- browser-session-command:c3 -->\n```json\n{"action":"getPage"}\n```');
assert.equal(legacy, null);

console.log('ISSUE_SESSION_ROUTING_OK');
