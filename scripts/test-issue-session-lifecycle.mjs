import assert from 'node:assert/strict';

function statusPayload(sessionId, state, issueNumber, extra = {}) {
  return { sessionId, state, issueNumber, updatedAt: new Date().toISOString(), ...extra };
}

const sessionId = '12345';
for (const state of ['ready', 'busy', 'ended']) {
  const payload = statusPayload(sessionId, state, 17);
  assert.equal(payload.sessionId, sessionId);
  assert.equal(payload.state, state);
  assert.equal(payload.issueNumber, 17);
  assert.ok(Date.parse(payload.updatedAt));
}

const concurrencyKey = issueNumber => `browser-issue-session-${issueNumber}`;
assert.equal(concurrencyKey(17), concurrencyKey(17));
assert.notEqual(concurrencyKey(17), concurrencyKey(18));

console.log('ISSUE_SESSION_LIFECYCLE_OK');
