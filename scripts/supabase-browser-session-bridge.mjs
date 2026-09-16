import { BrowserAgent } from './browser-agent.mjs';

const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const sessionId = process.env.BROWSER_SESSION_ID || process.env.GITHUB_RUN_ID;
const idleMs = Number(process.env.BROWSER_SESSION_IDLE_MS || 1200000);
const pollMs = Number(process.env.BROWSER_SESSION_POLL_MS || 1000);
if (!base || !key || !sessionId) throw new Error('Missing Supabase credentials or session id');

const headers = { apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' };
const agent = new BrowserAgent({ headless: process.env.BROWSER_HEADLESS !== 'false' });
let lastActivity = Date.now();
let stopped = false;

async function rest(path, options={}) {
  const r = await fetch(`${base}/rest/v1/${path}`, { ...options, headers:{...headers,...options.headers} });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
async function patchSession(body) {
  return rest(`browser_relay_sessions?session_id=eq.${encodeURIComponent(sessionId)}`, {method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify(body)});
}
async function execute(c) {
  const a=c.args||{};
  switch(c.action) {
    case 'start': return agent.start(a.url);
    case 'getPage': return agent.getPage();
    case 'goto': return agent.goto(a.url);
    case 'fill': return agent.fill(a.elementId,a.text);
    case 'click': return agent.click(a.elementId);
    case 'press': return agent.press(a.key);
    case 'scroll': return agent.scroll(a.direction,a.amount);
    case 'end': stopped=true; return agent.end();
    default: throw new Error(`Unknown action: ${c.action}`);
  }
}

await rest('browser_relay_sessions?on_conflict=session_id', {method:'POST', headers:{Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify({session_id:sessionId,state:'ready',heartbeat_at:new Date().toISOString()})});
console.log(`SUPABASE_BROWSER_SESSION_READY session_id=${sessionId}`);

while(!stopped && Date.now()-lastActivity < idleMs) {
  await patchSession({heartbeat_at:new Date().toISOString()});
  const rows=await rest(`browser_relay_commands?session_id=eq.${encodeURIComponent(sessionId)}&status=eq.pending&select=id,command_id,action,args&order=id.asc&limit=1`);
  if(!rows?.length){ await new Promise(r=>setTimeout(r,pollMs)); continue; }
  const c=rows[0]; lastActivity=Date.now();
  await rest(`browser_relay_commands?id=eq.${c.id}&status=eq.pending`, {method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({status:'running',started_at:new Date().toISOString()})});
  await patchSession({state:'busy'});
  try {
    const value=await execute(c);
    const generation=(value && Number.isInteger(value.generation)) ? value.generation : undefined;
    await rest(`browser_relay_commands?id=eq.${c.id}`, {method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({status:'done',result:value??null,completed_at:new Date().toISOString()})});
    await patchSession({state: stopped?'ended':'ready', ...(generation!==undefined?{generation}:{}), ...(stopped?{ended_at:new Date().toISOString()}:{})});
  } catch(e) {
    const error=String(e?.stack||e);
    await rest(`browser_relay_commands?id=eq.${c.id}`, {method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({status:'error',error,completed_at:new Date().toISOString()})});
    await patchSession({state:'error',last_error:error});
  }
}
if(!stopped){ await agent.end().catch(()=>{}); await patchSession({state:'ended',ended_at:new Date().toISOString()}); }
