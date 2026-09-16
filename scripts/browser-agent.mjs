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
    this.connectionMode = null;
    this.ownsBrowser = false;
    this.ownsContext = false;
  }

  requestedConnectionMode() {
    return this.options.connectionMode || process.env.BROWSER_CONNECTION_MODE || 'launch';
  }

  async launch() {
    if (this.context) return;
    const mode = this.requestedConnectionMode();
    const headless = this.options.headless ?? (process.env.BROWSER_HEADLESS !== 'false');
    const viewport = this.options.viewport || { width: 1440, height: 900 };
    const userDataDir = this.options.userDataDir || process.env.BROWSER_USER_DATA_DIR;

    this.connectionMode = mode;
    this.ownsBrowser = false;
    this.ownsContext = false;

    if (mode === 'existing') {
      const endpointURL = this.options.cdpEndpoint || process.env.BROWSER_CDP_ENDPOINT;
      if (!endpointURL) throw new Error('BROWSER_CDP_ENDPOINT is required when BROWSER_CONNECTION_MODE=existing');
      this.browser = await chromium.connectOverCDP(endpointURL);
      this.context = this.browser.contexts()[0];
      if (!this.context) throw new Error('Existing browser has no attachable browser context');
      const pages = this.context.pages();
      const preferredUrl = this.options.preferredUrl || process.env.BROWSER_EXISTING_PREFERRED_URL;
      this.page = (preferredUrl ? pages.find(page => page.url().includes(preferredUrl)) : null) || pages.find(page => page.url() !== 'about:blank') || pages[0];
      if (!this.page) throw new Error('Existing browser has no attachable page');
    } else if (mode === 'persistent') {
      if (!userDataDir) throw new Error('BROWSER_USER_DATA_DIR is required when BROWSER_CONNECTION_MODE=persistent');
      this.context = await chromium.launchPersistentContext(userDataDir, { headless, viewport });
      this.ownsContext = true;
      this.page = this.context.pages()[0] || await this.context.newPage();
    } else if (mode === 'launch') {
      if (userDataDir) {
        this.context = await chromium.launchPersistentContext(userDataDir, { headless, viewport });
        this.ownsContext = true;
        this.page = this.context.pages()[0] || await this.context.newPage();
      } else {
        this.browser = await chromium.launch({ headless });
        this.ownsBrowser = true;
        this.context = await this.browser.newContext({ viewport });
        this.ownsContext = true;
        this.page = await this.context.newPage();
      }
    } else {
      throw new Error(`Unknown BROWSER_CONNECTION_MODE: ${mode}`);
    }

    this.page.setDefaultTimeout(Number(process.env.BROWSER_ACTION_TIMEOUT_MS || 10000));
    this.page.setDefaultNavigationTimeout(Number(process.env.BROWSER_NAVIGATION_TIMEOUT_MS || 30000));
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

  async goto(url) { this.requirePage(); await this.page.goto(url, { waitUntil: 'domcontentloaded' }); return this.getPage(); }
  async getPage() { this.requirePage(); this.generation += 1; const state=await observePage(this.page,this.generation); this.elementMap.clear(); for(const element of state.elements)this.elementMap.set(element.id,element); return state; }
  locatorFor(elementId) { this.requirePage(); const match=/^g(\d+)-e(\d+)$/.exec(String(elementId)); if(!match)throw new Error(`Invalid elementId: ${elementId}`); if(Number(match[1])!==this.generation)throw new Error(`Stale elementId ${elementId}; call getPage() again`); const element=this.elementMap.get(elementId); if(!element)throw new Error(`Unknown elementId: ${elementId}`); if(element.name)return this.page.locator(`[name=${JSON.stringify(element.name)}]`).first(); if(element.role&&element.label)return this.page.getByRole(element.role,{name:element.label,exact:true}).first(); if(element.role&&element.text)return this.page.getByRole(element.role,{name:element.text,exact:true}).first(); if(element.type)return this.page.locator(`[type=${JSON.stringify(element.type)}]`).first(); if(Number.isInteger(element.domIndex)){const selector=['button','input','textarea','select','a[href]','[role="button"]','[role="link"]','[role="textbox"]','[role="checkbox"]','[role="radio"]','[role="combobox"]','[contenteditable="true"]'].join(',');return this.page.locator(selector).nth(element.domIndex);} throw new Error(`Element ${elementId} has no usable locator; call getPage() again`); }
  async clickWithFallback(elementId) { const element=this.elementMap.get(elementId),primary=this.locatorFor(elementId); try{await primary.click({timeout:4000});return;}catch(primaryError){if(!element?.bounds)throw primaryError;const{x,y,width,height}=element.bounds;if(!(width>0&&height>0))throw primaryError;await this.page.mouse.click(x+width/2,y+height/2);} }
  async fill(elementId,text){const locator=this.locatorFor(elementId);await locator.fill(String(text),{timeout:10000});return{ok:true,action:'fill',elementId,url:this.page.url()};}
  async click(elementId){await this.clickWithFallback(elementId);return{ok:true,action:'click',elementId,url:this.page.url()};}
  async press(key){this.requirePage();await this.page.keyboard.press(String(key));return{ok:true,action:'press',key,url:this.page.url()};}
  async scroll(direction='down',amount=700){this.requirePage();const dy=direction==='up'?-Math.abs(amount):Math.abs(amount);await this.page.mouse.wheel(0,dy);return{ok:true,action:'scroll',direction,amount,url:this.page.url()};}
  async screenshot(path){this.requirePage();await this.page.screenshot({path,fullPage:false});return{ok:true,path,url:this.page.url()};}

  async reset({ relaunch = false } = {}) {
    const context=this.context,browser=this.browser,ownsContext=this.ownsContext,ownsBrowser=this.ownsBrowser;
    this.browser=null; this.context=null; this.page=null; this.generation=0; this.elementMap.clear(); this.ownsBrowser=false; this.ownsContext=false;

    // Existing-browser mode is deliberately non-destructive: never close a browser or context we did not create.
    let closePromise=Promise.resolve();
    if (ownsContext && context) closePromise=context.close();
    else if (ownsBrowser && browser) closePromise=browser.close();

    const closeTimeoutMs=Number(process.env.BROWSER_RESET_TIMEOUT_MS||8000);
    let timer;
    try { await Promise.race([closePromise.catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,closeTimeoutMs);})]); }
    finally { clearTimeout(timer); }
    if (relaunch) { await this.launch(); if (this.connectionMode !== 'existing') await this.page.goto('about:blank'); return this.getPage(); }
    return {ok:true,detached:!ownsContext&&!ownsBrowser};
  }

  async recover(){return this.reset({relaunch:true});}
  async end(){return this.reset({relaunch:false});}
  requirePage(){if(!this.page)throw new Error('Browser is not started');}
}
