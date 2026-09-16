import { BrowserAgent } from './browser-agent.mjs';

const agent = new BrowserAgent({ headless: process.env.BROWSER_HEADLESS !== 'false' });

async function execute(command) {
  switch (command.action) {
    case 'start': return agent.start(command.url);
    case 'getPage': return agent.getPage();
    case 'goto': return agent.goto(command.url);
    case 'fill': return agent.fill(command.elementId, command.text);
    case 'click': return agent.click(command.elementId);
    case 'press': return agent.press(command.key);
    case 'scroll': return agent.scroll(command.direction, command.amount);
    case 'end': return agent.end();
    default: throw new Error(`Unknown action: ${command.action}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async chunk => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const command = JSON.parse(line);
      const value = await execute(command);
      process.stdout.write(JSON.stringify({ id: command.id ?? null, ok: true, value }) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, error: String(error?.stack || error) }) + '\n');
    }
  }
});

async function shutdown() {
  await agent.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
