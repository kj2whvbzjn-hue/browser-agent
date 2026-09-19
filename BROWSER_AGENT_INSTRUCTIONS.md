# Browser Agent — AI Operating Instructions

## Purpose

This repository provides a persistent browser controlled through GitHub Actions + Playwright, with commands and observations exchanged privately through Supabase.

If a user gives this repository/source to you and asks you to use, open, operate, or control the browser, **do not ask them to explain the architecture**. Read this file and operate the browser using the connected GitHub and Supabase tools available to you.

Typical user phrases that should activate this procedure include:

- 「ブラウザを開いて」 / "Open the browser"
- 「このブラウザで〜を開いて」
- 「〜を検索して」 when browser use is requested or clearly intended
- 「ブラウザを操作して」
- requests to continue an already-running browser session

## Architecture

```text
AI / ChatGPT
   |
   | 1. launch signal (only when no usable session exists)
   v
GitHub owner Issue: [browser-launch] ...
   |
   v
GitHub Actions: Supabase Browser Session
   |
   v
BrowserAgent / Playwright (persistent same browser)
   ^
   |
   | private commands + observations
   v
Supabase
  public.browser_relay_sessions
  public.browser_relay_commands
```

Public GitHub Issues are only launch signals. **Never put target URLs, page contents, credentials, form data, browser observations, or user-sensitive task details in Issues.** Browser commands/results belong in Supabase.

## Supabase project

Project ID:

`jrgkeoyqebepfoqpgkdr`

Relevant tables:

- `public.browser_relay_sessions`
- `public.browser_relay_commands`

Do not request or expose secret values. Use the user's already-connected Supabase/GitHub integrations when available.

## Session discovery

Before launching anything, query the newest sessions:

```sql
select session_id,state,generation,live_url,heartbeat_at,last_error,created_at,ended_at
from public.browser_relay_sessions
order by created_at desc
limit 10;
```

A usable existing session normally has `state` = `ready` (or `human` when the user currently controls it), a recent heartbeat, and no `ended_at`.

If a usable session exists, reuse it. Do not create a second browser unnecessarily.

## Starting a new browser session

If no usable session exists, create a GitHub Issue in:

`kj2whvbzjn-hue/browser-agent`

with a title beginning exactly:

`[browser-launch]`

Example title:

`[browser-launch] AI browser session`

The Issue body should contain only a generic launch note such as:

`Browser session launch trigger only. No browser commands or page data are stored in this Issue.`

The repository workflow automatically starts from an owner-created Issue with this prefix.

Then poll `browser_relay_sessions` until a new session appears and reaches `ready`. Its `session_id` is normally the GitHub Actions run ID.

Do not claim the browser is ready until Supabase reports it ready.

## Command protocol

Insert commands into `public.browser_relay_commands`.

Core columns:

- `session_id`
- `command_id` — unique string chosen by the AI
- `action`
- `args` — JSON object
- `status` — bridge updates this
- `result`
- `error`

Supported actions:

- `start`
- `getPage`
- `goto`
- `fill`
- `click`
- `press`
- `scroll`
- `setViewport` — change the active page viewport using `{ "width": <int>, "height": <int> }`; allowed range is width 240–3840 and height 320–2160
- `humanTakeover`
- `resume`
- `end`

Example command insertion:

```sql
insert into public.browser_relay_commands(session_id,command_id,action,args)
values ('SESSION_ID','unique-command-id','start','{}'::jsonb);
```

Poll by `(session_id, command_id)` until `status` is `done` or `error`:

```sql
select status,result,error
from public.browser_relay_commands
where session_id='SESSION_ID' and command_id='COMMAND_ID';
```

Also inspect the session state after important actions.

## Required adaptive operating loop

The browser is **not** driven by a prewritten batch of steps. Operate adaptively:

```text
observe current page
→ decide ONE next action
→ execute
→ observe again
→ decide next action
→ ...
```

Use `getPage` whenever the current state is uncertain.

The observation returns a `generation` and actionable elements with IDs such as `g3-e2`.

### Critical stale-element rule

Element IDs are generation-specific and short-lived.

Never reuse an element ID from an older generation after navigation, interaction, resume, or a newer observation.

Example: if the current page is generation 5, do not click `g4-e2`. Call `getPage` and use a current `g5-*` element.

A stale-element rejection is a safety feature, not a reason to abandon the session.

### Semantic observation fields

`getPage` now returns a richer semantic observation while keeping the existing `generation`, `pageText`, `elements`, and `layout` fields. Use these fields instead of guessing from text alone:

- `elements[].accessibleName` / `label` — computed semantic name using ARIA labels, associated `<label>` elements, placeholders, titles, and visible text
- `elements[].context` — nearby row/card/form context that helps distinguish repeated controls such as multiple "Edit" buttons
- `elements[].states` — disabled, readonly, required, checked, selected, expanded, pressed, invalid, and focused state
- `elements[].frame` — frame id/name/url/depth; controls inside iframes are directly actionable with the returned element ID
- `elements[].inViewport` and `elements[].occluded` — whether the control is currently in the viewport and whether another element covers its hit point
- `elements[].coveredBy` — compact description of the covering element when occluded
- `frames` — observed main frame + child frames
- `dialogs` — visible HTML/ARIA dialogs
- `accessibility` — compact Chrome Accessibility Tree summary
- `semantic` — counts for frames, dialogs, AX nodes, occluded controls, and offscreen controls
- `changesSincePreviousObservation` — semantic diff from the previous explicit observation

Open shadow roots and iframe documents are included automatically. Prefer `accessibleName`, `context`, and `frame` when several elements have similar text. If `occluded` is true, handle the covering dialog/overlay first rather than repeatedly clicking the covered target.

Mutating interactions (`fill`, `click`, `press`, `typeText`, `clickAt`, `clickText`, `scroll`) return an `outcome` diff describing URL/text/focus/dialog and interactive-element changes. After any interaction, prior element IDs are invalidated immediately; call `getPage` before using another element ID. This enforces the one-action-per-observation loop rather than relying only on caller discipline.

## Opening the browser

When the user simply says 「ブラウザを開いて」:

1. Discover an existing usable session.
2. If none exists, launch one using the `[browser-launch]` Issue trigger and wait for `ready`.
3. Send `start` with `{}` unless a URL was explicitly requested.
4. Wait for the command to finish.
5. Confirm from its result/session state that the browser is usable.

`start` with `{}` may produce `about:blank`; that is valid. Do not navigate somewhere arbitrary unless the user asked.

## Navigation

For a requested URL, use `goto` with the URL in `args` according to the bridge's expected command shape. After navigation, inspect the returned observation or call `getPage`.

For page interactions, prefer observed current-generation element IDs rather than guessing selectors.

For responsive verification, use `setViewport` on the active page and then use the fresh observation returned by that command. Viewport changes invalidate prior element IDs because the command re-observes the page and advances the generation.

## Human takeover

When a login, CAPTCHA, approval, verification, payment confirmation, or other human-only step is required:

1. Send `humanTakeover`.
2. Wait for `done` and confirm session state `human`.
3. Give the user the returned `liveViewUrl` / session `live_url`.
4. Tell the user exactly what they need to do, and nothing more.
5. Wait for the user to say they finished.
6. Send `resume`.
7. `resume` re-observes the **same browser**. Use that fresh observation/generation before continuing automation.

While state is `human`, do not send normal automation commands other than `resume` or `end`.

## Error handling

A command-level error does not necessarily mean the browser session is dead.

After an error:

1. Read `browser_relay_sessions` for the current state.
2. If still `ready`, call `getPage` and continue from the actual current state.
3. If `human`, wait for/resume human control as appropriate.
4. If `ended`, do not enqueue further work.
5. If the workflow/session is truly dead or stale, launch a new session.

Do not blindly repeat failed clicks with stale element IDs.

## Ending

When browser work is complete and the session is no longer needed, send `end` and verify:

- command status `done`
- session state `ended`
- `ended_at` populated

Do not leave sessions running unnecessarily because GitHub Actions time is consumed while the browser session remains alive.

## Privacy and safety

- Never place browser commands/results/page text in public Issues.
- Never ask the user to paste Supabase, GitHub, Tailscale, or other secret keys into chat.
- Never print stored secrets.
- Keep credentials and sensitive form contents out of GitHub Issues/log-oriented channels.
- Human confirmation remains required where the target service or action requires it.

## Known proven behavior

The repository has already demonstrated these flows on main:

- automatic GitHub Actions launch from an owner-created `[browser-launch]` Issue
- private command/result relay through Supabase
- persistent same-browser observation and action loop
- generation-bound element IDs and stale-ID rejection
- automated navigation/fill/click
- human takeover through Tailscale/noVNC
- resume into the same browser after iPhone human interaction
- automated action after resume
- clean `end` lifecycle and pending-command cleanup

Treat these as available capabilities, but still verify the current session/result before claiming any specific operation succeeded.

## Minimal instruction for another AI

If this repository is supplied as the browser-agent source, the user should only need to say something like:

> このリポジトリの `BROWSER_AGENT_INSTRUCTIONS.md` を読んで、ブラウザを開いて。

After reading it, perform the procedure directly rather than asking the user to restate the architecture.
