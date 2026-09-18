import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserAgent } from './browser-agent.mjs';
import { layoutMetric, rectOverlap, sanitizeUrl, scrollMetric, summarizeJourney, targetMetric } from './rendered-e2e-metrics.mjs';

const outputDir = 'artifacts-rendered-e2e-metrics';
await fs.mkdir(outputDir, { recursive: true });

assert.equal(rectOverlap({x:0,y:0,width:20,height:20},{x:10,y:10,width:20,height:20}), 100);
assert.equal(rectOverlap({x:0,y:0,width:5,height:5},{x:10,y:10,width:5,height:5}), 0);
assert.deepEqual(targetMetric({x:10,y:20,width:20,height:20},{width:100,height:100}), {visible:true,distancePx:0});
assert.deepEqual(targetMetric({x:10,y:150,width:20,height:20},{width:100,height:100}), {visible:false,distancePx:50});
const sanitized = sanitizeUrl('https://example.test/board?q=secret&state=open#private-fragment');
assert.deepEqual(sanitized, {originPath:'https://example.test/board',queryKeys:['q','state'],hasHash:true});
assert.equal(JSON.stringify(sanitized).includes('secret'), false);
assert.equal(JSON.stringify(sanitized).includes('private-fragment'), false);

const syntheticScroll = scrollMetric([
  {action:'scroll',deltaY:400,viewportHeight:800},
  {action:'scroll',deltaY:200,viewportHeight:800},
  {action:'scroll',deltaY:-100,viewportHeight:800},
  {action:'scroll',deltaY:50,viewportHeight:800},
]);
assert.deepEqual(syntheticScroll, {verticalTravelPx:750,verticalTravelVh:0.938,reversalCount:2});

const syntheticLayout = layoutMetric({
  layout:{viewport:{width:390,height:844},horizontalOverflow:true},
  elements:[
    {id:'a',bounds:{x:0,y:0,width:200,height:40}},
    {id:'b',bounds:{x:180,y:0,width:100,height:40}},
    {id:'c',bounds:{x:380,y:60,width:30,height:40}},
  ],
});
assert.equal(syntheticLayout.horizontalOverflow, true);
assert.equal(syntheticLayout.overlappingInteractivePairs.length, 1);
assert.deepEqual(syntheticLayout.clippedInteractiveElements, ['c']);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Rendered E2E metric fixture</title>
<style>
  *{box-sizing:border-box} body{margin:0;font:16px sans-serif} main{max-width:900px;margin:auto;padding:16px}
  .controls{display:grid;grid-template-columns:1fr 1fr;gap:8px}.controls input,.controls button{min-width:0;width:100%;height:40px}
  .spacer{height:1400px}.target{display:block;width:180px;height:48px}
  @media(max-width:600px){main{padding:14px}.controls{grid-template-columns:1fr 1fr}}
</style></head>
<body><main>
  <h1>Fixture</h1>
  <div class="controls"><input aria-label="Search"><button type="button">Filter</button></div>
  <a href="#target">Jump to target</a>
  <div class="spacer"></div>
  <button class="target" id="target" type="button">Target action</button>
</main></body></html>`;
const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
const agent = new BrowserAgent({ headless: true });
let report;
try {
  await agent.start(dataUrl);
  const narrow = await agent.setViewport(390, 844);
  assert.equal(narrow.page.layout.viewport.width, 390);
  assert.equal(narrow.page.layout.viewport.height, 844);
  assert.equal(narrow.page.layout.horizontalOverflow, false);
  const before = narrow.page;
  const targetBefore = before.elements.find(e => e.text === 'Target action')?.bounds;
  assert.ok(targetBefore, 'target is observable before navigation');
  assert.equal(targetMetric(targetBefore, before.layout.viewport).visible, false);

  const scroll1 = await agent.scroll('down', 500);
  const scroll2 = await agent.scroll('up', 200);
  const scroll3 = await agent.scroll('down', 100);
  assert.ok(scroll1.deltaY > 0);
  assert.ok(scroll2.deltaY < 0);
  assert.ok(scroll3.deltaY > 0);

  const reset = await agent.goto(dataUrl);
  const jump = reset.elements.find(e => e.role === 'link' && e.text === 'Jump to target');
  assert.ok(jump, 'jump link is observable');
  const clickResult = await agent.click(jump.id);
  const after = await agent.getPage();
  assert.match(after.url, /#target$/);
  const targetAfter = after.elements.find(e => e.text === 'Target action')?.bounds;
  assert.ok(targetAfter, 'target is observable after navigation');
  assert.equal(targetMetric(targetAfter, after.layout.viewport).visible, true);
  assert.equal(layoutMetric(after).horizontalOverflow, false);

  report = summarizeJourney({
    journeyId:'fixture-find-target',
    expectedDestination: after.url,
    actions:[scroll1,scroll2,scroll3,clickResult],
    observations:[before,after],
    targetBefore,
    targetAfter,
  });
  assert.equal(report.schema, 'browser-agent-rendered-e2e:v1');
  assert.equal(report.transition.success, true);
  assert.equal(report.actionCount, 4);
  assert.equal(report.reversalCount, 2);
  assert.ok(report.verticalTravelPx > 0);
  assert.ok(report.verticalTravelVh > 0);
  assert.equal(report.target.before.visible, false);
  assert.equal(report.target.after.visible, true);
  assert.equal(report.layout.horizontalOverflow, false);
  assert.deepEqual(report.viewports, ['390x844']);

  await fs.writeFile(path.join(outputDir,'result.json'), JSON.stringify({ok:true,report}, null, 2));
  console.log('RENDERED_E2E_METRICS_OK');
} catch (error) {
  await fs.writeFile(path.join(outputDir,'result.json'), JSON.stringify({ok:false,error:String(error?.stack||error)}, null, 2));
  throw error;
} finally {
  await agent.end();
}
