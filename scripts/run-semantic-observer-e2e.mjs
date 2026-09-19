import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserAgent } from './browser-agent.mjs';

const outputDir = 'artifacts-browser-agent-elementid';
await fs.mkdir(outputDir, { recursive: true });

const frameHtml = `<!doctype html><html><body>
<label for="frame-input">Frame Name</label>
<input id="frame-input" required>
<button id="frame-button" type="button">Frame Apply</button>
<div id="frame-result"></div>
<script>
  document.querySelector('#frame-button').addEventListener('click', () => {
    document.querySelector('#frame-result').textContent = 'FRAME_OK:' + document.querySelector('#frame-input').value;
  });
</script>
</body></html>`;

const escapeAttr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Semantic Observer E2E</title>
<style>
  body { font-family: sans-serif; margin: 20px; }
  #covered { position: absolute; left: 30px; top: 140px; width: 180px; height: 60px; background: #ddd; cursor: pointer; }
  #overlay { position: absolute; left: 20px; top: 130px; width: 210px; height: 80px; background: rgba(0,0,0,.2); z-index: 10; }
  iframe { display:block; margin-top:220px; width:500px; height:180px; }
</style></head><body>
<div id="custom" tabindex="0" aria-label="Custom action" style="cursor:pointer">Custom action surface</div>
<div id="custom-result"></div>
<semantic-box id="shadow-host"></semantic-box>
<div id="shadow-result"></div>
<div id="covered" tabindex="0" aria-label="Covered action">Covered action</div>
<div id="overlay"><button id="dismiss-overlay">Dismiss overlay</button></div>
<div role="dialog" aria-label="Status dialog" style="position:absolute;right:10px;top:10px;width:160px;height:60px">Dialog content</div>
<iframe id="child" srcdoc="${escapeAttr(frameHtml)}"></iframe>
<script>
  document.querySelector('#custom').addEventListener('click', () => {
    document.querySelector('#custom-result').textContent = 'CUSTOM_OK';
  });
  const root = document.querySelector('#shadow-host').attachShadow({mode:'open'});
  root.innerHTML = '<button id="shadow-save" aria-label="Shadow Save">Shadow Save</button>';
  root.querySelector('#shadow-save').addEventListener('click', () => {
    document.querySelector('#shadow-result').textContent = 'SHADOW_OK';
  });
</script></body></html>`;

const agent = new BrowserAgent({ headless: true });
let report = null;

try {
  await agent.launch();
  await agent.page.setContent(html, { waitUntil: 'domcontentloaded' });
  let state = await agent.getPage();
  assert.ok(state.semantic.frameCount >= 2, 'iframe should be included in semantic observation');
  assert.ok(state.semantic.accessibilityNodeCount > 0, 'AX tree summary should be present');
  assert.ok(state.dialogs.some(dialog => dialog.name === 'Status dialog'), 'semantic dialogs should be reported');

  const custom = state.elements.find(element => element.accessibleName === 'Custom action');
  assert.ok(custom, 'tabbable/cursor custom element should be discovered');

  const shadow = state.elements.find(element => element.accessibleName === 'Shadow Save');
  assert.ok(shadow, 'open shadow-root control should be discovered');

  const frameInput = state.elements.find(element => element.accessibleName === 'Frame Name');
  assert.ok(frameInput && !frameInput.frame.main, 'iframe input should be discovered with frame metadata');

  const covered = state.elements.find(element => element.accessibleName === 'Covered action');
  assert.ok(covered?.occluded, 'covered element should be marked occluded');
  assert.ok(covered?.coveredBy, 'occlusion should identify the covering element');

  const customClick = await agent.click(custom.id);
  assert.ok(customClick.outcome?.textChanged || customClick.outcome?.changedCount > 0, 'action verification should observe a page change');
  await assert.rejects(() => agent.click(shadow.id), /Stale elementId/, 'an interaction should invalidate the prior observation IDs');

  state = await agent.getPage();
  assert.match(state.pageText, /CUSTOM_OK/);
  const shadow2 = state.elements.find(element => element.accessibleName === 'Shadow Save');
  const shadowClick = await agent.click(shadow2.id);
  assert.ok(shadowClick.outcome, 'shadow click should return a verified outcome');

  state = await agent.getPage();
  assert.match(state.pageText, /SHADOW_OK/);
  const frameInput2 = state.elements.find(element => element.accessibleName === 'Frame Name');
  const fill = await agent.fill(frameInput2.id, 'semantic value');
  assert.ok(fill.outcome?.changedCount > 0, 'input value change should appear in action diff');

  state = await agent.getPage();
  const frameInput3 = state.elements.find(element => element.accessibleName === 'Frame Name');
  assert.equal(frameInput3.value, 'semantic value');
  const frameButton = state.elements.find(element => element.accessibleName === 'Frame Apply');
  assert.ok(frameButton && !frameButton.frame.main, 'iframe button should remain actionable');
  await agent.click(frameButton.id);

  state = await agent.getPage();
  assert.match(state.pageText, /FRAME_OK:semantic value/, 'iframe text should be included in pageText');
  assert.ok(state.changesSincePreviousObservation, 'observations should include a diff from the previous observation');

  report = {
    ok: true,
    semantic: state.semantic,
    frameCount: state.frames.length,
    accessibilitySample: state.accessibility.slice(0, 8),
    finalChanges: state.changesSincePreviousObservation
  };
  await agent.screenshot(path.join(outputDir, 'semantic-observer-final.png'));
  console.log('SEMANTIC_OBSERVER_E2E_OK');
} catch (error) {
  report = { ok: false, error: String(error?.stack || error) };
  throw error;
} finally {
  await fs.writeFile(path.join(outputDir, 'semantic-observer-result.json'), JSON.stringify(report, null, 2));
  await agent.end().catch(() => {});
}
