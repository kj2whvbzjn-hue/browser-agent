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
      horizontal_overflow_px:Number(report.layout?.horizontalOverflowPx||0),
      overlap_count:Number(report.layout?.overlapCount||0),
      clipping_count:Number(report.layout?.clippedInteractiveCount||0),
      state_persistence_pass:Boolean(statePersistencePass),
      keyboard_accessibility_pass:Boolean(keyboardAccessibilityPass),
      empty_error_state_pass:Boolean(emptyErrorStatePass)
    },
    destination:report.transition?.destination||sanitizeUrl(''),
    expected_destination:report.transition?.expectedDestination||null
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

    // Journey 1: board landing -> search an actually projected task -> open it.
    // Do not hard-code one issue number: the public projection is generated on its own
    // schedule, so a specific current Issue may legitimately not be present yet.
    let before=await agent.getPage();
    const search=before.elements.find(e=>e.role==='searchbox'||(e.role==='textbox'&&e.name==='q'));
    assert.ok(search,'search input must be observable');
    const taskRefs=await agent.page.locator('.task-link:visible').evaluateAll(nodes =>
      nodes.map(a => {
        const m=String(a.getAttribute('href')||'').match(/\/issues\/(\d+)$/);
        return m?m[1]:null;
      }).filter(Boolean)
    );
    assert.ok(taskRefs.length>0,'live board must expose at least one projected canonical task');
    const taskNumber=taskRefs[0];
    const expectedTaskUrl=`https://github.com/kj2whvbzjn-hue/ai-bulletin-board/issues/${taskNumber}`;
    const landingTask=before.elements.find(e=>e.role==='link'&&new RegExp(`#?${taskNumber}\\b`).test(String(e.text||'')));
    const fill=await agent.fill(search.id,taskNumber);
    await agent.page.waitForFunction(n =>
      [...document.querySelectorAll('.task-link')].some(a =>
        a.getClientRects().length>0 && String(a.getAttribute('href')||'').endsWith(`/issues/${n}`)
      ),
      taskNumber,
      {timeout:5000}
    );
    const targetDomIndex=await agent.page.evaluate(expected => {
      const selector=['button','input','textarea','select','a[href]','[role="button"]','[role="link"]','[role="textbox"]','[role="checkbox"]','[role="radio"]','[role="combobox"]','[contenteditable="true"]'].join(',');
      const nodes=[...document.querySelectorAll(selector)];
      const target=[...document.querySelectorAll('.task-link')].find(a =>
        a.getClientRects().length>0 && String(a.getAttribute('href')||'')===expected
      );
      return target ? nodes.indexOf(target) : -1;
    }, expectedTaskUrl);
    assert.ok(targetDomIndex>=0,'selected projected task must map to observer DOM index');
    let filtered=await agent.getPage();
    const task=filtered.elements.find(e=>e.role==='link'&&e.domIndex===targetDomIndex);
    assert.ok(task,'exact selected projected task link must be observable by DOM index');
    const targetBefore=task.bounds;
    const navigation=agent.page.waitForURL(expectedTaskUrl,{waitUntil:'domcontentloaded',timeout:15000});
    const click=await agent.click(task.id);
    await navigation;
    const after=await agent.getPage();
    const report1=summarizeJourney({
      journeyId:'board/find-open-task',
      expectedDestination:expectedTaskUrl,
      actions:[fill,click],
      observations:[before,filtered,after],
      targetBefore:landingTask?.bounds||targetBefore,
      targetAfter:null
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
    const visibleReviewLinks=agent.page.locator('.task-link:visible');
    const rowsShown=await visibleReviewLinks.count();
    const emptyVisible=await agent.page.locator('#fallback').isVisible();
    assert.ok(rowsShown>0||emptyVisible,'review filter must produce visible items or explicit empty state');
    let report2;
    if(rowsShown>0){
      const expectedReviewUrl=await visibleReviewLinks.first().getAttribute('href');
      assert.ok(expectedReviewUrl&&expectedReviewUrl.startsWith('https://github.com/kj2whvbzjn-hue/ai-bulletin-board/issues/'),'review task must expose canonical Issue href');
      const reviewDomIndex=await agent.page.evaluate(expected => {
        const selector=['button','input','textarea','select','a[href]','[role="button"]','[role="link"]','[role="textbox"]','[role="checkbox"]','[role="radio"]','[role="combobox"]','[contenteditable="true"]'].join(',');
        const nodes=[...document.querySelectorAll(selector)];
        const target=[...document.querySelectorAll('.task-link')].find(a =>
          a.getClientRects().length>0 && String(a.getAttribute('href')||'')===expected
        );
        return target ? nodes.indexOf(target) : -1;
      }, expectedReviewUrl);
      assert.ok(reviewDomIndex>=0,'review task must map to observer DOM index');
      const firstTask=filtered.elements.find(e=>e.role==='link'&&e.domIndex===reviewDomIndex);
      assert.ok(firstTask,'exact review task link must be observable by DOM index');
      const navigation=agent.page.waitForURL(expectedReviewUrl,{waitUntil:'domcontentloaded',timeout:15000});
      const nav=await agent.click(firstTask.id);
      await navigation;
      const end=await agent.getPage();
      report2=summarizeJourney({
        journeyId:'board/review-needed-inspect',
        expectedDestination:expectedReviewUrl,
        actions:[{action:'filter'},nav],
        observations:[before,filtered,end],
        targetBefore:firstTask.bounds,
        targetAfter:null
      });
    } else {
      const expectedFilteredUrl=new URL(BOARD_URL);
      expectedFilteredUrl.searchParams.set('review','needed');
      report2=summarizeJourney({
        journeyId:'board/review-needed-inspect',
        expectedDestination:expectedFilteredUrl.toString(),
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
    const clearedUrl=state.url;
    const q2=state.elements.find(e=>e.role==='searchbox'||(e.role==='textbox'&&e.name==='q'));
    const a2=await agent.fill(q2.id,'59');
    await agent.page.waitForTimeout(50);
    const changed=await agent.getPage();
    const expectedChangedUrl=new URL(BOARD_URL);
    expectedChangedUrl.searchParams.set('q','59');
    const persistence=new URL(searchUrl).searchParams.get('q')==='62'
      && new URL(clearedUrl).search===''
      && new URL(changed.url).searchParams.get('q')==='59';
    const report3=summarizeJourney({
      journeyId:'board/search-clear-change',
      expectedDestination:expectedChangedUrl.toString(),
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
      expectedDestination:BOARD_URL,
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
const checks={
  transition_success:all.every(r=>r.metrics.transition_success),
  state_persistence_pass:all.every(r=>r.metrics.state_persistence_pass),
  keyboard_accessibility_pass:all.every(r=>r.metrics.keyboard_accessibility_pass),
  empty_error_state_pass:all.every(r=>r.metrics.empty_error_state_pass)
};
await fs.writeFile(path.join(outputDir,'baseline.json'),JSON.stringify({ok:Object.values(checks).every(Boolean),checks,records:all},null,2));
const failedTransitions=all.filter(r=>!r.metrics.transition_success).map(r=>({journey_id:r.journey_id,viewport:r.viewport.class,destination:r.destination,expected_destination:r.expected_destination}));
if(failedTransitions.length)console.error('LIVE_BASELINE_TRANSITION_FAILURES '+JSON.stringify(failedTransitions));
assert.ok(checks.transition_success,'all live journeys must transition successfully');
assert.ok(checks.state_persistence_pass,'state persistence must pass');
assert.ok(checks.keyboard_accessibility_pass,'keyboard accessibility must pass');
assert.ok(checks.empty_error_state_pass,'empty/error handling must pass');
console.log('LIVE_RENDERED_BASELINE_OK');
