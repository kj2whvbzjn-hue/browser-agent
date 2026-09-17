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
  agent=new BrowserAgent({connectionMode:'attach',cdpEndpoint:endpoint,preferredUrl:'chatgpt.com'});
  await agent.start();
  const observed=await agent.getPage();
  const text=observed.pageText||'';
  const signature=`${observed.url||''}\n${observed.title||''}\n${text}`;
  const challenge=/cloudflare|just a moment|verify you are human|checking your browser|route error\s*\(403\)|challenges\.cloudflare\.com/i.test(signature);
  const chatgpt=/chatgpt\.com/i.test(observed.url||'') && /new chat|log in|where should we begin|prompt/i.test(text);
  console.log(`CHATGPT_AGENT_OBSERVE_RESULT ${challenge?'challenge':chatgpt?'chatgpt-ui':'other'}`);
  console.log(`CHATGPT_AGENT_OBSERVE_URL ${observed.url}`);
  console.log(`CHATGPT_AGENT_OBSERVE_TITLE ${JSON.stringify(observed.title||'')}`);
  console.log(`CHATGPT_AGENT_OBSERVE_TEXT ${JSON.stringify(text.slice(0,3000))}`);
  console.log(`CHATGPT_AGENT_OBSERVE_ELEMENTS ${JSON.stringify((observed.elements||[]).slice(0,80))}`);
  assert.ok(observed.url,'Agent did not observe a page URL');
  await agent.end(); agent=null;
  await patch({state:'ended',ended_at:new Date().toISOString(),last_error:null});
  console.log('CHATGPT_AGENT_OBSERVE_OK');
}catch(error){await patch({state:'error',last_error:String(error?.stack||error)}).catch(()=>{});throw error;}finally{if(agent)await agent.end().catch(()=>{});}
