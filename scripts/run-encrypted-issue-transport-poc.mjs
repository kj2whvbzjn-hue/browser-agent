import assert from 'node:assert/strict';
import {
  generateTransportKeyPair,
  keyFingerprint,
  encryptEnvelope,
  decryptEnvelope,
} from './encrypted-issue-transport.mjs';

const client = generateTransportKeyPair();
const agent = generateTransportKeyPair();

const sessionId = 'poc-session';
const commandId = 'poc-command-1';
const secretText = 'この文字列は公開Issueでは平文にしない';

const command = { action: 'fill', elementId: 'g1-e1', text: secretText };
const encryptedCommand = encryptEnvelope(command, agent.publicKey, {
  kind: 'command', sessionId, commandId,
});

const serializedCommand = JSON.stringify(encryptedCommand);
assert.equal(serializedCommand.includes(secretText), false);
assert.equal(encryptedCommand.kid, keyFingerprint(agent.publicKey));
assert.deepEqual(decryptEnvelope(encryptedCommand, agent.privateKey), command);

const response = { ok: true, value: { pageText: `RESULT:${secretText}` } };
const encryptedResponse = encryptEnvelope(response, client.publicKey, {
  kind: 'response', sessionId, commandId,
});

const serializedResponse = JSON.stringify(encryptedResponse);
assert.equal(serializedResponse.includes(secretText), false);
assert.equal(encryptedResponse.kid, keyFingerprint(client.publicKey));
assert.deepEqual(decryptEnvelope(encryptedResponse, client.privateKey), response);

const tampered = { ...encryptedResponse, ciphertext: encryptedResponse.ciphertext.slice(0, -1) + (encryptedResponse.ciphertext.endsWith('A') ? 'B' : 'A') };
assert.throws(() => decryptEnvelope(tampered, client.privateKey));

console.log('ENCRYPTED_ISSUE_TRANSPORT_POC_OK');
console.log(JSON.stringify({
  sessionId,
  agentFingerprint: keyFingerprint(agent.publicKey),
  clientFingerprint: keyFingerprint(client.publicKey),
  commandPlaintextExposed: serializedCommand.includes(secretText),
  responsePlaintextExposed: serializedResponse.includes(secretText),
  tamperRejected: true,
}, null, 2));
