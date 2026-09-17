import { chromium } from 'playwright';

const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY,sessionId=process.env.OBSERVATION_SESSION_ID,tailscaleIp=process.env.TAILSCALE_IP;
const minutes=Math.min(350,Math.max(1,Number(process.env.OBSERVATION_HOST_MINUTES||350)));
if(!base||!key||!sessionId||!tailscaleIp) throw new Error('Missing observation host configuration');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
async function rest(path,options={}){const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers}});const text=await r.text();if(!r.ok)throw new Error(`Supabase ${r.status}: ${text}`);return text?JSON.parse(text):null;}
async function patch(body){return rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});}
const context=await chromium.launchPersistentContext('/tmp/observation-browser-profile',{headless:false,args:['--remote-debugging-port=9222']});
const page=context.pages()[0]||await context.newPage();
await page.setContent(`<main style="font-family:system-ui;padding:40px"><h1>Browser Agent Observation Host</h1><p>This browser is isolated from test browsers.</p><p>Session: ${sessionId}</p><p id="status">READY</p></main>`);
const liveUrl=`http://${tailscaleIp}:6080/vnc.html?autoconnect=1&resize=scale`;
await rest('browser_relay_sessions?on_conflict=session_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({session_id:sessionId,state:'ready',heartbeat_at:new Date().toISOString(),live_url:liveUrl,last_error:null,ended_at:null})});
console.log(`OBSERVATION_HOST_READY ${liveUrl}`);
console.log(`OBSERVATION_HOST_WINDOW_MINUTES ${minutes}`);
try { const deadline=Date.now()+minutes*60_000; while(Date.now()<deadline){ await patch({heartbeat_at:new Date().toISOString()}); const rows=await rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}&select=state`); if(rows?.[0]?.state==='ended') break; await new Promise(r=>setTimeout(r,5000)); }} finally { await context.close().catch(()=>{}); }
