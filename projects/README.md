# Projects

Browser Agent keeps the execution engine separate from project-specific browser tasks.

## Layout

```text
projects/
  _template/
    tasks/
      smoke.json
  <project-slug>/
    tasks/
      <test-name>.json

tasks/
  task.json   # active task selector

scripts/
  run-task.mjs
  generate-report.mjs
```

## New project

1. Create `projects/<project-slug>/tasks/smoke.json` from `_template/tasks/smoke.json`.
2. Replace the URL, assertions, and browser steps for the new target.
3. Update `tasks/task.json` so `taskFile` points to the new task.
4. Increment `runRequest` when requesting another run of the same task.
5. The push to `tasks/task.json` starts GitHub Actions.
6. Review `test-report.md`, `test-report.json`, screenshots, logs, and other evidence in the artifact.

## Switching projects

Do not delete old project tasks. Change only the selector in `tasks/task.json`. This preserves previous project automation while choosing which task the next Actions run executes.

## Reset / initialize

There is normally no destructive reset. Each GitHub Actions run starts a fresh Chromium browser context. Starting a new project means creating a new project folder and switching the active selector.

If a clean generic starting point is needed, copy `projects/_template/tasks/smoke.json` into a new project folder and point `tasks/task.json` to it.

## Active selector format

```json
{
  "schemaVersion": 1,
  "project": "my-project",
  "label": "smoke",
  "taskFile": "projects/my-project/tasks/smoke.json",
  "runRequest": 1
}
```

`runRequest` is an execution request counter. Incrementing it changes `tasks/task.json`, which intentionally triggers another GitHub Actions run without modifying the archived project task itself.
