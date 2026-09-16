import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BrowserAgent } from '../scripts/browser-agent.mjs';

const agent = new BrowserAgent({
  headless: process.env.BROWSER_HEADLESS !== 'false'
});

const server = new McpServer({
  name: 'browser-connector-poc',
  version: '0.1.0'
});

function result(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

function fail(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: String(error?.stack || error) }]
  };
}

server.tool(
  'browser_start',
  'Start and retain one browser session. Optionally navigate to a URL.',
  { url: z.string().optional() },
  async ({ url }) => {
    try { return result(await agent.start(url)); } catch (error) { return fail(error); }
  }
);

server.tool(
  'browser_get_page',
  'Observe the current page and return fresh short-lived elementIds. Call this again after navigation or meaningful page changes.',
  {},
  async () => {
    try { return result(await agent.getPage()); } catch (error) { return fail(error); }
  }
);

server.tool(
  'browser_goto',
  'Navigate the retained browser session to a URL and return a fresh observation.',
  { url: z.string().url() },
  async ({ url }) => {
    try { return result(await agent.goto(url)); } catch (error) { return fail(error); }
  }
);

server.tool(
  'browser_fill',
  'Fill an editable element from the most recent browser_get_page observation.',
  { elementId: z.string(), text: z.string() },
  async ({ elementId, text }) => {
    try { return result(await agent.fill(elementId, text)); } catch (error) { return fail(error); }
  }
);

server.tool(
  'browser_click',
  'Click an element from the most recent browser_get_page observation.',
  { elementId: z.string() },
  async ({ elementId }) => {
    try { return result(await agent.click(elementId)); } catch (error) { return fail(error); }
  }
);

server.tool(
  'browser_press',
  'Press a keyboard key in the retained browser session.',
  { key: z.string() },
  async ({ key }) => {
    try { return result(await agent.press(key)); } catch (error) { return fail(error); }
  }
);

server.tool(
  'browser_scroll',
  'Scroll the current page.',
  { direction: z.enum(['up', 'down']).default('down'), amount: z.number().int().positive().max(5000).default(700) },
  async ({ direction, amount }) => {
    try { return result(await agent.scroll(direction, amount)); } catch (error) { return fail(error); }
  }
);

server.tool(
  'browser_end',
  'Close the retained browser session.',
  {},
  async () => {
    try { return result(await agent.end()); } catch (error) { return fail(error); }
  }
);

const shutdown = async () => {
  try { await agent.end(); } finally { process.exit(0); }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
