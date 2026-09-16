const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function parseSessionStatus(body = '') {
  const m = body.match(/<!--\s*browser-session-status:([^\s]+)\s*-->[\s\S]*?```json\s*([\s\S]*?)```/i);
  if (!m) return null;
  try { return { markerSessionId: m[1], ...JSON.parse(m[2]) }; } catch { return null; }
}

export function parseSessionResponse(body = '') {
  const m = body.match(/<!--\s*browser-session-response:([^:\s]+):([^\s]+)\s*-->[\s\S]*?```json\s*([\s\S]*?)```/i);
  if (!m) return null;
  try { return { markerSessionId: m[1], commandId: m[2], ...JSON.parse(m[3]) }; } catch { return null; }
}

export function commandBody(sessionId, commandId, command) {
  return `<!-- browser-session-command:${sessionId}:${commandId} -->\n\`\`\`json\n${JSON.stringify(command)}\n\`\`\``;
}

export class BrowserSessionClient {
  constructor({ repo, issueNumber, token, owner, pollMs = 2000, timeoutMs = 120000, fetchImpl = fetch }) {
    if (!repo || !issueNumber || !token) throw new Error('repo, issueNumber and token are required');
    this.repo = repo;
    this.issueNumber = Number(issueNumber);
    this.token = token;
    this.owner = owner || repo.split('/')[0];
    this.pollMs = pollMs;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.api = `https://api.github.com/repos/${repo}`;
    this.headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    this.sessionId = null;
    this.sequence = 0;
  }

  async gh(path, options = {}) {
    const r = await this.fetch(this.api + path, { ...options, headers: { ...this.headers, ...(options.headers || {}) } });
    if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }

  async comments() {
    return this.gh(`/issues/${this.issueNumber}/comments?per_page=100&sort=created&direction=asc`);
  }

  async detectSession({ requireReady = true } = {}) {
    const comments = await this.comments();
    const statuses = comments
      .filter(c => c.user?.login === this.owner)
      .map(c => ({ comment: c, status: parseSessionStatus(c.body || '') }))
      .filter(x => x.status && x.status.sessionId === x.status.markerSessionId)
      .sort((a, b) => Number(b.comment.id) - Number(a.comment.id));
    const match = statuses.find(x => !requireReady || ['ready', 'busy'].includes(x.status.state));
    if (!match) return null;
    this.sessionId = String(match.status.sessionId);
    return match.status;
  }

  async waitForSession({ timeoutMs = this.timeoutMs } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.detectSession();
      if (status) return status;
      await sleep(this.pollMs);
    }
    throw new Error(`Timed out waiting for Browser Session on issue #${this.issueNumber}`);
  }

  nextCommandId(action = 'command') {
    this.sequence += 1;
    return `client-${Date.now()}-${this.sequence}-${String(action).replace(/[^a-z0-9_-]/gi, '')}`;
  }

  async command(command, { timeoutMs = this.timeoutMs } = {}) {
    if (!this.sessionId) await this.waitForSession({ timeoutMs });
    const commandId = this.nextCommandId(command.action);
    const body = commandBody(this.sessionId, commandId, command);
    await this.gh(`/issues/${this.issueNumber}/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body }) });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const comments = await this.comments();
      for (const c of comments) {
        if (c.user?.login !== this.owner) continue;
        const response = parseSessionResponse(c.body || '');
        if (response?.markerSessionId === this.sessionId && response.commandId === commandId) return response;
      }
      await sleep(this.pollMs);
    }
    throw new Error(`Timed out waiting for response ${this.sessionId}:${commandId}`);
  }

  start(url) { return this.command({ action: 'start', url }); }
  getPage() { return this.command({ action: 'getPage' }); }
  goto(url) { return this.command({ action: 'goto', url }); }
  fill(elementId, text) { return this.command({ action: 'fill', elementId, text }); }
  click(elementId) { return this.command({ action: 'click', elementId }); }
  press(key) { return this.command({ action: 'press', key }); }
  scroll(direction, amount) { return this.command({ action: 'scroll', direction, amount }); }
  end() { return this.command({ action: 'end' }); }
}
