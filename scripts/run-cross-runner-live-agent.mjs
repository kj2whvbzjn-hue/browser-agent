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
try {
  agent=new BrowserAgent({connectionMode:'attach',cdpEndpoint:`http://${host}:9333`,preferredUrl:'chatgpt.com'});
  await agent.start();
  const page=await agent.getPage();
  const signature=`${page.url||''}\n${page.title||''}\n${page.pageText||''}`;
  const challenge=/cloudflare|just a moment|verify you are human|checking your browser|route error\s*\(403\)|challenges\.cloudflare\.com/i.test(signature);
  const loggedOut=/\bLog in\b/i.test(page.pageText||'');
  console.log(`CHATGPT_LOGIN_STATE ${challenge?'challenge':loggedOut?'logged-out':'possibly-authenticated'}`);
  console.log(`CHATGPT_LOGIN_URL ${page.url||''}`);
  console.log(`CHATGPT_HUMAN_TAKEOVER_URL ${liveUrl}`);
  if(challenge) throw new Error('ChatGPT challenge requires human review; no automated bypass attempted');
  if(!loggedOut){console.log('CHATGPT_LOGIN_ALREADY_PRESENT');await patch({state:'ended',ended_at:new Date().toISOString(),last_error:null});}
  else {
    await patch({state:'human',last_error:null});
    console.log('CHATGPT_HUMAN_TAKEOVER_READY');
    const deadline=Date.now()+10*60_000;
    let resumed=false;
    while(Date.now()<deadline){
      await sleep(2000);
      const rows=await rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}&select=state`);
      if(rows?.[0]?.state==='ready'){resumed=true;break;}
      if(rows?.[0]?.state==='ended') throw new Error('Human takeover ended before resume');
    }
    assert.ok(resumed,'Timed out waiting for RESUME after human login');
    const after=await agent.getPage();
    const afterText=after.pageText||'';
    const afterChallenge=/cloudflare|just a moment|verify you are human|checking your browser|route error\s*\(403\)/i.test(`${after.url}\n${after.title}\n${afterText}`);
    const stillLoggedOut=/\bLog in\b/i.test(afterText);
    console.log(`CHATGPT_POST_LOGIN_STATE ${afterChallenge?'challenge':stillLoggedOut?'logged-out':'authenticated-ui'}`);
    console.log(`CHATGPT_POST_LOGIN_URL ${after.url||''}`);
    assert.ok(!afterChallenge,'Challenge remained after human takeover');
    assert.ok(!stillLoggedOut,'ChatGPT still appears logged out after RESUME');
    console.log('CHATGPT_HUMAN_LOGIN_RESUME_OK');
    await patch({state:'ended',ended_at:new Date().toISOString(),last_error:null});
  }
  await agent.end(); agent=null;
} catch(error){await patch({state:'error',last_error:String(error?.stack||error)}).catch(()=>{});throw error;} finally {if(agent) await agent.end().catch(()=>{});}
