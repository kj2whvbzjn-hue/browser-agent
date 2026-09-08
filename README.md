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
  tasks/
    task.json        # active task selector
  artifacts/         # generated during Actions
```

## What it does

- Opens public web pages with Chromium.
- Executes browser actions from a selected project task JSON.
- Starts each GitHub Actions run with a fresh Chromium browser context.
- Saves screenshots, DOM/control dumps, storage dumps, console logs, page errors, dialogs, patch logs, and `result.json` when requested by the task.
- Generates `test-report.md` and `test-report.json`.
- Uploads output as a GitHub Actions artifact.

## New project operation

1. Create `projects/<project-slug>/tasks/smoke.json` from `projects/_template/tasks/smoke.json`.
2. Replace the target URL, actions, waits, and assertions for that project.
3. Point `tasks/task.json` at the new task.
4. Increment `runRequest` each time the same task should run again.
5. Updating `tasks/task.json` triggers GitHub Actions.
6. Use the generated report and artifact as the execution evidence.

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
- `waitForText`
- `waitForSelector`
- `wait`
- `screenshot`
- `dumpPage`
- `dumpStorage`
- `assertText`
- `assertSelector`

Tasks may also define `dialogPolicy` and `responsePatches` when a test explicitly needs them.

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
