# browser-agent

Standalone Playwright browser automation environment designed to run in GitHub Actions.

## Role

`browser-agent` is the reusable browser test engine. Project-specific tests live under `projects/`, while `tasks/task.json` only selects which saved task should run next.

```text
browser-agent/
  scripts/
    run-task.mjs
    generate-report.mjs
  projects/
    _template/tasks/smoke.json
    guild-adventure/tasks/qst-0002.json
    <new-project>/tasks/<test>.json
    <new-project>/fixtures/<upload-files>
  tasks/
    task.json        # active task selector
  artifacts/         # generated during Actions
```

## What it does

- Opens public or otherwise reachable web pages with Chromium.
- Executes browser actions from a selected project task JSON.
- Starts each GitHub Actions run with a fresh Chromium browser context.
- Clicks, fills, selects, checks, uploads repository fixture files, waits, and asserts page state.
- Saves screenshots, DOM/control dumps, storage dumps, console logs, page errors, dialogs, patch logs, and `result.json` when requested by the task.
- Generates `test-report.md` and `test-report.json`.
- Uploads output as a GitHub Actions artifact.

## New project operation

1. Create `projects/<project-slug>/tasks/smoke.json` from `projects/_template/tasks/smoke.json`.
2. Put any non-secret upload fixtures under `projects/<project-slug>/fixtures/`.
3. Replace the target URL, actions, waits, and assertions for that project.
4. Point `tasks/task.json` at the new task.
5. Increment `runRequest` each time the same task should run again.
6. Updating `tasks/task.json` triggers GitHub Actions.
7. Use the generated report and artifact as the execution evidence.

Old project tasks are not deleted when switching projects. Starting a new project therefore does not require destructive initialization.

See `projects/README.md` for the detailed operating convention.

## Active task selector

`tasks/task.json` is intentionally small:

```json
{
  "schemaVersion": 1,
  "project": "guild-adventure",
  "label": "qst-0002",
  "taskFile": "projects/guild-adventure/tasks/qst-0002.json",
  "runRequest": 1
}
```

The runner also remains backward compatible with a full task JSON passed directly on the command line.

## Supported task actions

Navigation and interaction:

- `goto`
- `clickRole`
- `clickText`
- `clickSelector`
- `fillLabel`
- `fillSelector`
- `checkLabel`
- `checkSelector`
- `selectLabel`
- `selectSelector`
- `uploadLabel`
- `uploadSelector`

Waiting and evidence:

- `waitForText`
- `waitForSelector`
- `wait`
- `screenshot`
- `dumpPage`
- `dumpStorage`

Assertions:

- `assertText`
- `assertSelector`
- `assertValueLabel`
- `assertValueSelector`
- `assertUrl`

Tasks may also define `dialogPolicy` and `responsePatches` when a test explicitly needs them.

## File upload

Upload actions accept `file` for one file or `files` for multiple files. Paths are relative to the repository workspace and are intentionally blocked from escaping outside the repository.

```json
{
  "action": "uploadSelector",
  "selector": "input[type=file]",
  "file": "projects/my-project/fixtures/project-backup.json",
  "label": "upload-backup"
}
```

This is intended for sanitized test fixtures. Do not commit passwords, cookies, tokens, private backups, personal email addresses, or other secrets as fixtures.

A typical import verification flow is:

```json
[
  { "action": "goto", "url": "https://example.test/import" },
  { "action": "uploadSelector", "selector": "input[type=file]", "file": "projects/my-project/fixtures/import.json" },
  { "action": "clickRole", "role": "button", "name": "取り込む" },
  { "action": "waitForText", "text": "取込完了" },
  { "action": "assertValueLabel", "labelText": "案件名", "value": "期待する案件名" },
  { "action": "assertText", "text": "期待する検証項目" },
  { "action": "dumpPage", "name": "after-import" },
  { "action": "screenshot", "name": "after-import" }
]
```

## Run locally

```bash
npm install
npx playwright install chromium
npm run run
```

`npm run run` uses `tasks/task.json`, which resolves to the selected project task.

## GitHub Actions

The `Browser Agent` workflow can be started manually from the Actions tab. It also runs automatically when `scripts/`, `tasks/`, `package.json`, or the workflow file changes.

The workflow runs the selected task, generates the report even on failure, and uploads `artifacts/` for seven days.
