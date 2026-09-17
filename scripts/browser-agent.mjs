import { observePage } from './page-observer.mjs';
import { createBrowserProvider } from './browser-provider.mjs';

export class BrowserAgent {
  constructor(options = {}) {
    this.options = options;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.generation = 0;
    this.elementMap = new Map();
    this.ownership = null;
    this.connectionMode = null;
  }

  async launch() {
    if (this.context) return;
    const connection = await createBrowserProvider(this.options).connect();
    this.browser = connection.browser;
    this.context = connection.context;
    this.page = connection.page;
    this.ownership = connection.ownership;
    this.connectionMode = connection.mode;
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
  locatorFor(elementId) { this.requirePage(); const match=/^g(\d+)-e(\d+)$/.exec(String(elementId)); if(!match)throw new Error(`Invalid elementId: ${elementId}`); if(Number(match[1])!==this.generation)throw new Error(`Stale elementId ${elementId}; call getPage() again`); const element=this.elementMap.get(elementId); if(!element)throw new Error(`Unknown elementId: ${elementId}`); const selector=['button','input','textarea','select','a[href]','[role="button"]','[role="link"]','[role="textbox"]','[role="checkbox"]','[role="radio"]','[role="combobox"]','[contenteditable="true"]'].join(','); if(Number.isInteger(element.domIndex))return this.page.locator(selector).nth(element.domIndex); if(element.role&&element.label)return this.page.getByRole(element.role,{name:element.label,exact:true}).first(); if(element.role&&element.text)return this.page.getByRole(element.role,{name:element.text,exact:true}).first(); if(element.name)return this.page.locator(`[name=${JSON.stringify(element.name)}]`).filter({visible:true}).first(); if(element.type)return this.page.locator(`[type=${JSON.stringify(element.type)}]`).filter({visible:true}).first(); throw new Error(`Element ${elementId} has no usable locator; call getPage() again`); }
  async clickWithFallback(elementId) { const element=this.elementMap.get(elementId),primary=this.locatorFor(elementId); try{await primary.click({timeout:4000});return;}catch(primaryError){if(!element?.bounds)throw primaryError;const{x,y,width,height}=element.bounds;if(!(width>0&&height>0))throw primaryError;await this.page.mouse.click(x+width/2,y+height/2);} }
  async fill(elementId,text){const locator=this.locatorFor(elementId);await locator.fill(String(text),{timeout:10000});return{ok:true,action:'fill',elementId,url:this.page.url()};}
  async click(elementId){await this.clickWithFallback(elementId);return{ok:true,action:'click',elementId,url:this.page.url()};}
  async press(key){this.requirePage();await this.page.keyboard.press(String(key));return{ok:true,action:'press',key,url:this.page.url()};}
  async scroll(direction='down',amount=700){this.requirePage();const dy=direction==='up'?-Math.abs(amount):Math.abs(amount);await this.page.mouse.wheel(0,dy);return{ok:true,action:'scroll',direction,amount,url:this.page.url()};}
  async screenshot(path){this.requirePage();await this.page.screenshot({path,fullPage:false});return{ok:true,path,url:this.page.url()};}

  async reset({ relaunch = false } = {}) {
    const context=this.context,browser=this.browser,ownership=this.ownership;
    this.browser=null; this.context=null; this.page=null; this.generation=0; this.elementMap.clear(); this.ownership=null; this.connectionMode=null;
    let closePromise=Promise.resolve();
    if (ownership === 'owned-context' && context) closePromise=context.close();
    else if (ownership === 'owned-browser' && browser) closePromise=browser.close();
    const closeTimeoutMs=Number(process.env.BROWSER_RESET_TIMEOUT_MS||8000);
    let timer;
    try { await Promise.race([closePromise.catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,closeTimeoutMs);})]); }
    finally { clearTimeout(timer); }
    if (relaunch) {
      await this.launch();
      if (this.connectionMode !== 'attach') await this.page.goto('about:blank');
      return this.getPage();
    }
    return {ok:true,detached:ownership==='attached'};
  }

  async recover(){return this.reset({relaunch:true});}
  async end(){return this.reset({relaunch:false});}
  requirePage(){if(!this.page)throw new Error('Browser is not started');}
}
