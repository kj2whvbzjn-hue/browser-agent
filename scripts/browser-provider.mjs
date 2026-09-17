import { chromium } from 'playwright';

function viewportFor(options) {
  return options.viewport || { width: 1440, height: 900 };
}

export class LaunchBrowserProvider {
  constructor(options = {}) { this.options = options; }

  async connect() {
    const headless = this.options.headless ?? (process.env.BROWSER_HEADLESS !== 'false');
    const viewport = viewportFor(this.options);
    const userDataDir = this.options.userDataDir || process.env.BROWSER_USER_DATA_DIR;
    const browserEngine = this.options.browserEngine || process.env.BROWSER_ENGINE || 'chromium';
    if (!['chromium', 'chrome'].includes(browserEngine)) throw new Error(`Unsupported BROWSER_ENGINE: ${browserEngine}`);
    const launchOptions = { headless };
    if (browserEngine === 'chrome') launchOptions.channel = 'chrome';

    if (userDataDir) {
      const context = await chromium.launchPersistentContext(userDataDir, { ...launchOptions, viewport });
      const page = context.pages()[0] || await context.newPage();
      return { browser: null, context, page, ownership: 'owned-context', mode: 'launch' };
    }

    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    return { browser, context, page, ownership: 'owned-browser', mode: 'launch' };
  }
}

export class AttachBrowserProvider {
  constructor(options = {}) { this.options = options; }

  async connect() {
    const endpointURL = this.options.cdpEndpoint || process.env.BROWSER_CDP_ENDPOINT;
    if (!endpointURL) throw new Error('BROWSER_CDP_ENDPOINT is required when BROWSER_CONNECTION_MODE=attach');
    const browser = await chromium.connectOverCDP(endpointURL);
    const context = browser.contexts()[0];
    if (!context) throw new Error('Attached browser has no browser context');
    const pages = context.pages();
    const preferredUrl = this.options.preferredUrl || process.env.BROWSER_EXISTING_PREFERRED_URL;
    const page = (preferredUrl ? pages.find(candidate => candidate.url().includes(preferredUrl)) : null) || pages.find(candidate => candidate.url() !== 'about:blank') || pages[0];
    if (!page) throw new Error('Attached browser has no page');
    return { browser, context, page, ownership: 'attached', mode: 'attach' };
  }
}

export function createBrowserProvider(options = {}) {
  const mode = options.connectionMode || process.env.BROWSER_CONNECTION_MODE || 'launch';
  if (mode === 'launch') return new LaunchBrowserProvider(options);
  if (mode === 'attach' || mode === 'existing') return new AttachBrowserProvider(options);
  throw new Error(`Unsupported BROWSER_CONNECTION_MODE: ${mode}`);
}
