# Quandle knowledge (what the Action must know)

The rules the code must follow. This file is the **spec** and the source of truth for behavior in this repo. Engine internals are deliberately **not** here — this repo only knows the engine's request/response contract.

Every rule has an ID. Every test name starts with the ID of the rule it proves (`[TGT-3] …`). A rule with no test isn't done; a test with no rule means the spec is missing something.

## What it does

On each deploy, the Action asks the Quandle engine to check the live URL from the outside (secrets in shipped JS, exposed files, source maps, CORS, headers) and tells the developer **only when that deploy exposed something new**. It's a GitHub Action (`runs: node24`, `dist/index.js`), not a GitHub App.

## TGT — Triggers and targeting (`target.ts`)

- **TGT-1** `deployment_status` with `state: success` and a `deployment_status.environment_url` → scan that URL. Commit = `deployment.sha`; environment = `deployment.environment`. If the payload has no `deployment.sha`, use the event commit (GitHub sets them equal for this event). If it has no `deployment.environment`, the environment is left unset — never guessed. The environment is cut to its first 100 bytes (UTF-8), never splitting a character, since the engine accepts no more; a long name is never a reason not to scan.
- **TGT-2** The `url` input is used on `deployment_status` **only** when the event has no `environment_url`. The deploy's own URL always wins.
- **TGT-3** `deployment_status` with any state other than `success` → skip quietly: no warning, no failure. The job summary still gets one line, "Not scanned: <reason>".
- **TGT-4** `deployment_status` with `state: success` but no URL at all (no `environment_url`, no `url` input) → config error; hint: set `url`.
- **TGT-5** **Never** use `deployment_status.target_url` as the scan target (on Vercel it's the dashboard/inspector page, not the app).
- **TGT-6** `workflow_dispatch` ("Scan now") and `schedule` → scan the `url` input; missing `url` → config error. Environment = `production`. Results go to the production issue.
- **TGT-7** Any other event → skip quietly.
- **TGT-8** A scan URL must parse as a URL, use `https:` or `http:`, contain no embedded credentials (`user:pass@`), and be at most 2048 characters **both as given and after normalisation** (encoding can lengthen it). Otherwise → config error. Private/internal hosts are **not** checked here — that's the engine's SSRF guard (one place for that rule).
- **TGT-9** Decide by event + state (+ PR state, + whether the deploy commit is the default branch's head), **never by environment name** ("Production", "Preview" vary by host).
- **TGT-10** The scan URL's fragment (`#…`) is dropped. Output (summary, comments, issues, logs) shows **only its origin + path**: the query string can carry tokens (e.g. Vercel share links), so it is sent to the engine but **never displayed**.
- **TGT-11** A deploy is a **production deploy** when its payload says `deployment.production_environment: true`, or when the deploy commit is the current head of the repository's default branch (read through the GitHub API; if that read fails, it is not a production deploy). A production deploy goes to the production issue only when it has no open PR whose head is the deploy commit. Any other deploy with no matching open PR → job summary only. Scan now and scheduled runs are always production and go to the production issue (TGT-6).

## TRU — Trust boundary (`api.ts`)

- **TRU-1** The engine request body contains only `url`, `environment`, `production` and optional `bypassSecret`. **No source code.** `production` is true for a production deploy (TGT-11), and always true for Scan now and scheduled runs (TGT-6). Otherwise it is false. Never by environment name (TGT-9).
- **TRU-2** Repo and commit identity come from the **OIDC token claims**, not the body. The token is sent as the bare JWT, with no `Bearer` prefix, in an `X-Quandle-Token` header, and nothing is sent in `Authorization` (the engine's hosting signs requests there). The body is JSON (`Content-Type: application/json`). Every engine request also carries `x-amz-content-sha256`: the lowercase hex SHA-256 of the exact body bytes sent. The hash and the body come from the same bytes, never from two separate serialisations.
- **TRU-3** OIDC audience is the constant `https://api.quandle.ai`.
- **TRU-4** The engine URL is the constant `https://api.quandle.ai/v1/scan`; there is **no input to change it**. The OIDC token is sent only there, over https, never across a redirect.
- **TRU-5** `bypass-secret` and `github-token` are masked with `core.setSecret()` before anything else; the OIDC token as soon as it's fetched. A secret never appears in any output: not in a log line, warning, failure, job summary, comment, issue or Action output (the runner masks logs, but not the summary).
- **TRU-6** GitHub API calls go only to `GITHUB_API_URL` (`https://api.github.com` on github.com), over https, with the `github-token`. That token is never sent anywhere else.
- **TRU-7** The engine answers with JSON `{ status, scanId?, findings }` and nothing else. HTTP 200 carries `scanned` or `protected`. 429 is `rate-limited`. Any other HTTP status, including 401 / 403, is `engine-error`. For every status other than `scanned`, the Action shows its own fixed reason, never engine text. A response over 2 MB or slower than 60 seconds is `engine-error`. A `protected` answer carries `findings: []`. A 200 whose `status` is not `scanned` or `protected`, a response with any field besides `status`, `scanId` and `findings`, or a `protected` answer with findings, is malformed: `engine-error` (FND-4). The fixed reasons are: `protected` → "the deploy is protected; set `bypass-secret` to scan it"; `rate-limited` → "the Quandle engine's rate limit was reached; the next deploy will be checked"; `engine-error` → "the Quandle engine could not complete the scan".
- **TRU-8** If the OIDC token cannot be fetched (the workflow lacks `id-token: write`, or GitHub's token service fails), the engine is not called and the run fails open: `engine-error` with the reason "could not get a GitHub OIDC token; the workflow needs `id-token: write`".

## PRM — Permissions (exactly these four)

```yaml
id-token: write       # OIDC identity for the engine
pull-requests: write  # one PR comment, updated in place
issues: write         # one production-exposure issue, updated in place
contents: read        # find the PR for a commit; read .quandle-ignore.yml
```

- **PRM-1** No other permission is used. No `actions/checkout`: the ignore file is read through the GitHub API from the default branch (IGN-9).
- **PRM-2** `comment: false` / `issue: false` remove the need for the matching permission.
- **PRM-3** A 403 **or any other** GitHub API failure (timeout, 5xx, rate limit) on a comment/issue call → warn and continue, with our own one-line message, never the response (ERR-2). The message gives GitHub's HTTP status only when GitHub actually answered. A request that hit its time limit says it timed out; any other failure to reach GitHub says the request failed. The scan result and job result stand.

## FND — Findings

- **FND-1** States: `new` | `existing` | `resolved` | `already-present`. The engine compares every scan with the repo's **production baseline**. `new` = not in that baseline, so on a preview it means "this deploy introduced it". `existing` = in the baseline and still present. `resolved` = in the baseline, gone now. `already-present` = found while the repo has no production baseline yet (first scan): reported loudly, **never fails the job, never blamed on a PR**.
- **FND-2** Severities: `critical` | `high` | `medium` | `low`. **Critical = certain, not just worried** (the engine assigns severity; the Action trusts it).
- **FND-3** Everything from the engine (titles, locations, evidence, reasons, and even severity/state) is **untrusted**: escaped before any Markdown or log output. Escaped text must block HTML, links, auto-links, @mentions, code spans, math (`$`), new lines, workflow commands (`::`), and control, bidirectional, zero-width and other invisible characters: Unicode tag characters (U+E0000–U+E007F), the soft hyphen (U+00AD) and variation selectors (U+FE00–U+FE0F, U+E0100–U+E01EF). Visible text is capped at 200 characters. Evidence is shown only in the engine's redacted form.
- **FND-4** An engine response that is missing, malformed, or contains an unknown state/severity → `engine-error`. **Never** treated as "0 findings".
- **FND-5** Findings and scan results are never modified after the engine (or the mock) produces them; every module reads them as-is.
- **FND-6** Each finding from the engine has exactly `id`, `rule`, `severity`, `state`, `title`, `location` and optional `evidence`. `id`, `rule`, `title` and `location` are non-empty text; `evidence`, when present, is text. Any other field, a missing or empty one, or a wrong type makes the whole response malformed: `engine-error` (FND-4). `scanId`, when present, is 1 to 64 characters, each a letter, digit, `_` or `-`; anything else makes the whole response malformed: `engine-error` (FND-4). It is kept on a `protected` answer too.

## SEV — Failing the job (`severity.ts`)

- **SEV-1** `fail-on` values: `critical` (default) | `high` | `medium` | `never`, in any letter case (see IO-2). Anything else → config error that lists the allowed values.
- **SEV-2** The job fails when at least one finding is `new` **and** at or above `fail-on` (`low` < `medium` < `high` < `critical`) **and** not ignored (IGN-10), or is matched by an expired ignore (IGN-2).
- **SEV-3** `existing`, `resolved` and `already-present` findings never fail the job, except an `existing` finding matched by an expired ignore (IGN-2).
- **SEV-4** `fail-on: never` never fails the job.

## OUT — Outputs to the developer

- **OUT-1** Job summary: **always** attempted. Full results incl. Low, **most important first** (`new` before other states, then critical → low). At most **100 findings** are listed, then "…and N more" (GitHub caps a step summary at 1 MiB). Lists ignored findings by id. The job result and outputs are set **before** the summary is written; writing the summary is **best effort** — if it fails, a warning says so (without the error) and the job result stands. A finding whose ignore expired sorts with the `new` ones. Ignored findings are listed after the others, at most 100, then "…and N more ignored".
- **OUT-2** PR comment: only on open PRs whose `head.sha` == deploy SHA; each such PR gets its own comment. **One** comment per PR, found by hidden marker, edited in place. New → create/update. Previously flagged now fixed → mark resolved. Nothing new → stay silent.
- **OUT-3** Stale deploy (PR head moved on) → summary only, no comment.
- **OUT-4** Production issue: when there's no open PR (post-merge prod, direct push, dispatch/schedule). **One** issue "🚨 Quandle: production exposures", hidden marker, same new/resolved/silent rules; closed when all resolved.
- **OUT-5** The job's own pass/fail is the status check. **It informs, it doesn't gate** — never suggest making it a required check.
- **OUT-6** Action outputs: `new-findings`, `critical`, `scan-id`, `status` (`scanned` | `skipped` | `protected` | `engine-error` | `rate-limited` | `mock` | `config-error` | `internal-error`). **All four are always set**, on every outcome. When nothing was scanned: `new-findings` = 0, `critical` = 0, `scan-id` = empty. `new-findings` counts the findings that can fail the job: shown `new` findings and those whose ignore expired (IGN-2); `critical` counts the critical ones among them. Ignored findings are never counted (IGN-10).
- **OUT-7** Our comment is found by hidden marker **and** author: only a comment written by the token's own identity (`github-actions[bot]`) is ever edited. A marker in anyone else's comment is ignored. So `github-token` must be the workflow's own `GITHUB_TOKEN` (the default): with any other token, our comment and issue are never found again and each run posts a new one.
- **OUT-8** The PR comment lists `new` findings (Critical, High, Medium) and findings that are now `resolved`. It also lists `existing` findings whose ignore expired (IGN-2), in their own section. Low findings and `already-present` findings appear only in the job summary (FND-1: never blamed on a PR). At most 50 findings, then "…and N more, see the job summary". The list also stops early when the next finding would take the comment past 60,000 characters (GitHub rejects a body over 65,536); the "…and N more" line counts every finding left out.
- **OUT-9** With no existing comment: post one only if there's a new finding, or a finding whose ignore expired, at Medium or above. With an existing comment: rewrite it to the current state if anything it showed changed, otherwise leave it as it is. A comment whose findings are all fixed is edited to say so, never deleted.
- **OUT-10** Our issue is the **open** issue with our hidden marker **and** author `github-actions[bot]`. Closed issues are never reopened: when exposures return after everything was fixed, a **new** issue is opened, so each closed issue is one incident's history.
- **OUT-11** The production issue lists everything currently exposed at Medium or above: `new`, `existing` **and** `already-present` (the first-scan baseline belongs here, where FND-1 says it's "reported loudly"), plus what was `resolved` since the last scan. Low findings stay in the job summary only. At most 50, then "…and N more, see the job summary". The list also stops early when the next finding would take the issue past 60,000 characters (GitHub rejects a body over 65,536); the "…and N more" line counts every finding left out.
- **OUT-12** No open issue: open one only if something is exposed at Medium or above that is `new`, `already-present`, or whose ignore expired. Open issue: rewrite it only if its text would change. When nothing at Medium or above is still exposed, rewrite it to say everything is fixed, then **close** it.

## ERR — Error policy

- **ERR-1** **User config error** (bad `fail-on`, invalid boolean, unknown `mock-scenario`, missing/invalid `url`, a `bypass-secret` over 256 bytes) → the job **fails** with a one-line fix hint per problem.
- **ERR-2** **Our problem** (engine down, timeout, rate-limited, protected preview without bypass, engine not available yet) → **fail open**: green job + warning + "Not scanned: <reason>" in the summary.
- **ERR-3** **Internal bug** (unexpected exception, including a GitHub event that is missing, unreadable or not valid JSON) → fail open the same way, with our own fixed message that says where to report it (`https://github.com/quandle-ai/github_action/issues`). The original error is never printed (no message, no stack, not even in debug). Reporting the internal error must itself never throw.
- **ERR-4** A green job must never look like a clean scan: every non-scan outcome says "Not scanned" in the summary. A not-scanned result carries no findings.

## IGN — Ignore file: `.quandle-ignore.yml`

```yaml
ignore:
  - id: qf_3f9a1c            # one finding (engine fingerprint, shown in every comment/summary)
    reason: "Public by design, RLS enforced"
    expires: 2027-02-01
  - rule: header/csp-missing # whole category
    reason: "Tracked in JIRA-123"
    expires: 2027-05-01
```

- **IGN-1** Each entry: `id` **or** `rule`; `reason` required; `expires` required, **max 1 year** out.
- **IGN-2** An expired entry ignores nothing. Every `new` or `existing` finding it matches fails the job as if it were `new`, and every output that shows it notes "ignore expired <date>". A matching `already-present` finding still never fails the job (FND-1).
- **IGN-3** Applied **in the Action** (auditable), after the engine's state tagging. Mock results go through the same ignores.
- **IGN-4** **Malformed file → ignore nothing**, report everything, warn with the parse problem. A typo must never hide a leak. One invalid entry makes the whole file invalid. An entry is invalid when it has a missing or empty `reason`, both `id` and `rule` or neither, an unknown key, or a bad or too-distant `expires`. The file is invalid when it is anything other than a list of entries under `ignore:`. The warning gives the entry number and the problem, never the file's contents.
- **IGN-5** An entry with `id` matches the finding with exactly that `id`. An entry with `rule` matches every finding with exactly that `rule`. Matching is exact and case-sensitive. When several entries match, an active one wins over an expired one, and the first active one in file order gives the reason.
- **IGN-6** Ignores never hide a `resolved` finding: a fix is always shown.
- **IGN-7** `expires` is a calendar date `YYYY-MM-DD` (UTC). The ignore is active through that whole day and expired from the next. "Max 1 year out" (IGN-1) is measured from the day of the run.
- **IGN-8** The file is at most 64 KB and 500 entries; anything bigger is invalid (IGN-4).
- **IGN-9** `.quandle-ignore.yml` is read from the repo root on the **default branch**, never from the deploy commit, so an ignore takes effect only once it is reviewed and merged. No file (404) → nothing ignored, no warning. Any other read failure (403, timeout, 5xx) → nothing ignored, plus a warning with our own one-line message (PRM-3). GitHub does not return the contents of a file over 1 MB; that is a read failure too.
- **IGN-10** An ignored finding never fails the job, is not counted in the `new-findings` or `critical` outputs, and is left out of the PR comment and the production issue. The job summary lists it by id with its reason. The reason is untrusted text and is escaped like FND-3. When findings were ignored, the PR comment and the production issue say how many, without listing them.

## MOCK — Mock mode (tests only)

- **MOCK-1** `mock` defaults to `false`. Scenarios: `clean` | `critical` | `fixed` | `first-scan`, in any letter case (see IO-2). Anything else → config error that lists the allowed scenarios. Mock results are always `scanned`.
- **MOCK-2** Every mock summary/comment starts with `⚠ MOCK RESULTS — not a real scan`. Every mock run also emits a warning that its results are not real, so a green mock run never looks like a real clean scan in the log (ERR-4).
- **MOCK-3** Mock never fails the job unless the scenario asks for it (`critical`).
- **MOCK-4** No engine available → honest "Not scanned", never fake data.

## IO — Inputs

- **IO-1** Inputs: exactly `url`, `fail-on`, `comment`, `issue`, `bypass-secret`, `mock`, `mock-scenario`, `github-token`. Outputs: exactly the four in OUT-6. `action.yml` declares exactly these, no more and no fewer.
- **IO-2** Every choice input (booleans, `fail-on`, `mock-scenario`) accepts its allowed values **in any letter case**, with **no trimming** (` critical` is an error). Booleans accept only `true` / `false`. Anything else → config error.
- **IO-3** Every example workflow in `examples/` uses only declared inputs, only the documented permissions (PRM-1, minus any PRM-2 lets it drop), and only supported triggers (`deployment_status`, `workflow_dispatch`, `schedule`). Each sets `timeout-minutes`; one that triggers on `deployment_status` starts its job only for successful deploys (`if:`). `bypass-secret` is only ever passed from a GitHub secret (`${{ secrets.… }}`), never as plain text.
