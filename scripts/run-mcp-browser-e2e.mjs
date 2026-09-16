import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const html = `<!doctype html><html><head><meta charset="utf-8"><title>MCP Browser E2E</title></head><body>
<textarea aria-label="Message"></textarea>
<button type="button">Submit</button>
<div id="result"></div>
<script>document.querySelector('button').onclick=()=>{document.querySelector('#result').textContent='RESULT:'+document.querySelector('textarea').value}</script>
</body></html>`;
const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['connector/mcp-server.mjs'],
  env: { ...process.env, BROWSER_HEADLESS: 'true' }
});
const client = new Client({ name: 'browser-connector-e2e-client', version: '0.1.0' });

function parsed(response) {
  const text = response.content?.find((x) => x.type === 'text')?.text;
  if (!text) throw new Error('MCP response did not contain text');
  return JSON.parse(text);
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = new Set(tools.tools.map((t) => t.name));
  for (const name of ['browser_start','browser_get_page','browser_fill','browser_click','browser_end']) {
    assert.ok(names.has(name), `missing MCP tool: ${name}`);
  }

  const started = parsed(await client.callTool({ name: 'browser_start', arguments: { url } }));
  const textbox = started.elements.find((e) => e.role === 'textbox' && e.editable && e.label === 'Message');
  assert.ok(textbox, 'MCP observation did not expose textbox');

  await client.callTool({ name: 'browser_fill', arguments: { elementId: textbox.id, text: 'mcp connector success' } });
  const observed = parsed(await client.callTool({ name: 'browser_get_page', arguments: {} }));
  const button = observed.elements.find((e) => e.role === 'button' && e.text === 'Submit');
  assert.ok(button, 'MCP observation did not expose submit button');

  await client.callTool({ name: 'browser_click', arguments: { elementId: button.id } });
  const finalState = parsed(await client.callTool({ name: 'browser_get_page', arguments: {} }));
  assert.match(finalState.pageText, /RESULT:mcp connector success/);

  await client.callTool({ name: 'browser_end', arguments: {} });
  console.log('MCP_BROWSER_E2E_OK');
} finally {
  await client.close();
}
