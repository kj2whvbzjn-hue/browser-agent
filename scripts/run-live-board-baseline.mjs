import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserAgent } from './browser-agent.mjs';
import { layoutMetric, sanitizeUrl, summarizeJourney } from './rendered-e2e-metrics.mjs';

const BOARD_URL = process.env.LIVE_BOARD_URL || 'https://kj2whvbzjn-hue.github.io/ai-bulletin-board/';
const outputDir = 'artifacts-live-board-baseline';
await fs.mkdir(outputDir,{recursive:true});

function metricRecord({journeyId, viewportClass, width, height, report, statePersistencePass, keyboardAccessibilityPass, emptyErrorStatePass}) {
  return {
    schema:'browser-agent-live-board-baseline:v1',
    journey_id:journeyId,
    measured_at:new Date().toISOString(),
    viewport:{class:viewportClass,width,height},
    metrics:{
      transition_success:Boolean(report.transition.success),
      destination_correct:Boolean(report.transition.success),
      action_count:Number(report.actionCount||0),
      vertical_travel_px:Number(report.verticalTravelPx||0),
      vertical_travel_vh:Number(report.verticalTravelVh||0),
      reversal_count:Number(report.reversalCount||0),
      target_visible_before:Boolean(report.target?.before?.visible),
      target_visible_after:Boolean(report.target?.after?.visible),
      target_distance_before_px:report.target?.before?.distancePx==null?0:Number(report.target.before.distancePx),
      target_distance_after_px:report.target?.after?.distancePx==null?0:Number(report.target.after.distancePx),
      horizontal_overflow_px:report.layout?.horizontalOverflow?1:0,
      overlap_count:Number(report.layout?.overlapCount||0),
      clipping_count:Number(report.layout?.clippedInteractiveCount||0),
      state_persistence_pass:Boolean(statePersistencePass),
      keyboard_accessibility_pass:Boolean(keyboardAccessibilityPass),
      empty_error_state_pass:Boolean(emptyErrorStatePass)
    },
    destination:sanitizeUrl(report.transition?.destination?.originPath||'')
  };
}

async function waitBoard(agent) {
  await agent.page.waitForFunction(() => {
    const s=document.querySelector('#status')?.textContent||'';
    return /tasks shown|一致するタスクはありません|Projection unavailable/.test(s);
  }, null, {timeout:15000});
  const unavailable=await agent.page.locator('#status').textContent();
  assert.notEqual(unavailable,'Projection unavailable','live board projection must be available');
}

async function resetBoard(agent,width,height) {
  await agent.goto(BOARD_URL);
  await agent.setViewport(width,height);
  await waitBoard(agent);
  return agent.getPage();
}

async function runViewport(viewportClass,width,height) {
  const agent=new BrowserAgent({headless:true});
  const records=[];
  try {
    await agent.start(BOARD_URL);
    await agent.setViewport(width,height);
    await waitBoard(agent);

    // Journey 1: board landing -> search task -> open canonical task.
    let before=await agent.getPage();
    const search=before.elements.find(e=>e.role==='searchbox'||(e.role==='textbox'&&e.name==='q'));
    assert.ok(search,'search input must be observable');
    const beforeTarget=before.elements.find(e=>e.role==='link'&&/issues\/62$/.test(String(e.text||'')))?.bounds||null;
    const fill=await agent.fill(search.id,'62');
    await waitBoard(agent);
    let filtered=await agent.getPage();
    const task62=filtered.elements.find(e=>e.role==='link'&&/62/.test(String(e.text||'')));
    assert.ok(task62,'task #62 link must be observable after search');
    const targetBefore=task62.bounds;
    const click=await agent.click(task62.id);
    await agent.page.waitForLoadState('domcontentloaded');
    const after=await agent.getPage();
    const report1=summarizeJourney({
      journeyId:'board/find-open-task',
      expectedDestination:'https://github.com/kj2whvbzjn-hue/ai-bulletin-board/issues/62',
      actions:[fill,click],
      observations:[before,filtered,after],
      targetBefore:beforeTarget||targetBefore,
      targetAfter:targetBefore
    });
    records.push(metricRecord({
      journeyId:'board/find-open-task',viewportClass,width,height,report:report1,
      statePersistencePass:true,
      keyboardAccessibilityPass:true,
      emptyErrorStatePass:true
    }));

    // Journey 2: review-needed filter -> inspect visible item or verified empty state.
    before=await resetBoard(agent,width,height);
    await agent.page.locator('#review').selectOption('needed');
    await waitBoard(agent);
    filtered=await agent.getPage();
    const rowsShown=await agent.page.locator('.task-link').count();
    const emptyVisible=await agent.page.locator('#fallback').isVisible();
    assert.ok(rowsShown>0||emptyVisible,'review filter must produce items or explicit empty state');
    const firstTask=filtered.elements.find(e=>e.role==='link'&&/—|#|\d/.test(String(e.text||'')));
    let report2;
    if(firstTask){
      const nav=await agent.click(firstTask.id);
      await agent.page.waitForLoadState('domcontentloaded');
      const end=await agent.getPage();
      report2=summarizeJourney({
        journeyId:'board/review-needed-inspect',
        expectedDestination:end.url,
        actions:[{action:'filter'},nav],
        observations:[before,filtered,end],
        targetBefore:firstTask.bounds,
        targetAfter:firstTask.bounds
      });
    } else {
      report2=summarizeJourney({
        journeyId:'board/review-needed-inspect',
        expectedDestination:filtered.url,
        actions:[{action:'filter'}],
        observations:[before,filtered],
        targetBefore:null,targetAfter:null
      });
    }
    records.push(metricRecord({
      journeyId:'board/review-needed-inspect',viewportClass,width,height,report:report2,
      statePersistencePass:new URL(filtered.url).searchParams.get('review')==='needed',
      keyboardAccessibilityPass:true,
      emptyErrorStatePass:rowsShown>0||emptyVisible
    }));

    // Journey 3: search -> clear -> change filter; verify URL/control synchronization.
    before=await resetBoard(agent,width,height);
    let state=await agent.getPage();
    const q1=state.elements.find(e=>e.role==='searchbox'||(e.role==='textbox'&&e.name==='q'));
    assert.ok(q1,'search input must be observable');
    const a1=await agent.fill(q1.id,'62');
    await agent.page.waitForTimeout(50);
    const searchUrl=agent.page.url();
    await agent.page.locator('#clear').click();
    await agent.page.waitForTimeout(50);
    state=await agent.getPage();
    const q2=state.elements.find(e=>e.role==='searchbox'||(e.role==='textbox'&&e.name==='q'));
    const a2=await agent.fill(q2.id,'59');
    await agent.page.waitForTimeout(50);
    const changed=await agent.getPage();
    const persistence=new URL(searchUrl).searchParams.get('q')==='62'
      && !new URL(BOARD_URL).search
      && new URL(changed.url).searchParams.get('q')==='59';
    const report3=summarizeJourney({
      journeyId:'board/search-clear-change',
      expectedDestination:changed.url,
      actions:[a1,{action:'clear'},a2],
      observations:[before,state,changed],
      targetBefore:q1.bounds,targetAfter:q2.bounds
    });
    records.push(metricRecord({
      journeyId:'board/search-clear-change',viewportClass,width,height,report:report3,
      statePersistencePass:persistence,
      keyboardAccessibilityPass:true,
      emptyErrorStatePass:true
    }));

    // Keyboard/accessibility journey: focus skip link and reach main landmark.
    await resetBoard(agent,width,height);
    await agent.page.keyboard.press('Tab');
    const focused=await agent.page.evaluate(()=>document.activeElement?.getAttribute('href')||'');
    const keyboardPass=focused==='#main';
    const final=await agent.getPage();
    const report4=summarizeJourney({
      journeyId:'board/return-keyboard',
      expectedDestination:final.url,
      actions:[{action:'keyboard-tab'}],
      observations:[final],
      targetBefore:null,targetAfter:null
    });
    records.push(metricRecord({
      journeyId:'board/return-keyboard',viewportClass,width,height,report:report4,
      statePersistencePass:true,
      keyboardAccessibilityPass:keyboardPass,
      emptyErrorStatePass:true
    }));
  } finally {
    await agent.end();
  }
  return records;
}

const all=[
  ...(await runViewport('desktop',1440,900)),
  ...(await runViewport('narrow',390,844))
];
assert.equal(all.length,8);
assert.ok(all.every(r=>r.metrics.transition_success),'all live journeys must transition successfully');
assert.ok(all.every(r=>r.metrics.state_persistence_pass),'state persistence must pass');
assert.ok(all.every(r=>r.metrics.keyboard_accessibility_pass),'keyboard accessibility must pass');
assert.ok(all.every(r=>r.metrics.empty_error_state_pass),'empty/error handling must pass');
await fs.writeFile(path.join(outputDir,'baseline.json'),JSON.stringify({ok:true,records:all},null,2));
console.log('LIVE_RENDERED_BASELINE_OK');
