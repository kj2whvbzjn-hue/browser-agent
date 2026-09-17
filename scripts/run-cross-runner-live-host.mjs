import { chromium } from 'playwright';

const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY,sessionId=process.env.CROSS_RUNNER_SESSION_ID,tailscaleIp=process.env.TAILSCALE_IP;
const profileDir=process.env.BROWSER_PROFILE_DIR||'/tmp/browser-user-data';
if(!base||!key||!sessionId||!tailscaleIp) throw new Error('Missing live host configuration');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
async function rest(path,options={}){const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers}});const text=await r.text();if(!r.ok)throw new Error(`Supabase ${r.status}: ${text}`);return text?JSON.parse(text):null;}
async function patch(body){return rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});}

const context=await chromium.launchPersistentContext(profileDir,{headless:false,args:['--remote-debugging-port=9222']});
const page=context.pages()[0]||await context.newPage();
await page.goto('https://example.com/');
const previousMarker=await page.evaluate(()=>localStorage.getItem('splitBrowserHostMarker'));
if(previousMarker==='SPLIT_HOST_PROFILE_PERSISTED') console.log('SPLIT_HOST_PROFILE_RESTORE_OK');
else console.log('SPLIT_HOST_PROFILE_COLD_START');
await page.evaluate(()=>localStorage.setItem('splitBrowserHostMarker','SPLIT_HOST_PROFILE_PERSISTED'));

let chatgptResult='unknown';
try {
  const response=await page.goto('https://chatgpt.com/',{waitUntil:'domcontentloaded',timeout:45_000});
  await page.waitForTimeout(5000);
  const url=page.url();
  const title=await page.title().catch(()=> '');
  const bodyText=(await page.locator('body').innerText({timeout:5000}).catch(()=> '')).slice(0,1200);
  const challenge=/challenge|cloudflare|verify you are human|checking your browser|security verification/i.test(`${url}\n${title}\n${bodyText}`);
  const promptVisible=await page.locator('#prompt-textarea,[name="prompt-textarea"],[contenteditable="true"]').filter({visible:true}).count().catch(()=>0);
  chatgptResult=challenge?'challenge':promptVisible>0?'chatgpt-ui':'page-loaded';
  console.log(`CHATGPT_CONNECTION_RESULT ${chatgptResult}`);
  console.log(`CHATGPT_CONNECTION_STATUS ${response?.status?.() ?? 'none'}`);
  console.log(`CHATGPT_CONNECTION_URL ${url}`);
  console.log(`CHATGPT_CONNECTION_TITLE ${JSON.stringify(title)}`);
} catch(error) {
  chatgptResult='navigation-error';
  console.log(`CHATGPT_CONNECTION_RESULT ${chatgptResult}`);
  console.log(`CHATGPT_CONNECTION_ERROR ${JSON.stringify(error?.message||String(error))}`);
}

const liveUrl=`http://${tailscaleIp}:6080/vnc.html?autoconnect=1&resize=scale`;
await rest('browser_relay_sessions?on_conflict=session_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({session_id:sessionId,state:'ready',heartbeat_at:new Date().toISOString(),live_url:liveUrl,last_error:null,ended_at:null})});
console.log(`CROSS_RUNNER_LIVE_READY ${liveUrl}`);
try{
 const deadline=Date.now()+20*60_000;
 while(Date.now()<deadline){
  await patch({heartbeat_at:new Date().toISOString()});
  const rows=await rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}&select=state,last_error`);
  if(rows?.[0]?.state==='ended'){console.log('CROSS_RUNNER_LIVE_HOST_STOP');break;}
  if(rows?.[0]?.state==='error') throw new Error(rows[0].last_error||'Agent reported error');
  await new Promise(r=>setTimeout(r,1000));
 }
} finally { await context.close().catch(()=>{}); }
