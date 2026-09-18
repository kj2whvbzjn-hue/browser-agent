import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { BrowserAgent } from './browser-agent.mjs';

const outputDir='artifacts-browser-agent-elementid';
await fs.mkdir(outputDir,{recursive:true});

const html=`<!doctype html><html><head><meta charset="utf-8"><title>Browser Agent elementId E2E</title></head><body><label for="message">Message</label><textarea id="message" aria-label="Message"></textarea><button id="submit" type="button">Submit</button><div id="result" aria-live="polite"></div><div id="mode"></div><script>const updateMode=()=>{document.querySelector('#mode').textContent=matchMedia('(max-width: 600px)').matches?'MODE:MOBILE':'MODE:DESKTOP';};updateMode();addEventListener('resize',updateMode);document.querySelector('#submit').addEventListener('click',()=>{document.querySelector('#result').textContent='RESULT:'+document.querySelector('#message').value;});</script></body></html>`;
const dataUrl=`data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

const server=http.createServer((req,res)=>{
  if(req.url==='/slow'){
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.write('<!doctype html><title>Slow destination</title><p>loading</p>');
    setTimeout(()=>res.end('<p>done</p>'),5000);
    return;
  }
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
  res.end('<!doctype html><title>Start</title><a href="/slow" aria-label="Slow link">Slow link</a>');
});
await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
});
const address=server.address();
assert.ok(address&&typeof address==='object');
const startUrl=`http://127.0.0.1:${address.port}/start`;
const slowUrl=`http://127.0.0.1:${address.port}/slow`;

const agent=new BrowserAgent({headless:true});
let finalState;
try{
  const state1=await agent.start(dataUrl);
  const narrow=await agent.setViewport(390,844);
  assert.equal(narrow.width,390);
  assert.equal(narrow.height,844);
  assert.match(narrow.page.pageText,/MODE:MOBILE/);
  const wide=await agent.setViewport(1440,900);
  assert.match(wide.page.pageText,/MODE:DESKTOP/);
  const textbox=wide.page.elements.find(e=>e.role==='textbox'&&e.editable&&e.label==='Message');
  assert.ok(textbox,'textbox was not discovered by observePage');
  await agent.fill(textbox.id,'elementId test success');
  const state2=await agent.getPage();
  const button=state2.elements.find(e=>e.role==='button'&&e.text==='Submit');
  assert.ok(button,'submit button was not discovered after re-observation');
  await agent.click(button.id);
  finalState=await agent.getPage();
  assert.match(finalState.pageText,/RESULT:elementId test success/);

  const navState=await agent.goto(startUrl);
  const slowLink=navState.elements.find(e=>e.role==='link'&&e.label==='Slow link');
  assert.ok(slowLink,'slow navigation link was not discovered');
  const navigation=agent.page.waitForURL(slowUrl,{waitUntil:'commit',timeout:3000});
  const clickStarted=Date.now();
  const clickResult=await agent.click(slowLink.id);
  const clickElapsedMs=Date.now()-clickStarted;
  assert.equal(clickResult.action,'click');
  assert.ok(clickElapsedMs<3000,`BrowserAgent.click waited for navigation instead of dispatching input: ${clickElapsedMs}ms`);
  await navigation;
  assert.equal(agent.page.url(),slowUrl);

  await agent.screenshot(path.join(outputDir,'final.png'));
  await fs.writeFile(path.join(outputDir,'result.json'),JSON.stringify({ok:true,clickElapsedMs,finalState},null,2));
  console.log('ELEMENTID_E2E_OK');
}catch(error){
  await fs.writeFile(path.join(outputDir,'result.json'),JSON.stringify({ok:false,error:String(error?.stack||error)},null,2));
  throw error;
}finally{
  await agent.end();
  server.closeAllConnections?.();
  await new Promise(resolve=>server.close(()=>resolve()));
}
