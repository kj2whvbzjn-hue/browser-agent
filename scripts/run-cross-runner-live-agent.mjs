import assert from 'node:assert/strict';
import { BrowserAgent } from './browser-agent.mjs';
const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY,sessionId=process.env.CROSS_RUNNER_SESSION_ID;
if(!base||!key||!sessionId) throw new Error('Missing live agent configuration');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
async function rest(path,options={}){const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers}});const text=await r.text();if(!r.ok)throw new Error(`Supabase ${r.status}: ${text}`);return text?JSON.parse(text):null;}
async function patch(body){return rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let liveUrl;
const readyDeadline=Date.now()+5*60_000;
while(Date.now()<readyDeadline){const rows=await rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}&select=state,live_url`);if(rows?.[0]?.state==='ready'&&rows[0].live_url){liveUrl=rows[0].live_url;break;}await sleep(1000);}
if(!liveUrl) throw new Error('Live Host did not become ready');
const host=new URL(liveUrl).hostname;
let agent;
try{
  agent=new BrowserAgent({connectionMode:'attach',cdpEndpoint:`http://${host}:9333`,preferredUrl:'chatgpt.com'});
  await agent.start();
  const before=await agent.getPage();
  const signature=`${before.url||''}\n${before.title||''}\n${before.pageText||''}`;
  const challenge=/cloudflare|just a moment|verify you are human|checking your browser|route error\s*\(403\)|challenges\.cloudflare\.com/i.test(signature);
  const prompt=(before.elements||[]).find(e=>e.editable&&e.role==='textbox'&&(e.name==='prompt'||/chat with chatgpt/i.test(e.label||'')));
  console.log(`CHATGPT_AGENT_OBSERVE_RESULT ${challenge?'challenge':prompt?'chatgpt-ui':'other'}`);
  if(challenge){console.log('CHATGPT_SEND_SKIPPED challenge');}
  else {
    assert.ok(prompt,'Visible ChatGPT prompt textbox not found');
    const marker=`Browser Agent send test ${Date.now()}. Reply with exactly: BROWSER_AGENT_SEND_OK`;
    await agent.fill(prompt.id,marker);
    const filled=await agent.getPage();
    const promptFilled=(filled.elements||[]).find(e=>e.editable&&e.role==='textbox'&&(e.name==='prompt'||/chat with chatgpt/i.test(e.label||'')));
    assert.equal(promptFilled?.value,marker,'Prompt value did not survive re-observe');
    console.log('CHATGPT_FILL_REOBSERVE_OK');
    assert.ok(promptFilled,'Prompt disappeared before send');
    // press() is intentionally a page-level action. The fresh observation above
    // establishes the current state; Enter is the single next action.
    await agent.press('Enter');
    console.log('CHATGPT_SEND_ACTION_OK');
    let observed;
    const deadline=Date.now()+30_000;
    while(Date.now()<deadline){await sleep(1000);observed=await agent.getPage();const text=observed.pageText||'';if(text.includes('BROWSER_AGENT_SEND_OK'))break;}
    const text=observed?.pageText||'';
    console.log(`CHATGPT_SEND_URL ${observed?.url||''}`);
    console.log(`CHATGPT_SEND_TEXT ${JSON.stringify(text.slice(-3000))}`);
    assert.ok(text.includes('BROWSER_AGENT_SEND_OK'),'Sent conversation/response was not observable');
    console.log('CHATGPT_SEND_REOBSERVE_OK');
  }
  await agent.end(); agent=null;
  await patch({state:'ended',ended_at:new Date().toISOString(),last_error:null});
}catch(error){await patch({state:'error',last_error:String(error?.stack||error)}).catch(()=>{});throw error;}finally{if(agent)await agent.end().catch(()=>{});}
