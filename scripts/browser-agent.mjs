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

  async goto(url) { this.requirePage(); await this.page.goto(url, { waitUntil: 'domcontentloaded' }); return this.getPage(); }
  async getPage() { this.requirePage(); this.generation += 1; const state=await observePage(this.page,this.generation); this.elementMap.clear(); for(const element of state.elements)this.elementMap.set(element.id,element); return state; }
  async newPage(url) { if(!this.context)throw new Error('Browser is not started'); this.page=this.configurePage(await this.context.newPage()); this.generation=0; this.elementMap.clear(); if(url)await this.page.goto(url,{waitUntil:'domcontentloaded'}); const page=await this.getPage(); return{pageIndex:this.context.pages().indexOf(this.page),page}; }
  async listPages() { if(!this.context)throw new Error('Browser is not started'); return{pages:await Promise.all(this.context.pages().map(async(page,index)=>({index,url:page.url(),title:await page.title().catch(()=>''),active:page===this.page})))}; }
  async switchPage(index) { if(!this.context)throw new Error('Browser is not started'); const pages=this.context.pages(); const i=Number(index); if(!Number.isInteger(i)||i<0||i>=pages.length)throw new Error(`Invalid page index: ${index}`); this.page=this.configurePage(pages[i]); this.generation=0; this.elementMap.clear(); await this.page.bringToFront().catch(()=>{}); const page=await this.getPage(); return{pageIndex:i,page}; }
  locatorFor(elementId) { this.requirePage(); const match=/^g(\d+)-e(\d+)$/.exec(String(elementId)); if(!match)throw new Error(`Invalid elementId: ${elementId}`); if(Number(match[1])!==this.generation)throw new Error(`Stale elementId ${elementId}; call getPage() again`); const element=this.elementMap.get(elementId); if(!element)throw new Error(`Unknown elementId: ${elementId}`); const selector=['button','input','textarea','select','a[href]','[role="button"]','[role="link"]','[role="textbox"]','[role="checkbox"]','[role="radio"]','[role="combobox"]','[contenteditable="true"]'].join(','); if(Number.isInteger(element.domIndex))return this.page.locator(selector).nth(element.domIndex); if(element.role&&element.label)return this.page.getByRole(element.role,{name:element.label,exact:true}).first(); if(element.role&&element.text)return this.page.getByRole(element.role,{name:element.text,exact:true}).first(); if(element.name)return this.page.locator(`[name=${JSON.stringify(element.name)}]`).filter({visible:true}).first(); if(element.type)return this.page.locator(`[type=${JSON.stringify(element.type)}]`).filter({visible:true}).first(); throw new Error(`Element ${elementId} has no usable locator; call getPage() again`); }
  async clickWithFallback(elementId) { const element=this.elementMap.get(elementId),primary=this.locatorFor(elementId); try{await primary.click({timeout:4000});return;}catch(primaryError){if(!element?.bounds)throw primaryError;const{x,y,width,height}=element.bounds;if(!(width>0&&height>0))throw primaryError;await this.page.mouse.click(x+width/2,y+height/2);} }
  async fill(elementId,text){const locator=this.locatorFor(elementId);await locator.fill(String(text),{timeout:10000});return{ok:true,action:'fill',elementId,url:this.page.url()};}
  async click(elementId){await this.clickWithFallback(elementId);return{ok:true,action:'click',elementId,url:this.page.url()};}
  async press(key){this.requirePage();await this.page.keyboard.press(String(key));return{ok:true,action:'press',key,url:this.page.url()};}
  async scroll(direction='down',amount=700){this.requirePage();const before=await this.page.evaluate(()=>({x:scrollX,y:scrollY,height:innerHeight}));const requested=direction==='up'?-Math.abs(Number(amount)):Math.abs(Number(amount));await this.page.mouse.wheel(0,requested);await this.page.waitForTimeout(20);const after=await this.page.evaluate(()=>({x:scrollX,y:scrollY,height:innerHeight}));return{ok:true,action:'scroll',direction,amount:Math.abs(Number(amount)),requestedDeltaY:requested,beforeY:before.y,afterY:after.y,deltaY:after.y-before.y,viewportHeight:after.height,url:this.page.url()};}
  async setViewport(width,height){this.requirePage();const w=Number(width),h=Number(height);if(!Number.isInteger(w)||!Number.isInteger(h)||w<240||w>3840||h<320||h>2160)throw new Error('setViewport requires integer width 240-3840 and height 320-2160');await this.page.setViewportSize({width:w,height:h});await this.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const page=await this.getPage();return{ok:true,action:'setViewport',width:w,height:h,page};}
  async screenshot(path){this.requirePage();await this.page.screenshot({path,fullPage:false});return{ok:true,path,url:this.page.url()};}

  async reset({ relaunch = false } = {}) {
    const context=this.context,browser=this.browser;
    this.browser=null; this.context=null; this.page=null; this.generation=0; this.elementMap.clear();
    const closeTarget=browser||context;
    const closePromise=closeTarget?closeTarget.close():Promise.resolve();
    const closeTimeoutMs=Number(process.env.BROWSER_RESET_TIMEOUT_MS||8000);
    let timer;
    try { await Promise.race([closePromise.catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,closeTimeoutMs);})]); }
    finally { clearTimeout(timer); }
    if (relaunch) { await this.launch(); await this.page.goto('about:blank'); return this.getPage(); }
    return {ok:true};
  }

  async recover(){return this.reset({relaunch:true});}
  async end(){return this.reset({relaunch:false});}
  requirePage(){if(!this.page)throw new Error('Browser is not started');}
}
