import { BrowserAgent } from './browser-agent.mjs';

const base=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_SECRET_KEY;
const sessionId=process.env.TARGET_BROWSER_SESSION_ID;
if(!base||!key||!sessionId) throw new Error('Missing observer configuration');
const headers={apikey:key,Authorization:`Bearer ${key}`};
const r=await fetch(`${base}/rest/v1/browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}&select=state,live_url,heartbeat_at,last_error`,{headers});
if(!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
const rows=await r.json();
const session=rows?.[0];
if(!session) throw new Error(`Browser session not found: ${sessionId}`);
if(!session.live_url) throw new Error('Browser session has no Live View URL');
const host=new URL(session.live_url).hostname;
const endpoint=`http://${host}:9333`;
console.log(`OBSERVER_SESSION ${sessionId}`);
console.log(`OBSERVER_SESSION_STATE ${session.state}`);
console.log(`OBSERVER_CDP_ENDPOINT ${endpoint}`);

const agent=new BrowserAgent({connectionMode:'attach',cdpEndpoint:endpoint,preferredUrl:'chatgpt.com'});
try {
  const page=await agent.start();
  console.log(`OBSERVER_URL ${page.url}`);
  console.log(`OBSERVER_TITLE ${JSON.stringify(page.title||'')}`);
  console.log(`OBSERVER_GENERATION ${page.generation}`);
  console.log(`OBSERVER_TEXT ${JSON.stringify((page.pageText||'').slice(0,3000))}`);
  console.log(`OBSERVER_ELEMENTS ${JSON.stringify((page.elements||[]).slice(0,80))}`);
} finally {
  await agent.end().catch(()=>{});
}
