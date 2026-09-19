import { chromium } from 'playwright';
import { diffObservations, observePage, resolveObservedElement } from './page-observer.mjs';

export class BrowserAgent {
  constructor(options = {}) {
    this.options = options;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.generation = 0;
    this.elementMap = new Map();
    this.elementRefs = new Map();
    this.lastObservation = null;
    this.observationConsumed = false;
  }

  configurePage(page) {
    page.setDefaultTimeout(Number(process.env.BROWSER_ACTION_TIMEOUT_MS || 10000));
    page.setDefaultNavigationTimeout(Number(process.env.BROWSER_NAVIGATION_TIMEOUT_MS || 30000));
    return page;
  }

  async launch() {
    if (this.context) return;
    const headless = this.options.headless ?? (process.env.BROWSER_HEADLESS !== 'false');
    const userDataDir = this.options.userDataDir || process.env.BROWSER_USER_DATA_DIR;
    if (userDataDir) {
      this.context = await chromium.launchPersistentContext(userDataDir, { headless, viewport: this.options.viewport || { width: 1440, height: 900 } });
      this.page = this.configurePage(this.context.pages()[0] || await this.context.newPage());
    } else {
      this.browser = await chromium.launch({ headless });
      this.context = await this.browser.newContext({ viewport: this.options.viewport || { width: 1440, height: 900 } });
      this.page = this.configurePage(await this.context.newPage());
    }
  }

  async start(url) {
    if (this.context) return this.getPage();
    try {
      await this.launch();
      if (url) await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      return this.getPage();
    } catch (error) {
      await this.reset({ relaunch: false }).catch(() => {});
      throw error;
    }
  }

  async goto(url) {
    this.requirePage();
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    return this.getPage();
  }

  async getPage() {
    this.requirePage();
    this.generation += 1;
    const previous = this.lastObservation;
    const { state, internalRefs } = await observePage(this.page, this.generation);
    state.changesSincePreviousObservation = diffObservations(previous, state);
    this.elementMap.clear();
    this.elementRefs.clear();
    for (const element of state.elements) this.elementMap.set(element.id, element);
    for (const [id, ref] of internalRefs) this.elementRefs.set(id, ref);
    this.lastObservation = state;
    this.observationConsumed = false;
    return state;
  }

  async newPage(url) {
    if (!this.context) throw new Error('Browser is not started');
    this.page = this.configurePage(await this.context.newPage());
    this.generation = 0;
    this.elementMap.clear();
    this.elementRefs.clear();
    this.lastObservation = null;
    this.observationConsumed = false;
    if (url) await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    const page = await this.getPage();
    return { pageIndex: this.context.pages().indexOf(this.page), page };
  }

  async listPages() {
    if (!this.context) throw new Error('Browser is not started');
    return { pages: await Promise.all(this.context.pages().map(async (page, index) => ({ index, url: page.url(), title: await page.title().catch(() => ''), active: page === this.page }))) };
  }

  async switchPage(index) {
    if (!this.context) throw new Error('Browser is not started');
    const pages = this.context.pages();
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= pages.length) throw new Error(`Invalid page index: ${index}`);
    this.page = this.configurePage(pages[i]);
    this.generation = 0;
    this.elementMap.clear();
    this.elementRefs.clear();
    this.lastObservation = null;
    this.observationConsumed = false;
    await this.page.bringToFront().catch(() => {});
    const page = await this.getPage();
    return { pageIndex: i, page };
  }

  validateElementId(elementId) {
    this.requirePage();
    const match = /^g(\d+)-e(\d+)$/.exec(String(elementId));
    if (!match) throw new Error(`Invalid elementId: ${elementId}`);
    if (Number(match[1]) !== this.generation || this.observationConsumed) throw new Error(`Stale elementId ${elementId}; call getPage() again`);
    const element = this.elementMap.get(elementId);
    if (!element) throw new Error(`Unknown elementId: ${elementId}`);
    return element;
  }

  locatorFor(elementId) {
    const element = this.validateElementId(elementId);
    const ref = this.elementRefs.get(elementId);
    const frame = ref?.frame || this.page.mainFrame();
    const name = element.accessibleName || element.label || element.text;
    let fallback = null;
    if (element.role && name) fallback = frame.getByRole(element.role, { name, exact: true }).first();
    else if (element.attributes?.id) fallback = frame.locator(`[id=${JSON.stringify(element.attributes.id)}]`).first();
    else if (element.name) fallback = frame.locator(`[name=${JSON.stringify(element.name)}]`).first();
    else if (element.type) fallback = frame.locator(`[type=${JSON.stringify(element.type)}]`).first();

    const withLiveHandle = async callback => {
      const handle = ref ? await resolveObservedElement(ref) : null;
      if (handle) {
        try { return await callback(handle); }
        finally { await handle.dispose().catch(() => {}); }
      }
      if (!fallback) throw new Error(`Element ${elementId} has no usable live reference; call getPage() again`);
      return callback(fallback);
    };

    return {
      click: options => withLiveHandle(target => target.click(options)),
      fill: (text, options) => withLiveHandle(target => target.fill(text, options)),
      boundingBox: () => withLiveHandle(target => typeof target.boundingBox === 'function' ? target.boundingBox() : null)
    };
  }

  async observeForVerification() {
    try {
      const { state } = await observePage(this.page, this.generation, { registerRefs: false, includeAccessibility: false });
      return state;
    } catch {
      return null;
    }
  }

  async verifyAction(before = this.lastObservation) {
    const settleMs = Math.max(0, Number(process.env.BROWSER_ACTION_VERIFY_SETTLE_MS || 80));
    if (settleMs) await this.page.waitForTimeout(settleMs).catch(() => {});
    const after = await this.observeForVerification();
    return after ? diffObservations(before, after) : null;
  }

  async clickWithFallback(elementId) {
    const before = this.lastObservation;
    const element = this.validateElementId(elementId);
    const primary = this.locatorFor(elementId);
    const page = this.page;
    const mainFrame = page.mainFrame();
    let navigationRequest = null;
    let navigationCommitted = false;
    let resolveRequest;
    let resolveCommit;
    const requestSeen = new Promise(resolve => { resolveRequest = resolve; });
    const commitSeen = new Promise(resolve => { resolveCommit = resolve; });
    const onRequest = request => {
      if (navigationRequest || !request.isNavigationRequest()) return;
      try {
        if (request.frame() === mainFrame) { navigationRequest = request; resolveRequest(request); }
      } catch {}
    };
    const onNavigated = frame => {
      if (frame === mainFrame && !navigationCommitted) { navigationCommitted = true; resolveCommit(frame); }
    };
    page.on('request', onRequest);
    page.on('framenavigated', onNavigated);
    const waitForCommit = async () => {
      if (navigationCommitted) return;
      const timeout = Math.max(1, Number(process.env.BROWSER_NAVIGATION_TIMEOUT_MS || 30000));
      let timer;
      try {
        await Promise.race([
          commitSeen,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Navigation did not commit within ${timeout}ms after click dispatch`)), timeout); })
        ]);
      } finally { clearTimeout(timer); }
    };
    try {
      let primaryError = null;
      try {
        await primary.click({ timeout: 4000, noWaitAfter: true });
      } catch (error) {
        primaryError = error;
      }
      if (!primaryError) {
        let request = navigationRequest;
        if (!request) {
          let timer;
          try {
            request = await Promise.race([
              requestSeen,
              new Promise(resolve => { timer = setTimeout(() => resolve(null), 25); })
            ]);
          } finally { clearTimeout(timer); }
        }
        if (request) await waitForCommit();
        return { before, outcome: await this.verifyAction(before) };
      }
      if (navigationRequest) {
        await waitForCommit();
        return { before, outcome: await this.verifyAction(before) };
      }
      let box = typeof primary.boundingBox === 'function' ? await primary.boundingBox().catch(() => null) : null;
      if (!box && element?.bounds) box = element.bounds;
      if (!box || !(box.width > 0 && box.height > 0)) throw primaryError;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return { before, outcome: await this.verifyAction(before) };
    } finally {
      page.off('request', onRequest);
      page.off('framenavigated', onNavigated);
    }
  }

  async fill(elementId, text) {
    const before = this.lastObservation;
    const target = this.locatorFor(elementId);
    await target.fill(String(text), { timeout: 10000 });
    const outcome = await this.verifyAction(before);
    this.observationConsumed = true;
    return { ok: true, action: 'fill', elementId, url: this.page.url(), outcome };
  }

  async click(elementId) {
    const before = this.lastObservation;
    const result = await this.clickWithFallback(elementId);
    const outcome = result?.outcome ?? await this.verifyAction(before);
    this.observationConsumed = true;
    return { ok: true, action: 'click', elementId, url: this.page.url(), outcome };
  }

  async press(key) {
    this.requirePage();
    const before = this.lastObservation;
    await this.page.keyboard.press(String(key));
    const outcome = await this.verifyAction(before);
    this.observationConsumed = true;
    return { ok: true, action: 'press', key, url: this.page.url(), outcome };
  }

  async typeText(text) {
    this.requirePage();
    const before = this.lastObservation;
    await this.page.keyboard.insertText(String(text));
    const outcome = await this.verifyAction(before);
    this.observationConsumed = true;
    return { ok: true, action: 'typeText', length: String(text).length, url: this.page.url(), outcome };
  }

  async clickAt(x, y) {
    this.requirePage();
    const before = this.lastObservation;
    const px = Number(x), py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('clickAt requires numeric args.x and args.y');
    await this.page.mouse.click(px, py);
    const outcome = await this.verifyAction(before);
    this.observationConsumed = true;
    return { ok: true, action: 'clickAt', x: px, y: py, url: this.page.url(), outcome };
  }

  async clickText(text, exact = true) {
    this.requirePage();
    const before = this.lastObservation;
    const value = String(text);
    await this.page.getByText(value, { exact: Boolean(exact) }).filter({ visible: true }).first().click({ timeout: 10000 });
    const outcome = await this.verifyAction(before);
    this.observationConsumed = true;
    return { ok: true, action: 'clickText', text: value, exact: Boolean(exact), url: this.page.url(), outcome };
  }

  async scroll(direction = 'down', amount = 700) {
    this.requirePage();
    const beforeObservation = this.lastObservation;
    const before = await this.page.evaluate(() => ({ x: scrollX, y: scrollY, height: innerHeight }));
    const requested = direction === 'up' ? -Math.abs(Number(amount)) : Math.abs(Number(amount));
    await this.page.mouse.wheel(0, requested);
    await this.page.waitForTimeout(20);
    const after = await this.page.evaluate(() => ({ x: scrollX, y: scrollY, height: innerHeight }));
    const outcome = await this.verifyAction(beforeObservation);
    this.observationConsumed = true;
    return {
      ok: true,
      action: 'scroll',
      direction,
      amount: Math.abs(Number(amount)),
      requestedDeltaY: requested,
      beforeY: before.y,
      afterY: after.y,
      deltaY: after.y - before.y,
      viewportHeight: after.height,
      url: this.page.url(),
      outcome
    };
  }

  async setViewport(width, height) {
    this.requirePage();
    const w = Number(width), h = Number(height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 240 || w > 3840 || h < 320 || h > 2160) throw new Error('setViewport requires integer width 240-3840 and height 320-2160');
    await this.page.setViewportSize({ width: w, height: h });
    await this.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const page = await this.getPage();
    return { ok: true, action: 'setViewport', width: w, height: h, page };
  }

  async screenshot(path) {
    this.requirePage();
    await this.page.screenshot({ path, fullPage: false });
    return { ok: true, path, url: this.page.url() };
  }

  async reset({ relaunch = false } = {}) {
    const context = this.context, browser = this.browser;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.generation = 0;
    this.elementMap.clear();
    this.elementRefs.clear();
    this.lastObservation = null;
    this.observationConsumed = false;
    const closeTarget = browser || context;
    const closePromise = closeTarget ? closeTarget.close() : Promise.resolve();
    const closeTimeoutMs = Number(process.env.BROWSER_RESET_TIMEOUT_MS || 8000);
    let timer;
    try { await Promise.race([closePromise.catch(() => {}), new Promise(resolve => { timer = setTimeout(resolve, closeTimeoutMs); })]); }
    finally { clearTimeout(timer); }
    if (relaunch) { await this.launch(); await this.page.goto('about:blank'); return this.getPage(); }
    return { ok: true };
  }

  async recover() { return this.reset({ relaunch: true }); }
  async end() { return this.reset({ relaunch: false }); }
  requirePage() { if (!this.page) throw new Error('Browser is not started'); }
}
