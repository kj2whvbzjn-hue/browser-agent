// ==UserScript==
// @name         ChatGPT Worker Launcher
// @namespace    https://github.com/kj2whvbzjn-hue/browser-agent
// @version      0.1.0
// @description  Start a fresh ChatGPT work session from an iPhone Safari handoff URL without reading ChatGPT output.
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const DEFAULT_BROWSER_AGENT = 'https://github.com/kj2whvbzjn-hue/browser-agent';
  const PENDING_KEY = 'chatgpt-worker-launcher:pending:v1';

  function normalizeGitHubUrl(value, fieldName = 'GitHub URL') {
    const raw = String(value || '').trim();
    if (!raw) throw new Error(`${fieldName} is required`);

    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${fieldName} is not a valid URL`);
    }

    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
      throw new Error(`${fieldName} must be an https://github.com/ URL`);
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) throw new Error(`${fieldName} must identify a GitHub repository or a resource inside one`);

    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  }

  function parseBoolean(value, defaultValue = true) {
    if (value == null || value === '') return defaultValue;
    return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
  }

  function parseLaunchHash(hash) {
    const raw = String(hash || '').replace(/^#/, '');
    if (!raw) return null;

    const params = new URLSearchParams(raw);
    const repoValue = params.get('worker_repo') || params.get('worker');
    if (!repoValue) return null;

    const repo = normalizeGitHubUrl(repoValue, 'Work repository');
    const browserAgent = normalizeGitHubUrl(
      params.get('worker_browser') || DEFAULT_BROWSER_AGENT,
      'Browser Agent'
    );
    const task = String(params.get('worker_task') || '').trim().slice(0, 4000);
    const autoSend = parseBoolean(params.get('worker_autosend'), true);

    return { repo, browserAgent, task, autoSend };
  }

  function buildWorkerPrompt({ repo, browserAgent, task = '' }) {
    const lines = [
      'あなたは作業用ChatGPTです。',
      '',
      `Browser Agent: ${browserAgent}`,
      `作業リポジトリ: ${repo}`
    ];

    if (task) {
      lines.push('', `追加のタスク参照: ${task}`);
    }

    lines.push(
      '',
      '最初に作業リポジトリを確認し、Git上の情報から現在やるべき作業を把握してください。',
      'README、AGENTS.md、BROWSER_AGENT_INSTRUCTIONS.md、.agent/TASK.md、TASK.md、Issues、Pull Requests、Actions、最近のコミットとブランチ状態など、利用可能な情報を確認してください。',
      'ブラウザ操作が必要なら Browser Agent リポジトリの手順を確認し、それに従ってください。',
      '作業内容を私に聞き返さず、Git上の情報から判断できる範囲でそのまま作業を開始してください。',
      '既存の変更を不用意に上書きしないでください。Git上に作業を特定する情報が本当に不足している場合だけ、不足している点を簡潔に確認してください。'
    );

    return lines.join('\n');
  }

  function buildLaunchUrl({ repo, browserAgent = DEFAULT_BROWSER_AGENT, task = '', autoSend = true }) {
    const params = new URLSearchParams();
    params.set('worker_repo', normalizeGitHubUrl(repo, 'Work repository'));

    const normalizedBrowser = normalizeGitHubUrl(browserAgent, 'Browser Agent');
    if (normalizedBrowser !== DEFAULT_BROWSER_AGENT) params.set('worker_browser', normalizedBrowser);
    if (String(task || '').trim()) params.set('worker_task', String(task).trim());
    if (!autoSend) params.set('worker_autosend', '0');

    return `https://chatgpt.com/#${params.toString()}`;
  }

  if (globalThis.__CHATGPT_WORKER_LAUNCHER_TEST_MODE__) {
    globalThis.__CHATGPT_WORKER_LAUNCHER_TEST__ = {
      DEFAULT_BROWSER_AGENT,
      normalizeGitHubUrl,
      parseLaunchHash,
      buildWorkerPrompt,
      buildLaunchUrl
    };
    return;
  }

  function showStatus(message, kind = 'info') {
    const existing = document.getElementById('chatgpt-worker-launcher-status');
    if (existing) existing.remove();

    const box = document.createElement('div');
    box.id = 'chatgpt-worker-launcher-status';
    box.textContent = message;
    box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: '2147483647',
      left: '12px',
      right: '12px',
      bottom: '18px',
      padding: '12px 14px',
      borderRadius: '12px',
      background: kind === 'error' ? 'rgba(120, 20, 20, .96)' : 'rgba(20, 20, 20, .94)',
      color: 'white',
      font: '14px/1.4 -apple-system, BlinkMacSystemFont, sans-serif',
      boxShadow: '0 6px 24px rgba(0,0,0,.25)'
    });
    document.documentElement.appendChild(box);
    if (kind !== 'error') setTimeout(() => box.remove(), 4500);
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findComposer() {
    const selectors = [
      '#prompt-textarea',
      '[data-testid="prompt-textarea"]',
      'textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]'
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (isVisible(element)) return element;
      }
    }
    return null;
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(element, value);
  }

  function fillComposer(composer, text) {
    composer.focus();

    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      setNativeValue(composer, text);
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (composer.isContentEditable) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection.removeAllRanges();
      selection.addRange(range);

      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, text);
      } catch {}

      if (!inserted) {
        composer.textContent = text;
      }

      try {
        composer.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: text
        }));
      } catch {
        composer.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    throw new Error('Unsupported ChatGPT composer element');
  }

  function findSendButton() {
    const preferred = [
      '[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="送信"]'
    ];

    for (const selector of preferred) {
      const button = document.querySelector(selector);
      if (button && isVisible(button)) return button;
    }

    for (const button of document.querySelectorAll('button')) {
      if (!isVisible(button)) continue;
      const label = `${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`.trim();
      if (/^(send|send prompt|send message|送信)$/i.test(label)) return button;
    }
    return null;
  }

  async function waitFor(getValue, timeoutMs, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = getValue();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return null;
  }

  function readPending() {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function savePending(payload) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(payload));
    } catch {}
  }

  function clearPending() {
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch {}
  }

  async function main() {
    let payload = null;

    try {
      payload = parseLaunchHash(location.hash);
    } catch (error) {
      showStatus(`Worker Launcher: ${error.message}`, 'error');
      return;
    }

    if (payload) {
      savePending(payload);
      try {
        history.replaceState(null, '', `${location.pathname}${location.search}`);
      } catch {}
    } else {
      payload = readPending();
    }

    if (!payload) return;

    if (/^\/(auth|login|signup)(\/|$)/i.test(location.pathname)) {
      showStatus('Worker Launcher: ログイン後に自動で作業プロンプトを送信します。');
      return;
    }

    showStatus('Worker Launcher: ChatGPTの入力欄を待っています…');
    const composer = await waitFor(findComposer, 45000);
    if (!composer) {
      showStatus('Worker Launcher: 入力欄を見つけられませんでした。ページを再読み込みしてください。', 'error');
      return;
    }

    const prompt = buildWorkerPrompt(payload);
    fillComposer(composer, prompt);

    if (!payload.autoSend) {
      clearPending();
      showStatus('Worker Launcher: プロンプトを入力しました。内容を確認して送信してください。');
      return;
    }

    const sendButton = await waitFor(() => {
      const button = findSendButton();
      return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
    }, 15000);

    if (!sendButton) {
      showStatus('Worker Launcher: 送信ボタンを見つけられませんでした。プロンプトは入力済みです。', 'error');
      return;
    }

    clearPending();
    sendButton.click();
    showStatus('Worker Launcher: 作業用ChatGPTを起動しました。');
  }

  void main();
})();
