# browser-agent

Standalone Playwright browser automation environment designed to run in GitHub Actions.

## What it does

- Opens public web pages with Chromium.
- Executes browser actions from `tasks/task.json`.
- Saves screenshots, console logs, page errors, and a JSON result.
- Uploads all output as a GitHub Actions artifact.

## Run locally

```bash
npm install
npx playwright install chromium
npm run run
```

## Run in GitHub Actions

Open the repository's **Actions** tab, choose **Browser Agent**, then run the workflow manually. It also runs automatically when files under `scripts/`, `tasks/`, `package.json`, or the workflow file change.

## Task format

`tasks/task.json` contains a `steps` array. Supported actions:

- `goto`
- `clickRole`
- `clickText`
- `fillLabel`
- `checkLabel`
- `selectLabel`
- `waitForText`
- `wait`
- `screenshot`
- `assertText`

Example:

```json
{
  "steps": [
    { "action": "goto", "url": "https://example.com" },
    { "action": "clickRole", "role": "button", "name": "Start" },
    { "action": "screenshot", "name": "after-start" }
  ]
}
```

## Output

The workflow stores these in the `browser-agent-artifacts` artifact:

- screenshots (`*.png`)
- `console.log`
- `page-errors.log`
- `result.json`

The current sample task opens Guild Adventure Studio, presses `はじめから`, waits for the base screen, and saves screenshots.
