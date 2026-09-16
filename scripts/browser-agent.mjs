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
    if (this.context) return this.getPage();
    const headless = this.options.headless ?? (process.env.BROWSER_HEADLESS !== 'false');
    const userDataDir = this.options.userDataDir || process.env.BROWSER_USER_DATA_DIR;
    if (userDataDir) {
      this.context = await chromium.launchPersistentContext(userDataDir, { headless, viewport: this.options.viewport || { width: 1440, height: 900 } });
      this.page = this.context.pages()[0] || await this.context.newPage();
    } else {
      this.browser = await chromium.launch({ headless });
      this.context = await this.browser.newContext({ viewport: this.options.viewport || { width: 1440, height: 900 } });
      this.page = await this.context.newPage();
    }
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
    for (const element of state.elements) this.elementMap.set(element.id, element);
    return state;
  }

  locatorFor(elementId) {
    this.requirePage();
    const match = /^g(\d+)-e(\d+)$/.exec(String(elementId));
    if (!match) throw new Error(`Invalid elementId: ${elementId}`);
    if (Number(match[1]) !== this.generation) throw new Error(`Stale elementId ${elementId}; call getPage() again`);
    const element = this.elementMap.get(elementId);
    if (!element) throw new Error(`Unknown elementId: ${elementId}`);
    if (element.name) return this.page.locator(`[name=${JSON.stringify(element.name)}]`).first();
    if (element.role && element.label) return this.page.getByRole(element.role, { name: element.label, exact: true }).first();
    if (element.role && element.text) return this.page.getByRole(element.role, { name: element.text, exact: true }).first();
    if (element.type) return this.page.locator(`[type=${JSON.stringify(element.type)}]`).first();
    if (Number.isInteger(element.domIndex)) {
      const selector = ['button','input','textarea','select','a[href]','[role="button"]','[role="link"]','[role="textbox"]','[role="checkbox"]','[role="radio"]','[role="combobox"]','[contenteditable="true"]'].join(',');
      return this.page.locator(selector).nth(element.domIndex);
    }
    throw new Error(`Element ${elementId} has no usable locator; call getPage() again`);
  }

  async clickWithFallback(elementId) {
    const element = this.elementMap.get(elementId);
    const primary = this.locatorFor(elementId);
    try { await primary.click({ timeout: 4000 }); return; }
    catch (primaryError) {
      if (!element?.bounds) throw primaryError;
      const { x, y, width, height } = element.bounds;
      if (!(width > 0 && height > 0)) throw primaryError;
      await this.page.mouse.click(x + width / 2, y + height / 2);
    }
  }

  async fill(elementId, text) { const locator=this.locatorFor(elementId); await locator.fill(String(text),{timeout:10000}); return {ok:true,action:'fill',elementId,url:this.page.url()}; }
  async click(elementId) { await this.clickWithFallback(elementId); return {ok:true,action:'click',elementId,url:this.page.url()}; }
  async press(key) { this.requirePage(); await this.page.keyboard.press(String(key)); return {ok:true,action:'press',key,url:this.page.url()}; }
  async scroll(direction='down',amount=700) { this.requirePage(); const dy=direction==='up'?-Math.abs(amount):Math.abs(amount); await this.page.mouse.wheel(0,dy); return {ok:true,action:'scroll',direction,amount,url:this.page.url()}; }
  async screenshot(path) { this.requirePage(); await this.page.screenshot({path,fullPage:false}); return {ok:true,path,url:this.page.url()}; }
  async end() {
    if (this.context) await this.context.close();
    else if (this.browser) await this.browser.close();
    this.browser=this.context=this.page=null;
    this.elementMap.clear();
    return {ok:true};
  }
  requirePage() { if(!this.page) throw new Error('Browser is not started'); }
}
