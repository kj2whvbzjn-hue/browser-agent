import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../ios/chatgpt-worker-launcher.user.js', import.meta.url), 'utf8');
const context = {
  URL,
  URLSearchParams,
  __CHATGPT_WORKER_LAUNCHER_TEST_MODE__: true
};
vm.runInNewContext(source, context, { filename: 'chatgpt-worker-launcher.user.js' });

const api = context.__CHATGPT_WORKER_LAUNCHER_TEST__;
assert.ok(api, 'test API should be exposed in test mode');

const repo = 'https://github.com/example/project';
const parsed = api.parseLaunchHash(`#worker_repo=${encodeURIComponent(repo)}`);
assert.equal(parsed.repo, repo);
assert.equal(parsed.browserAgent, 'https://github.com/kj2whvbzjn-hue/browser-agent');
assert.equal(parsed.autoSend, true);
assert.equal(parsed.task, '');

const shorthand = api.parseLaunchHash(`#worker=${encodeURIComponent(repo)}&worker_autosend=0&worker_task=${encodeURIComponent('Issue #42 を優先')}`);
assert.equal(shorthand.repo, repo);
assert.equal(shorthand.autoSend, false);
assert.equal(shorthand.task, 'Issue #42 を優先');

const prompt = api.buildWorkerPrompt(parsed);
assert.match(prompt, /Browser Agent: https:\/\/github\.com\/kj2whvbzjn-hue\/browser-agent/);
assert.match(prompt, /作業リポジトリ: https:\/\/github\.com\/example\/project/);
assert.match(prompt, /Git上の情報から現在やるべき作業/);
assert.match(prompt, /作業を開始/);

const launchUrl = api.buildLaunchUrl({ repo });
assert.match(launchUrl, /^https:\/\/chatgpt\.com\/#worker_repo=/);
const reparsed = api.parseLaunchHash(new URL(launchUrl).hash);
assert.equal(reparsed.repo, repo);
assert.equal(reparsed.autoSend, true);

const reviewUrl = api.buildLaunchUrl({
  repo: 'https://github.com/example/project/',
  task: 'https://github.com/example/project/issues/12',
  autoSend: false
});
const reviewPayload = api.parseLaunchHash(new URL(reviewUrl).hash);
assert.equal(reviewPayload.repo, repo);
assert.equal(reviewPayload.task, 'https://github.com/example/project/issues/12');
assert.equal(reviewPayload.autoSend, false);

assert.throws(
  () => api.parseLaunchHash(`#worker_repo=${encodeURIComponent('https://example.com/not-github')}`),
  /github\.com/
);

assert.throws(
  () => api.buildLaunchUrl({ repo: 'javascript:alert(1)' }),
  /github\.com|valid URL/
);

console.log('CHATGPT_WORKER_LAUNCHER_TESTS_OK');
