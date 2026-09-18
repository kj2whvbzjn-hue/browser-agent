import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { BrowserAgent } from './browser-agent.mjs';

const outputDir='artifacts-click-fallback-e2e';
await fs.mkdir(outputDir,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const counts={delayed:0,fast:0};

function html(body,script=''){
  return '<!doctype html><html><head><meta charset="utf-8"></head><body>'+body+(script?'<script>'+script+'</script>':'')+'</body></html>';
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/source'){
    const kind=url.searchParams.get('kind');
    const target=kind==='delayed'?'/delayed-commit':'/fast';
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(html('<a id="nav" href="'+target+'">Navigate</a>'));
    return;
  }
  if(url.pathname==='/delayed-commit'){
    counts.delayed+=1;
    await sleep(5200);
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(html('<div id="dest">DELAYED_COMMIT</div>'));
    return;
  }
  if(url.pathname==='/fast'){
    counts.fast+=1;
    await sleep(150);
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(html(
      '<button id="follow" type="button">Follow up</button><div id="result"></div>',
      "document.querySelector('#follow').addEventListener('click',()=>document.querySelector('#result').textContent='FOLLOW_OK')"
    ));
    return;
  }
  res.writeHead(404);res.end('not found');
});

await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
});
const address=server.address();
const base='http://127.0.0.1:'+address.port;

async function runDelayedCommit(){
  counts.delayed=0;
  const agent=new BrowserAgent({headless:true});
  const result={request_count_after_click:0,request_count_final:0,click_error:null,final_url:null};
  try{
    const state=await agent.start(base+'/source?kind=delayed');
    const link=state.elements.find(e=>e.role==='link'&&e.text==='Navigate');
    assert.ok(link,'delayed navigation link must be observed');
    try{await agent.click(link.id);}
    catch(error){result.click_error=String(error?.message||error);}
    await sleep(100);
    result.request_count_after_click=counts.delayed;
    try{await agent.page.waitForURL(base+'/delayed-commit',{waitUntil:'commit',timeout:9000});}
    catch(error){result.wait_error=String(error?.message||error);}
    await sleep(100);
    result.request_count_final=counts.delayed;
    result.final_url=agent.page.url();
  }finally{
    await agent.end().catch(()=>{});
  }
  return result;
}

async function runFastNavigationFollowUp(){
  counts.fast=0;
  const agent=new BrowserAgent({headless:true});
  const result={request_count:0,immediate_follow_visible:false,follow_ok:false,click_error:null};
  try{
    const state=await agent.start(base+'/source?kind=fast');
    const link=state.elements.find(e=>e.role==='link'&&e.text==='Navigate');
    assert.ok(link,'fast navigation link must be observed');
    try{await agent.click(link.id);}
    catch(error){result.click_error=String(error?.message||error);}
    const observed=await agent.getPage();
    const follow=observed.elements.find(e=>e.role==='button'&&e.text==='Follow up');
    result.immediate_follow_visible=Boolean(follow);
    if(follow){
      await agent.click(follow.id);
      const after=await agent.getPage();
      result.follow_ok=/FOLLOW_OK/.test(after.pageText);
    }
    result.request_count=counts.fast;
  }finally{
    await agent.end().catch(()=>{});
  }
  return result;
}

class ForcedPreDispatchFailureAgent extends BrowserAgent {
  locatorFor(elementId){
    const locator=super.locatorFor(elementId);
    return {
      evaluate:(...args)=>locator.evaluate(...args),
      click:async()=>{throw Object.assign(new Error('simulated pre-dispatch actionability failure'),{name:'TimeoutError'});}
    };
  }
}

async function runPreDispatchFallback(){
  const agent=new ForcedPreDispatchFailureAgent({headless:true});
  const result={fallback_effect:false,click_error:null};
  try{
    const page=await agent.start('data:text/html;charset=utf-8,'+encodeURIComponent(html(
      '<button id="target" type="button">Fallback target</button><div id="result">CLICKS:0</div>',
      "let clicks=0;document.querySelector('#target').addEventListener('click',()=>document.querySelector('#result').textContent='CLICKS:'+(++clicks))"
    )));
    const button=page.elements.find(e=>e.role==='button'&&e.text==='Fallback target');
    assert.ok(button,'fallback button must be observed');
    try{await agent.click(button.id);}
    catch(error){result.click_error=String(error?.message||error);}
    const after=await agent.getPage();
    result.fallback_effect=/CLICKS:1/.test(after.pageText);
  }finally{
    await agent.end().catch(()=>{});
  }
  return result;
}

let results;
try{
  results={
    delayed_commit:await runDelayedCommit(),
    fast_navigation:await runFastNavigationFollowUp(),
    pre_dispatch_failure:await runPreDispatchFallback()
  };
  const findings={
    delayed_commit_single_dispatch:results.delayed_commit.request_count_final===1&&!results.delayed_commit.click_error,
    fast_navigation_immediate_follow_up:results.fast_navigation.immediate_follow_visible&&results.fast_navigation.follow_ok&&!results.fast_navigation.click_error,
    pre_dispatch_failure_uses_fallback:results.pre_dispatch_failure.fallback_effect&&!results.pre_dispatch_failure.click_error
  };
  const payload={schema:'browser-agent-click-fallback-e2e:v1',results,findings};
  await fs.writeFile(path.join(outputDir,'result.json'),JSON.stringify(payload,null,2));
  console.log('CLICK_FALLBACK_E2E_RESULT '+JSON.stringify(findings));
  assert.equal(findings.delayed_commit_single_dispatch,true,'delayed navigation must not receive a duplicate fallback click after primary dispatch');
  assert.equal(findings.fast_navigation_immediate_follow_up,true,'fast navigation must preserve immediate re-observation and follow-up');
  assert.equal(findings.pre_dispatch_failure_uses_fallback,true,'genuine pre-dispatch failure must preserve coordinate fallback');
  console.log('CLICK_FALLBACK_E2E_OK');
}finally{
  await new Promise(resolve=>server.close(resolve));
}
