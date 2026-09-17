import { chromium } from 'playwright';

const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY,sessionId=process.env.CROSS_RUNNER_SESSION_ID,tailscaleIp=process.env.TAILSCALE_IP;
const profileDir=process.env.BROWSER_PROFILE_DIR||'/tmp/browser-user-data';
if(!base||!key||!sessionId||!tailscaleIp) throw new Error('Missing live host configuration');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
async function rest(path,options={}){const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers}});const text=await r.text();if(!r.ok)throw new Error(`Supabase ${r.status}: ${text}`);return text?JSON.parse(text):null;}
async function patch(body){return rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});}

const context=await chromium.launchPersistentContext(profileDir,{headless:false,args:['--remote-debugging-port=9222']});
const page=context.pages()[0]||await context.newPage();
await page.goto('data:text/html,<title>Human Takeover E2E</title><body><h1>HUMAN_TAKEOVER_READY</h1><button onclick="document.body.dataset.human=\'done\';this.textContent=\'HUMAN_CLICK_DONE\'">Tap this button on iPhone</button></body>');
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
