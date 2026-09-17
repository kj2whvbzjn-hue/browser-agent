import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const profileDir = process.env.BROWSER_PROFILE_DIR || '/tmp/browser-profile-generation';
await mkdir(profileDir, { recursive: true });
const context = await chromium.launchPersistentContext(profileDir, { headless: true });
try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://example.com/');
  await page.evaluate(() => {
    localStorage.setItem('browserAgentGenerationMarker', 'GENERATION_A_PERSISTED');
  });
  await page.goto('about:blank');
  console.log('PROFILE_GENERATION_A_READY');
} finally {
  await context.close();
}
