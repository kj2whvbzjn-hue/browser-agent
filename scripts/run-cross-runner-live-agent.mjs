import assert from 'node:assert/strict';
import { BrowserAgent } from './browser-agent.mjs';
const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY,sessionId=process.env.CROSS_RUNNER_SESSION_ID;
if(!base||!key||!sessionId) throw new Error('Missing live agent configuration');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
async function rest(path,options={}){const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers}});const text=await r.text();if(!r.ok)throw new Error(`Supabase ${r.status}: ${text}`);return text?JSON.parse(text):null;}
async function patch(body){return rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});}
let liveUrl;
const readyDeadline=Date.now()+5*60_000;
while(Date.now()<readyDeadline){const rows=await rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}&select=state,live_url`);if(rows?.[0]?.state==='ready'&&rows[0].live_url){liveUrl=rows[0].live_url;break;}await new Promise(r=>setTimeout(r,1000));}
if(!liveUrl) throw new Error('Live Host did not become ready');
const host=new URL(liveUrl).hostname;
const endpoint=`http://${host}:9333`;
let agent;
try{
 agent=new BrowserAgent({connectionMode:'attach',cdpEndpoint:endpoint});
 await agent.start();
 const first=await agent.getPage();
 assert.match(first.pageText,/HUMAN_TAKEOVER_READY/);
 await agent.end(); agent=null;
 await patch({state:'human',last_error:null});
 console.log(`HUMAN_TAKEOVER_WAIT ${liveUrl}`);
 const deadline=Date.now()+15*60_000;
 while(Date.now()<deadline){const rows=await rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}&select=state`);if(rows?.[0]?.state==='busy'||rows?.[0]?.state==='ready') break;await new Promise(r=>setTimeout(r,1000));}
 const rows=await rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}&select=state`);
 if(!['busy','ready'].includes(rows?.[0]?.state)) throw new Error('Human takeover was not resumed in time');
 agent=new BrowserAgent({connectionMode:'attach',cdpEndpoint:endpoint});
 await agent.start();
 const resumed=await agent.getPage();
 assert.match(resumed.pageText,/HUMAN_CLICK_DONE/);
 await agent.end(); agent=null;
 await patch({state:'ended',ended_at:new Date().toISOString(),last_error:null});
 console.log('CROSS_RUNNER_HUMAN_RESUME_OK');
}catch(error){await patch({state:'error',last_error:String(error?.stack||error)}).catch(()=>{});throw error;}finally{if(agent)await agent.end().catch(()=>{});}
