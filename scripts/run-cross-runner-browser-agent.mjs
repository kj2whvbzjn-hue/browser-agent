import assert from 'node:assert/strict';
import { BrowserAgent } from './browser-agent.mjs';

const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY,sessionId=process.env.CROSS_RUNNER_SESSION_ID;
if(!base||!key||!sessionId) throw new Error('Missing cross-runner agent configuration');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
async function rest(path,options={}){const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers}});const text=await r.text();if(!r.ok)throw new Error(`Supabase ${r.status}: ${text}`);return text?JSON.parse(text):null;}
async function patch(body){return rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});}

let endpoint;
const deadline=Date.now()+5*60_000;
while(Date.now()<deadline){const rows=await rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}&select=state,live_url`);if(rows?.[0]?.state==='ready'&&rows[0].live_url){endpoint=rows[0].live_url;break;}await new Promise(r=>setTimeout(r,1000));}
if(!endpoint) throw new Error('Browser Host did not become ready');
console.log(`CROSS_RUNNER_AGENT_ATTACH ${endpoint}`);
let agent;
try {
  agent=new BrowserAgent({connectionMode:'attach',cdpEndpoint:endpoint});
  await agent.start();
  const first=await agent.getPage();
  assert.match(first.pageText,/CROSS_RUNNER_HOST_READY/);
  await agent.goto('https://example.com/');
  const second=await agent.getPage();
  assert.equal(second.url,'https://example.com/');
  await agent.end(); agent=null;

  agent=new BrowserAgent({connectionMode:'attach',cdpEndpoint:endpoint});
  await agent.start();
  const reattached=await agent.getPage();
  assert.equal(reattached.url,'https://example.com/');
  assert.match(reattached.pageText,/Example Domain/);
  await agent.end(); agent=null;
  await patch({state:'ended',ended_at:new Date().toISOString(),last_error:null});
  console.log('CROSS_RUNNER_ATTACH_OK');
} catch(error) {
  await patch({state:'error',last_error:String(error?.stack||error)}).catch(()=>{});
  throw error;
} finally { if(agent) await agent.end().catch(()=>{}); }
