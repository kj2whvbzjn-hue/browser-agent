import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { BrowserAgent } from './browser-agent.mjs';

const port = 9333;
const profile = `/tmp/browser-agent-attach-host-${process.pid}`;
const host = await chromium.launchPersistentContext(profile, {
  headless: true,
  args: [`--remote-debugging-port=${port}`],
});
const hostPage = host.pages()[0] || await host.newPage();
const html = `<!doctype html><html><head><title>Attach E2E</title></head><body><label for="message">Message</label><textarea id="message" aria-label="Message"></textarea><button type="button" onclick="document.querySelector('#result').textContent='RESULT:'+document.querySelector('#message').value">Submit</button><div id="result"></div></body></html>`;
await hostPage.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

async function connectAgent() {
  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const agent = new BrowserAgent({ connectionMode: 'attach', cdpEndpoint: `http://127.0.0.1:${port}` });
      await agent.start();
      return agent;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError || new Error('CDP endpoint did not become ready');
}

let agent;
try {
  agent = await connectAgent();
  const first = await agent.getPage();
  const textbox = first.elements.find(e => e.role === 'textbox' && e.label === 'Message');
  assert.ok(textbox, 'attached agent did not observe textbox');
  await agent.fill(textbox.id, 'attach survives detach');
  const second = await agent.getPage();
  const button = second.elements.find(e => e.role === 'button' && e.text === 'Submit');
  assert.ok(button, 'attached agent did not observe button');
  await agent.click(button.id);
  const third = await agent.getPage();
  assert.match(third.pageText, /RESULT:attach survives detach/);

  const endResult = await agent.end();
  assert.equal(endResult.detached, true, 'attach end must detach rather than own/close host');
  agent = null;
  assert.equal(hostPage.isClosed(), false, 'host page was closed by agent detach');
  assert.match(await hostPage.locator('body').innerText(), /RESULT:attach survives detach/);

  agent = await connectAgent();
  const reattached = await agent.getPage();
  assert.match(reattached.pageText, /RESULT:attach survives detach/);
  await agent.end();
  agent = null;
  assert.equal(hostPage.isClosed(), false, 'host page was closed after second detach');
  console.log('ATTACH_E2E_OK');
} finally {
  if (agent) await agent.end().catch(() => {});
  await host.close().catch(() => {});
}
