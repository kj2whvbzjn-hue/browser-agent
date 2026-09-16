import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const child = spawn(process.execPath, ['scripts/browser-session-bridge.mjs'], {
  env: { ...process.env, BROWSER_HEADLESS: 'true' }, stdio: ['pipe', 'pipe', 'inherit']
});
const rl = readline.createInterface({ input: child.stdout });
const pending = [];
rl.on('line', line => pending.shift()?.(JSON.parse(line)));

function command(value) {
  return new Promise((resolve, reject) => {
    pending.push(msg => msg.ok ? resolve(msg.value) : reject(new Error(msg.error)));
    child.stdin.write(JSON.stringify(value) + '\n');
  });
}

const html = `<!doctype html><html><head><title>Session Bridge E2E</title></head><body><textarea aria-label="Message"></textarea><button>Submit</button><div id="result"></div><script>document.querySelector('button').onclick=()=>document.querySelector('#result').textContent='RESULT:'+document.querySelector('textarea').value;</script></body></html>`;
const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

try {
  const s1 = await command({ action: 'start', url });
  const textbox = s1.elements.find(e => e.role === 'textbox' && e.label === 'Message');
  assert.ok(textbox);
  await command({ action: 'fill', elementId: textbox.id, text: 'session bridge success' });
  const s2 = await command({ action: 'getPage' });
  const button = s2.elements.find(e => e.role === 'button' && e.text === 'Submit');
  assert.ok(button);
  await command({ action: 'click', elementId: button.id });
  const s3 = await command({ action: 'getPage' });
  assert.match(s3.pageText, /RESULT:session bridge success/);
  await command({ action: 'end' });
  console.log('SESSION_BRIDGE_E2E_OK');
} finally {
  child.kill('SIGTERM');
  rl.close();
}
