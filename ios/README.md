# iPhone ChatGPT Worker Launcher

This directory contains a minimal iPhone/Safari handoff that starts a separate ChatGPT work session from a GitHub URL. It intentionally does **not** read or scrape ChatGPT output.

## What it does

The launcher accepts a URL like this:

```text
https://chatgpt.com/#worker_repo=https%3A%2F%2Fgithub.com%2FOWNER%2FREPO
```

When that URL is opened in Safari with `chatgpt-worker-launcher.user.js` enabled, the script:

1. validates the GitHub work-repository URL,
2. builds a fixed worker startup prompt containing the work repository and Browser Agent URL,
3. waits for the normal ChatGPT composer,
4. inserts the prompt, and
5. presses Send.

The generated worker prompt tells the new ChatGPT session to inspect GitHub for the current work, read repository instructions/tasks/issues/PRs/Actions as needed, read the Browser Agent instructions when browser work is needed, and start without asking the user to restate information that is already in Git.

Default Browser Agent:

```text
https://github.com/kj2whvbzjn-hue/browser-agent
```

## iPhone setup

Install an iOS Safari userscript manager, add `chatgpt-worker-launcher.user.js`, and enable it for `chatgpt.com`. Log in to ChatGPT normally in Safari first.

No MCP server, PC, Playwright session, Cloudflare bypass, Supabase relay, or ChatGPT-output extraction is required for this launcher. The actual ChatGPT page is the user's ordinary Safari session.

## Handoff URL format

Supported hash parameters:

```text
worker_repo       required GitHub repository/resource URL
worker            shorthand alias for worker_repo
worker_browser    optional Browser Agent GitHub URL
worker_task       optional issue URL or short task hint
worker_autosend   1 by default; set 0 to fill without sending
```

Example with an issue and automatic send:

```text
https://chatgpt.com/#worker_repo=https%3A%2F%2Fgithub.com%2FOWNER%2FREPO&worker_task=https%3A%2F%2Fgithub.com%2FOWNER%2FREPO%2Fissues%2F123
```

Example that only fills the composer:

```text
https://chatgpt.com/#worker_repo=https%3A%2F%2Fgithub.com%2FOWNER%2FREPO&worker_autosend=0
```

The script stores a pending launch in `sessionStorage` before clearing the URL hash, so a login redirect can continue the handoff after the user finishes normal authentication in the same Safari session.

## Dispatcher behavior for the first ChatGPT

The dispatcher ChatGPT only needs to construct and show one link. Given a target GitHub URL, use this form:

```text
https://chatgpt.com/#worker_repo=<percent-encoded GitHub URL>
```

For example, if the user says:

```text
このリポジトリで作業開始して
https://github.com/OWNER/REPO
```

the dispatcher should return a clickable Worker Launch link containing that repository URL. The user taps it once; the second ChatGPT session receives the Browser Agent URL plus the work repository URL and starts from Git.

## Safety / scope

The launcher only writes the startup prompt into ChatGPT and optionally presses Send. It does not inspect assistant messages, extract output, loop conversations, solve anti-bot challenges, or copy authentication material.

Only `https://github.com/...` URLs are accepted for the work repository and Browser Agent fields. Query strings and fragments are removed before they are placed into the worker prompt.
