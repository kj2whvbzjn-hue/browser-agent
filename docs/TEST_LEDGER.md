# Browser Agent Test Ledger

更新日: 2026-09-17

## 目的

同じ実験を繰り返さないための恒久的な試験台帳。新しいブラウザ実験を開始する前に必ずこのファイルを確認し、既存の結果と重複する試験は実行しない。

## 運用ルール

1. 各試験は「目的 / 構成 / Run / 結果 / 判定 / 次に何を検証するか」を残す。
2. `PASS` は再試験しない。関連コード変更で回帰確認が必要な場合だけ、理由を明記して再実行する。
3. `BLOCKED` は同じ構成のまま再実行しない。前提条件またはアーキテクチャが変わった場合のみ再開する。
4. Cloudflare/CAPTCHA/本人確認の回避は行わない。
5. main は安定系。実験は `experiment/official-chrome-channel` で行い、明示承認なしに main へ merge しない。
6. 観測用ブラウザとテストブラウザを混同しない。

## 実証済み — 再試験不要

| 項目 | Run / Session | 結果 | 判定 |
|---|---|---|---|
| Adaptive observe -> one action -> reobserve | 既存E2E | generation付きelementId、stale ID拒否を確認 | PASS |
| fill / click / navigation | 既存E2E | 正常動作 | PASS |
| humanTakeover -> iPhone -> resume -> same browser reobserve | Issue #53 / Run 35159040051 | 同一browser/context/pageで復帰 | PASS |
| navigation timeout recovery | Run / Session 35144054791 | timeout後recoverし正常gotoまで確認 | PASS |
| encrypted persistent browser profile | Run 35158618322 ほか | 暗号化cache保存/復元を確認 | PASS |
| cross-generation encrypted profile restore | Run 35167278188 | PROFILE_GENERATION_RESTORE_OK | PASS |
| split Browser Host / Agent | Run 35167672032 | 別runnerからCDP attach成功 | PASS |
| fresh Agent reconnect to same Browser Host | Run 35168969600 | attach -> end -> fresh Agent -> reattach/reobserve成功 | PASS |
| encrypted profile across fresh runner generations | Run 35168969600 | SPLIT_HOST_PROFILE_RESTORE_OK | PASS |
| ChatGPT page observe | Run 35171243123 | chatgpt-ui、24 elements、prompt観測 | PASS |
| ChatGPT fill + reobserve | Run 35171610193 | generation 2->3、入力後再観測 | PASS |
| ChatGPT send + response observation | Run 35172971487 + regex修正版後続run | `ChatGPT said: 42` を観測、回帰修正済み | PASS |

## 失敗・打ち切り — 同じ構成で再実行禁止

| 項目 | Run / Session | 結果 | 判定 |
|---|---|---|---|
| GitHub-hosted fresh browserでChatGPT challenge | Issue #55 / 35162602990 | Cloudflare challenge。人間操作でも通過不能 | BLOCKED |
| long-running GitHub-hosted ChatGPT browser | Run 35169953219 | Cloudflare Route Error 403 | BLOCKED |
| ChatGPT login humanTakeover attempt | Run 35174945543 / live-35174945543 | human状態には到達したがLive ViewはCloudflare Route Error 403。認証画面へ進めない | BLOCKED |

### BLOCKEDの意味

上記3件は同じ根本条件を持つ: **GitHub-hosted runnerで新規に起動したブラウザからChatGPT認証を成立させようとしている**。この構成をそのまま再実行しても新しい情報は得られないため、再試験禁止。

UA書換え、webdriver隠蔽、fingerprint spoofing、stealth plugin、proxy、challenge solver等による検知回避は試験対象外。

## 逐次再確認記録

### V-001 — navigation timeout recovery — Run 35144054791

- 確認日: 2026-09-17
- Workflow: `Supabase Browser Session` / run #17 / main
- Head SHA: `552a26245586e73ff45c44c8776c6bbc077d4836` (`fix: recover browser before accepting commands after timeout`)
- GitHub Actions結論: `success`
- Browser session step: `Run private Supabase browser session` が `success`、`SUPABASE_BROWSER_SESSION_READY session_id=35144054791` を確認。
- Live View構成: Tailscale接続、Xvfb、x11vnc、noVNC/websockify の起動成功をログで確認。
- 注意: ActionsログにはSupabase経由で投入した個別コマンド列そのものは出力されていない。そのため「unroutable IPへのgoto timeout -> recover -> example.comへのgoto成功」という個別コマンド結果は、このActionsログ単体からは再構成できない。既存の実施記録とrun/commit整合性は確認できるが、ログで直接確認できる範囲は上記まで。
- 判定: `PASS (run/workflow/recovery build verified; command-level evidence is external to Actions log)`

### V-002 — encrypted persistent browser profile — Run 35158618322

- 確認日: 2026-09-17
- Workflow: `Supabase Browser Session` / run #42 / `workflow_dispatch` / main
- Head SHA: `cdd590cda34d5829771e5a1b5f4668a39289e13c` (`Fix encrypted profile save readiness check`)
- GitHub Actions結論: `success`
- 暗号化鍵必須チェック: `Require browser profile encryption key` = `success`。
- 復元系: `Restore encrypted browser profile` と `Decrypt browser profile` = `success`。
- セッション本体: `Run private Supabase browser session` = `success`。
- 保存系: `Encrypt persistent browser profile`、`Save encrypted browser profile`、`Remove browser profile material` がすべて `success`。
- 判定: `PASS (encrypted profile restore/decrypt -> browser session -> encrypt/save -> plaintext cleanup workflow verified)`

### V-003 — adaptive human takeover — Issue #53 / Run 35159040051

- 確認日: 2026-09-17
- Issue #53 title: `[browser-launch] adaptive takeover E2E`。Issue本文はlaunch triggerのみで、browser commands/page dataはIssueへ保存しない設計であることを確認。
- Workflow: `Supabase Browser Session` / run #44 / `workflow_dispatch` / main。
- Head SHA: `cdd590cda34d5829771e5a1b5f4668a39289e13c`。
- GitHub Actions結論: `success`。
- `Restore encrypted browser profile`、`Decrypt browser profile`、Tailscale、Live View、`Run private Supabase browser session`、再暗号化・保存・plaintext削除がすべて `success`。
- 注意: takeover/resume時の個別Supabase command/page snapshotはIssueにもActions step summaryにも保存されていないため、「iPhone操作後に同一browser/context/pageへresumeした」というcommand-level証跡はGitHub側だけからは再構成できない。既存のE2E実施記録とIssue/Runの目的・成功状態は整合する。
- 判定: `PASS (takeover E2E run verified; command-level evidence external to GitHub records)`

### V-004 — cross-generation encrypted profile restore — Run 35167278188

- 確認日: 2026-09-17
- Workflow: `Browser Agent Profile Generation E2E` / run #2 / `experiment/official-chrome-channel`。
- Head SHA: `49f33883106f84eb3ee45e58fe8981245c3789de` (`Fix encrypted profile decrypt argument order`)。
- GitHub Actions結論: `success`。
- generation-a: profile作成 -> 暗号化 -> `encrypted-profile` artifact upload がすべて `success`。
- generation-b: artifact download -> profile decrypt -> restored profile verification がすべて `success`。
- generation-b実ログで `PROFILE_GENERATION_RESTORE_OK` を直接確認。
- 判定: `PASS (encrypted profile created in generation A was transferred, decrypted and verified in generation B)`

### V-005 — split Browser Host / Agent + human resume — Run 35167672032

- 確認日: 2026-09-17
- Branch: `experiment/official-chrome-channel`。Agent job checkout SHA は `15665bf596e932db29e26e4c589f76d9ba1ce638`。
- GitHub Actions結論: `browser-host` = `success`、`browser-agent` = `success`。
- Host側: encrypted profile restore/decrypt、Tailscale、Live View、`Run split Browser Host`、再暗号化/save/plaintext cleanup がすべて `success`。
- Agent側: Tailscale接続後、別jobで `Attach, yield to human, and resume` = `success`。
- Agent実ログで `CROSS_RUNNER_SESSION_ID=live-35167672032`、`HUMAN_TAKEOVER_WAIT`、その後 `CROSS_RUNNER_HUMAN_RESUME_OK` を直接確認。
- したがって、Browser HostとBrowser Agentを別GitHub-hosted runner/jobへ分離した構成で、Agent側からhuman takeover待機を経てresume完了まで到達したことをActions一次ログで確認できる。
- 判定: `PASS (split Host/Agent jobs and cross-runner human resume directly verified in Actions log)`

### V-006 — fresh Agent reconnect + encrypted profile across runner generations — Run 35168969600

- 確認日: 2026-09-17
- 独立AI確認: GeminiへこのRunだけを割り当てたが、Geminiは公開GitHub一次証拠へ到達できず「検証不可」と報告した。この報告自体をPASS根拠には採用しない。
- GitHub Actions一次証拠: `browser-host` job `105036269302` = `success`、`browser-agent` job `105036269406` = `success`。Host/Agentは別job・別GitHub-hosted runner（ログ上のWorker IDおよびAzure Regionも別）で実行。
- Branch / generation: `experiment/official-chrome-channel`、両jobで `SPLIT_HOST_E2E_GENERATION: C`。checkout SHA `6c047a0aac9a5b18bbc2bc5ff23e9c93ad8cc275`。
- encrypted profile: Hostのcache restoreで `Cache hit for restore-key: split-browser-profile-1360823355-35168703585`、`Cache restored successfully`、`Cache restored from key: split-browser-profile-1360823355-35168703585` を確認。前Runの暗号化cacheをfresh Run 35168969600へ復元している。
- Host実ログ: `SPLIT_HOST_PROFILE_RESTORE_OK`、`CROSS_RUNNER_LIVE_READY http://100.127.84.40:6080/...`、終了時 `CROSS_RUNNER_LIVE_HOST_STOP`。その後profileを再暗号化し `Cache saved with key: split-browser-profile-1360823355-35168969600`、plaintext profile materialを削除。
- Agent実ログ: `CROSS_RUNNER_SESSION_ID: live-35168969600`、`HUMAN_TAKEOVER_WAIT http://100.127.84.40:6080/...`、`CROSS_RUNNER_HUMAN_RESUME_OK`。Agent側Tailscaleも接続成功。
- 照合結果: Geminiの「repository/runへアクセスできず一次証拠なし」という報告はGitHub一次証拠と矛盾するため棄却。Actions一次ログは、分離Host/Agent、前Run由来暗号化profile復元、同じLive View endpointでのhuman takeover/resumeを直接支持する。
- 制限: このRunのAgentログには「attach -> agent process終了 -> 別のfresh Agent process -> reattach」を個別に識別する専用ログマーカーは出ていない。したがって、`fresh Agent reconnect` の細粒度なプロセス切替手順までをこのRunの公開Actionsログだけで完全再構成できるとは記載しない。一方、Host/Agent分離とprofile世代間復元・human resumeは直接確認済み。
- 判定: `PASS (Host/Agent split, generation-C encrypted profile restore, Live View takeover/resume directly verified; exact intra-test fresh-Agent process transition is not fully reconstructable from public log markers)`

## 現在の次試験

### T-ATTACH-EXISTING-01 — 既存の正常ブラウザへのAgent attach

**目的:** GitHub-hosted runnerが新規ChatGPTブラウザを生成する経路を使わず、正常にChatGPTを利用できる既存Browser HostへBrowser AgentがCDP attachし、`getPage -> 1 action -> getPage` を実行できるか確認する。

**重要:** 「既存Browser Host」の実体と配置方法を先に確定する。GitHub-hosted runner上で同じfresh Chromeを立ち上げただけなら過去のBLOCKED試験と同一なので実行しない。

**合格条件:**
- Agentが既存Browser HostへCDP attachできる。
- ChatGPTの正常UIを観測できる。
- 認証済みならログイン状態を維持したまま再観測できる。
- Agent processを切り替えても同じBrowser Hostへ再attachできる。
- Cloudflare challenge回避処理を一切使わない。

**次の作業:** 既存Browser Hostをどこに置くかを設計・確定し、その条件が過去BLOCKED構成と異なることを確認してから初回試験を1本だけ実行する。

## Run #18 後始末

`live-35174945543` は 2026-09-17 に Supabase session state を `ended` に変更済み。同構成の再実行は禁止。
