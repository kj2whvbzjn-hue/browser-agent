import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { BrowserAgent } from './browser-agent.mjs';

const outputDir='artifacts-browser-agent-elementid';
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
    const target=kind==='delayed'?'/delayed':'/fast';
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(html('<a href="'+target+'">Navigate</a>'));
    return;
  }
  if(url.pathname==='/delayed'){
    counts.delayed+=1;
    await sleep(5200);
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(html('<div>DELAYED_DESTINATION</div>'));
    return;
  }
  if(url.pathname==='/fast'){
    counts.fast+=1;
    await sleep(150);
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(html(
      '<button type="button">Follow up</button><div id="result"></div>',
      "document.querySelector('button').addEventListener('click',()=>document.querySelector('#result').textContent='FOLLOW_OK')"
    ));
    return;
  }
  if(url.pathname==='/fallback'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(html(
      '<button type="button">Fallback target</button><div id="result"></div>',
      "document.querySelector('button').addEventListener('click',()=>document.querySelector('#result').textContent='FALLBACK_OK')"
    ));
    return;
  }
  res.writeHead(404); res.end('not found');
});

await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
});
const address=server.address();
const base='http://127.0.0.1:'+address.port;

class LegacyAgent extends BrowserAgent {
  async clickWithFallback(elementId){
    const element=this.elementMap.get(elementId),primary=this.locatorFor(elementId);
    try{
      await primary.click({timeout:4000});
      return;
    }catch(primaryError){
      if(!element?.bounds)throw primaryError;
      const{x,y,width,height}=element.bounds;
      if(!(width>0&&height>0))throw primaryError;
      await this.page.mouse.click(x+width/2,y+height/2);
    }
  }
}

class ForcedPrimaryFailureAgent extends BrowserAgent {
  locatorFor(elementId){
    super.locatorFor(elementId);
    return {click:async()=>{throw new Error('forced pre-dispatch actionability failure');}};
  }
}

async function observedLink(agent,url){
  const state=await agent.start(url);
  const link=state.elements.find(element=>element.role==='link'&&element.text==='Navigate');
  assert.ok(link,'navigation link must be observed');
  return link;
}

async function delayedCase(AgentClass){
  counts.delayed=0;
  const agent=new AgentClass({headless:true});
  try{
    const link=await observedLink(agent,base+'/source?kind=delayed');
    await agent.click(link.id);
    await agent.page.waitForURL(base+'/delayed',{waitUntil:'commit',timeout:12000});
    await sleep(100);
    return {requests:counts.delayed,final_path:new URL(agent.page.url()).pathname};
  }finally{
    await agent.end().catch(()=>{});
  }
}

async function fastCase(){
  counts.fast=0;
  const agent=new BrowserAgent({headless:true});
  try{
    const link=await observedLink(agent,base+'/source?kind=fast');
    await agent.click(link.id);
    const observed=await agent.getPage();
    assert.equal(new URL(observed.url).pathname,'/fast');
    const follow=observed.elements.find(element=>element.role==='button'&&element.text==='Follow up');
    assert.ok(follow,'fast navigation destination must be immediately observable after click');
    await agent.click(follow.id);
    const after=await agent.getPage();
    return {
      requests:counts.fast,
      destination_ready:true,
      follow_up:/FOLLOW_OK/.test(after.pageText)
    };
  }finally{
    await agent.end().catch(()=>{});
  }
}

async function fallbackCase(){
  const agent=new ForcedPrimaryFailureAgent({headless:true});
  try{
    const state=await agent.start(base+'/fallback');
    const button=state.elements.find(element=>element.role==='button'&&element.text==='Fallback target');
    assert.ok(button,'fallback target must be observed');
    await agent.click(button.id);
    const after=await agent.getPage();
    return {fallback_effect:/FALLBACK_OK/.test(after.pageText)};
  }finally{
    await agent.end().catch(()=>{});
  }
}

let legacyDelayed,fixedDelayed,fast,fallback;
try{
  legacyDelayed=await delayedCase(LegacyAgent);
  fixedDelayed=await delayedCase(BrowserAgent);
  fast=await fastCase();
  fallback=await fallbackCase();

  const findings={
    failing_before_duplicate_dispatch:legacyDelayed.requests>1,
    fixed_delayed_navigation_single_dispatch:fixedDelayed.requests===1&&fixedDelayed.final_path==='/delayed',
    fast_navigation_immediate_follow_up:fast.requests===1&&fast.destination_ready&&fast.follow_up,
    predispatch_failure_still_falls_back:fallback.fallback_effect
  };

  assert.equal(findings.failing_before_duplicate_dispatch,true,'legacy behavior must reproduce duplicate dispatch');
  assert.equal(findings.fixed_delayed_navigation_single_dispatch,true,'fixed behavior must avoid duplicate delayed-navigation dispatch');
  assert.equal(findings.fast_navigation_immediate_follow_up,true,'fixed behavior must preserve immediate fast-navigation follow-up');
  assert.equal(findings.predispatch_failure_still_falls_back,true,'genuine pre-dispatch failure must retain coordinate fallback');

  const payload={
    schema:'browser-agent-click-fallback-regression:v1',
    findings,
    counts:{legacy_delayed_requests:legacyDelayed.requests,fixed_delayed_requests:fixedDelayed.requests,fast_requests:fast.requests}
  };
  await fs.writeFile(path.join(outputDir,'click-fallback-regression.json'),JSON.stringify(payload,null,2));
  console.log('CLICK_FALLBACK_REGRESSION_OK '+JSON.stringify(payload));
}finally{
  await new Promise(resolve=>server.close(resolve));
}
