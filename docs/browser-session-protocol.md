# Browser Issue Session protocol

## Session identity

Each Browser Issue Session uses `GITHUB_RUN_ID` as its `sessionId`.

The workflow posts a Live View marker:

```text
<!-- browser-session-live-view:<sessionId> -->
```

The bridge posts and updates one lifecycle status comment:

```text
<!-- browser-session-status:<sessionId> -->
```

The JSON status contains `sessionId`, `state`, `issueNumber`, and `updatedAt`. States are `ready`, `busy`, and `ended`. While idle, the status comment is refreshed as a heartbeat.

## Commands

Commands MUST target the current session:

```text
<!-- browser-session-command:<sessionId>:<commandId> -->
```json
{"action":"getPage"}
```
```

Legacy commands without a sessionId are intentionally ignored.

Responses are session-scoped:

```text
<!-- browser-session-response:<sessionId>:<commandId> -->
```json
{"sessionId":"<sessionId>","ok":true,"value":{}}
```
```

## One Issue / one active Session

The workflow uses a GitHub Actions concurrency group keyed by Issue number with `cancel-in-progress: true`. Starting another Browser Issue Session for the same Issue replaces the older run. Different Issues may run concurrently.

## AI operating rule

1. Find the latest `browser-session-status:<sessionId>` for the Issue and require state `ready`.
2. Send only commands addressed to that `sessionId`.
3. Wait for the matching session-scoped response.
4. Re-observe after every browser-changing action.
5. Send `end` when complete and verify state `ended`.
