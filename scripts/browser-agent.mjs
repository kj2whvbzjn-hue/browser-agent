import { chromium } from 'playwright';
import { observePage } from './page-observer.mjs';

export class BrowserAgent {
  constructor(options = {}) {
    this.options = options;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.generation = 0;
    this.elementMap = new Map();
  }

  async start(url) {
    if (this.browser) return this.getPage();
    this.browser = await chromium.launch({ headless: this.options.headless ?? (process.env.BROWSER_HEADLESS !== 'false') });
    this.context = await this.browser.newContext({ viewport: this.options.viewport || { width: 1440, height: 900 } });
    this.page = await this.context.newPage();
    if (url) await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return this.getPage();
  }

  async goto(url) {
    this.requirePage();
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return this.getPage();
  }

  async getPage() {
    this.requirePage();
    this.generation += 1;
    const state = await observePage(this.page, this.generation);
    this.elementMap.clear();
    for (let i = 0; i < state.elements.length; i++) {
      this.elementMap.set(state.elements[i].id, i);
    }
    return state;
  }

  locatorFor(elementId) {
    this.requirePage();
    const match = /^g(\d+)-e(\d+)$/.exec(String(elementId));
    if (!match) throw new Error(`Invalid elementId: ${elementId}`);
    const generation = Number(match[1]);
    const index = Number(match[2]) - 1;
    if (generation !== this.generation) throw new Error(`Stale elementId ${elementId}; call getPage() again`);
    if (!this.elementMap.has(elementId)) throw new Error(`Unknown elementId: ${elementId}`);
    const selector = 'button, input, textarea, select, a[href], [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [role="combobox"], [contenteditable="true"]';
    return this.page.locator(selector).filter({ visible: true }).nth(index);
  }

  async fill(elementId, text) {
    const locator = this.locatorFor(elementId);
    await locator.fill(String(text), { timeout: 10000 });
    return { ok: true, action: 'fill', elementId, url: this.page.url() };
  }

  async click(elementId) {
    const locator = this.locatorFor(elementId);
    await locator.click({ timeout: 10000 });
    return { ok: true, action: 'click', elementId, url: this.page.url() };
  }

  async press(key) {
    this.requirePage();
    await this.page.keyboard.press(String(key));
    return { ok: true, action: 'press', key, url: this.page.url() };
  }

  async scroll(direction = 'down', amount = 700) {
    this.requirePage();
    const dy = direction === 'up' ? -Math.abs(amount) : Math.abs(amount);
    await this.page.mouse.wheel(0, dy);
    return { ok: true, action: 'scroll', direction, amount, url: this.page.url() };
  }

  async screenshot(path) {
    this.requirePage();
    await this.page.screenshot({ path, fullPage: false });
    return { ok: true, path, url: this.page.url() };
  }

  async end() {
    if (this.browser) await this.browser.close();
    this.browser = this.context = this.page = null;
    this.elementMap.clear();
    return { ok: true };
  }

  requirePage() {
    if (!this.page) throw new Error('Browser is not started');
  }
}
