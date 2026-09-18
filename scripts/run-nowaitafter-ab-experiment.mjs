import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { BrowserAgent } from './browser-agent.mjs';

const outputDir='artifacts-nowaitafter-ab';
await fs.mkdir(outputDir,{recursive:true});

const counts={};
const bump=key=>{counts[key]=(counts[key]||0)+1;};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function html(body,script=''){
  return '<!doctype html><html><head><meta charset="utf-8"></head><body>'+body+(script?'<script>'+script+'</script>':'')+'</body></html>';
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/source'){
    const kind=url.searchParams.get('kind');
    const target=kind==='delayed-body'?'/delayed-body':kind==='delayed-commit'?'/delayed-commit':'/fast';
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(html('<a id="nav" href="'+target+'">Navigate</a><div id="source">SOURCE</div>'));
    return;
  }
  if(url.pathname==='/delayed-body'){
    bump('delayed-body');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.write(html('<div id="dest">DELAYED_BODY</div>'));
    await sleep(5200);
    res.end();
    return;
  }
  if(url.pathname==='/delayed-commit'){
    bump('delayed-commit');
    await sleep(5200);
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(html('<div id="dest">DELAYED_COMMIT</div>'));
    return;
  }
  if(url.pathname==='/fast'){
    bump('fast');
    await sleep(150);
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(html(
      '<button id="follow" type="button">Follow up</button><div id="result"></div>',
      "document.querySelector('#follow').addEventListener('click',()=>document.querySelector('#result').textContent='FOLLOW_OK')"
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

class ProbeAgent extends BrowserAgent {
  constructor(noWaitAfter){
    super({headless:true});
    this.noWaitAfter=noWaitAfter;
    this.lastProbe=null;
  }
  async clickWithFallback(elementId){
    const element=this.elementMap.get(elementId);
    const primary=this.locatorFor(elementId);
    const probe={noWaitAfter:this.noWaitAfter,primary_ok:false,primary_error:null,fallback_used:false,elapsed_ms:0};
    const started=Date.now();
    try{
      const opts={timeout:4000};
      if(this.noWaitAfter) opts.noWaitAfter=true;
      await primary.click(opts);
      probe.primary_ok=true;
      probe.elapsed_ms=Date.now()-started;
      this.lastProbe=probe;
      return;
    }catch(error){
      probe.primary_error=String(error?.message||error);
      if(!element?.bounds){probe.elapsed_ms=Date.now()-started;this.lastProbe=probe;throw error;}
      const {x,y,width,height}=element.bounds;
      if(!(width>0&&height>0)){probe.elapsed_ms=Date.now()-started;this.lastProbe=probe;throw error;}
      probe.fallback_used=true;
      await this.page.mouse.click(x+width/2,y+height/2);
      probe.elapsed_ms=Date.now()-started;
      this.lastProbe=probe;
    }
  }
}

async function runCase(kind,noWaitAfter){
  const key=kind;
  counts[key]=0;
  const agent=new ProbeAgent(noWaitAfter);
  const result={kind,variant:noWaitAfter?'candidate_noWaitAfter':'current',click:null,url_immediately_after_click:null,
    request_count_immediately_after_click:0,final_url:null,request_count_final:0,immediate_observation:null,follow_up:null,error:null};
  try{
    const state=await agent.start(base+'/source?kind='+encodeURIComponent(kind));
    const link=state.elements.find(e=>e.role==='link'&&e.text==='Navigate');
    assert.ok(link,'navigation link must be observed');
    const target=base+(kind==='delayed-body'?'/delayed-body':kind==='delayed-commit'?'/delayed-commit':'/fast');
    try{
      await agent.click(link.id);
      result.click=agent.lastProbe;
    }catch(error){
      result.click=agent.lastProbe;
      result.error='click:'+String(error?.message||error);
    }
    result.url_immediately_after_click=agent.page.url();
    await sleep(50);
    result.request_count_immediately_after_click=counts[key]||0;

    if(kind==='fast'){
      try{
        const observed=await agent.getPage();
        result.immediate_observation={url:observed.url,generation:observed.generation,has_follow:observed.elements.some(e=>e.role==='button'&&e.text==='Follow up')};
        const follow=observed.elements.find(e=>e.role==='button'&&e.text==='Follow up');
        if(follow){
          await agent.click(follow.id);
          const afterFollow=await agent.getPage();
          result.follow_up={attempted:true,ok:/FOLLOW_OK/.test(afterFollow.pageText),url:afterFollow.url};
        }else{
          result.follow_up={attempted:false,ok:false,reason:'destination control not observable immediately after click'};
        }
      }catch(error){
        result.immediate_observation={error:String(error?.message||error)};
        result.follow_up={attempted:false,ok:false,reason:'immediate observation failed'};
      }
    }

    try{
      await agent.page.waitForURL(target,{waitUntil:'commit',timeout:9000});
    }catch(error){
      result.error=(result.error?result.error+'; ':'')+'waitForURL:'+String(error?.message||error);
    }
    result.final_url=agent.page.url();
    await sleep(100);
    result.request_count_final=counts[key]||0;

    if(kind==='fast' && !result.follow_up?.ok){
      try{
        const observed=await agent.getPage();
        const follow=observed.elements.find(e=>e.role==='button'&&e.text==='Follow up');
        if(follow){
          await agent.click(follow.id);
          const afterFollow=await agent.getPage();
          result.follow_up_after_sync={ok:/FOLLOW_OK/.test(afterFollow.pageText),url:afterFollow.url};
        }
      }catch(error){
        result.follow_up_after_sync={ok:false,error:String(error?.message||error)};
      }
    }
  } finally {
    await agent.end().catch(()=>{});
  }
  return result;
}

const results=[];
for(const kind of ['delayed-body','delayed-commit','fast']){
  results.push(await runCase(kind,false));
  results.push(await runCase(kind,true));
}

const by=(kind,variant)=>results.find(r=>r.kind===kind&&r.variant===variant);
const currentBody=by('delayed-body','current');
const candidateBody=by('delayed-body','candidate_noWaitAfter');
const currentCommit=by('delayed-commit','current');
const candidateCommit=by('delayed-commit','candidate_noWaitAfter');
const currentFast=by('fast','current');
const candidateFast=by('fast','candidate_noWaitAfter');

const findings={
  delayed_body_current_no_duplicate:currentBody.request_count_final===1 && !currentBody.click?.fallback_used,
  delayed_body_candidate_no_duplicate:candidateBody.request_count_final===1 && !candidateBody.click?.fallback_used,
  delayed_commit_current_duplicate:currentCommit.request_count_final>1 || Boolean(currentCommit.click?.fallback_used),
  delayed_commit_candidate_avoids_duplicate:candidateCommit.request_count_final===1 && !candidateCommit.click?.fallback_used,
  fast_current_immediate_follow_up:Boolean(currentFast.follow_up?.ok),
  fast_candidate_immediate_follow_up:Boolean(candidateFast.follow_up?.ok),
  candidate_fast_regression:Boolean(currentFast.follow_up?.ok)&&!Boolean(candidateFast.follow_up?.ok)
};

const promotion={
  proven_generic_benefit:findings.delayed_commit_current_duplicate && findings.delayed_commit_candidate_avoids_duplicate,
  ordinary_sequence_regression:findings.candidate_fast_regression,
};
promotion.promote_noWaitAfter=promotion.proven_generic_benefit && !promotion.ordinary_sequence_regression;

const payload={schema:'browser-agent-nowaitafter-ab:v1',base_main:'ffdfc989ae2b677d1f32cfa7a650452fb6be4016',results,findings,promotion};
await fs.writeFile(path.join(outputDir,'result.json'),JSON.stringify(payload,null,2));
console.log('NOWAITAFTER_AB_RESULT '+JSON.stringify({findings,promotion}));
console.log('NOWAITAFTER_AB_OK');
await new Promise(resolve=>server.close(resolve));
