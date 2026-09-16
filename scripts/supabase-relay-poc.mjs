const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

const sessionId = `gha-poc-${process.env.GITHUB_RUN_ID || Date.now()}`;
const payload = {
  session_id: sessionId,
  direction: 'response',
  payload: { action: 'pong', message: 'github_actions_to_supabase_ok', run_id: process.env.GITHUB_RUN_ID || null },
};

const write = await fetch(`${url}/rest/v1/browser_relay_probe`, {
  method: 'POST', headers, body: JSON.stringify(payload),
});
if (!write.ok) throw new Error(`Supabase write failed ${write.status}: ${await write.text()}`);

const read = await fetch(`${url}/rest/v1/browser_relay_probe?session_id=eq.${encodeURIComponent(sessionId)}&select=session_id,direction,payload`, {
  headers,
});
if (!read.ok) throw new Error(`Supabase read failed ${read.status}: ${await read.text()}`);
const rows = await read.json();
if (rows.length !== 1 || rows[0]?.payload?.message !== 'github_actions_to_supabase_ok') {
  throw new Error(`Unexpected relay response: ${JSON.stringify(rows)}`);
}
console.log('SUPABASE_RELAY_POC_OK');
console.log(`session_id=${sessionId}`);
