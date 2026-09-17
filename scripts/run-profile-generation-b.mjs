import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const profileDir = process.env.BROWSER_PROFILE_DIR || '/tmp/browser-profile-generation';
const context = await chromium.launchPersistentContext(profileDir, { headless: true });
try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://example.com/');
  const marker = await page.evaluate(() => localStorage.getItem('browserAgentGenerationMarker'));
  assert.equal(marker, 'GENERATION_A_PERSISTED');
  console.log('PROFILE_GENERATION_RESTORE_OK');
} finally {
  await context.close();
}
