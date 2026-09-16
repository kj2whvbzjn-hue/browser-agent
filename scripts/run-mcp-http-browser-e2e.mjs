import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const port = 31337;
const token = 'e2e-local-token';
const server = spawn(process.execPath, ['connector/mcp-http-server.mjs'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BROWSER_CONNECTOR_TOKEN: token, BROWSER_HEADLESS: 'true' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('HTTP MCP server did not become ready');
}

function structured(call) {
  if (call.structuredContent) return call.structuredContent;
  const text = call.content?.find(x => x.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

const html = `<!doctype html><html><head><title>HTTP MCP E2E</title></head><body>
<textarea aria-label="Message"></textarea><button>Submit</button><div id="result"></div>
<script>document.querySelector('button').onclick=()=>document.querySelector('#result').textContent='RESULT:'+document.querySelector('textarea').value;</script>
</body></html>`;
const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

let client;
try {
  await waitForHealth();
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  });
  client = new Client({ name: 'browser-http-e2e-client', version: '0.1.0' });
  await client.connect(transport);

  const start = structured(await client.callTool({ name: 'browser_start', arguments: { url: dataUrl } }));
  const textbox = start.elements.find(e => e.role === 'textbox' && e.label === 'Message');
  assert.ok(textbox, 'textbox not found');

  await client.callTool({ name: 'browser_fill', arguments: { elementId: textbox.id, text: 'http mcp success' } });
  const state2 = structured(await client.callTool({ name: 'browser_get_page', arguments: {} }));
  const button = state2.elements.find(e => e.role === 'button' && e.text === 'Submit');
  assert.ok(button, 'button not found');

  await client.callTool({ name: 'browser_click', arguments: { elementId: button.id } });
  const finalState = structured(await client.callTool({ name: 'browser_get_page', arguments: {} }));
  assert.match(finalState.pageText, /RESULT:http mcp success/);
  await client.callTool({ name: 'browser_end', arguments: {} });
  console.log('MCP_HTTP_BROWSER_E2E_OK');
} finally {
  if (client) await client.close().catch(() => {});
  server.kill('SIGTERM');
}
