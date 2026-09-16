# ChatGPT issue task trigger

Create an issue whose title starts with `[browser-task]`.

The issue body must be a JSON task (plain JSON or a fenced `json` code block) accepted by `scripts/run-task.mjs`.

Example:

```json
{
  "steps": [
    { "action": "goto", "url": "https://example.com" },
    { "action": "assertText", "text": "Example Domain" },
    { "action": "dumpPage", "name": "page" },
    { "action": "screenshot", "name": "final" }
  ]
}
```

The workflow forces `outputDir` to `artifacts-chatgpt` and uploads the directory as an Actions artifact.
