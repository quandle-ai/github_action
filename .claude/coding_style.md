# Coding style

TypeScript, bundled with esbuild into `dist/index.js`, tested with vitest. Strict mode, no `any`.

## Naming

| Thing | Style | Examples |
|---|---|---|
| Files | lowercase, one word where possible; kebab-case if not | `target.ts`, `ignore.ts`, `pr-lookup.ts` |
| **Functions** | **`quandle_<module>_<area>_<camelCaseAction>`** (see below) | `quandle_target_resolve_scanTargetFromEvent` |
| Variables, parameters, object fields | camelCase | `newFindings`, `failOn`, `scanResult` |
| Types, interfaces | PascalCase, no `I` prefix | `Finding`, `ScanResult`, `Target` |
| Module-level constants | UPPER_SNAKE_CASE | `AUDIENCE`, `COMMENT_MARKER` |
| Union members / statuses | kebab-case string literals | `'already-present'`, `'engine-error'` |
| Action inputs / outputs | kebab-case in `action.yml`, camelCase in code — mapped **once** in `main.ts` | `fail-on` → `failOn` |
| Test files | `test/<folder>/<module>/<full function name>.test.ts`, mirroring `src/`, one file per exported function | `test/scan/target/quandle_target_parse_scanUrl.test.ts` |

### Function names: `quandle_<module>_<area>_<camelCaseAction>`

Very descriptive on purpose: every call site says where the function lives and exactly what it does.

| Part | Rule | Examples |
|---|---|---|
| `quandle_` | Always. Marks our code apart from library calls (`core.getInput`, `octokit.rest…`). | |
| `<module>` | The source file name, lowercase. **Not** the folder: `src/scan/target.ts` is `target`. File names stay unique across folders so this never clashes. | `api`, `target`, `github`, `severity`, `ignore`, `render`, `mock`, `main` |
| `<area>` | One lowercase word grouping related functions in that module: the thing acted on, or the kind of operation. | `request`, `token`, `comment`, `issue`, `resolve`, `check`, `parse` |
| `<camelCaseAction>` | camelCase, **starts with a verb**, says exactly what it does or returns. Be specific over short. | `postScanToEngine`, `upsertPrComment`, `isAllowedUrlScheme` |

```ts
// src/api.ts
quandle_api_request_postScanToEngine()
quandle_api_token_getOidcToken()
// src/target.ts
quandle_target_resolve_scanTargetFromEvent()
quandle_target_check_isAllowedUrlScheme()
// src/github.ts
quandle_github_comment_upsertPrComment()
quandle_github_issue_closeProductionIssue()
// src/severity.ts
quandle_severity_check_shouldFailJob()
```

**Verbs in the action part:**

- Compute / transform (pure): `resolve`, `parse`, `render`, `build`, `get` — `resolveScanTargetFromEvent`, `renderJobSummary`.
- Predicates (return `boolean`, read as a question): `is`, `has`, `should` — `isAllowedUrlScheme`, `hasIgnoreExpired`, `shouldFailJob`.
- Side effects name the effect: `post`, `upsert`, `read`, `close`, `write` — `postScanToEngine`, `readIgnoreFile`.

**Rules:**

- Applies to **every named function** in `src/`, exported or not. Exempt: short inline callbacks (`findings.filter((f) => f.state === 'new')`) and test-case callbacks.
- **Acronyms are words**: `Pr`, `Oidc`, `Url`, `Api` — `upsertPrComment`, `getOidcToken`, not `upsertPRComment`.
- No vague words anywhere in a name: `handle`, `process`, `doStuff`, `data`, `info`, `util`, `helpers`, `manager`.
- Booleans are named positively (`isEnabled`, not `isNotDisabled`).
- Units in the name when it's a number with a unit: `timeoutMs`, `maxBytes`.
- If the name gets awkward, the function probably does two things — split it rather than shorten the name.

## Functions

- One job per function. If you need "and" to describe it, split it.
- Small: aim for under ~25 lines. Longer is a smell to justify, not a hard limit.
- Early returns over nested `if`/`else`.
- **No boolean flag parameters** that switch behavior — write two functions.
- More than 3 parameters → take a single options object.
- Pure functions take plain data and return plain data; no hidden reads of globals, env, time or the network. Pass `now: Date` in instead of calling `new Date()` inside.
- `async` only where there's real I/O.

## Types

- `interface` for object shapes (data and contracts: `Finding`, `Inputs`, `ActionRuntime`); `type` for unions, derived types (`Exclude`, `Record`, mapped types) and aliases.
- **Shared data is `readonly`**: fields and arrays (`readonly Finding[]`), so no module can change what another produced (FND-5).
- **Exhaustive lists from one union.** When code needs a runtime list of a union's values, build it from a `Record<Union, true>` and derive the array with `Object.keys(…) as Union[]` (with a comment saying why the cast is safe). The compiler then errors if a value is missing or extra. Used for fail-on values, mock scenarios and input names.
- **Make illegal states unrepresentable:** discriminated unions with a `kind`/`status` field (`Target`, `ScanResult`).
- String-literal unions, not `enum`.
- No `any`. External payloads (event payload, engine response, YAML) are typed as `unknown` and **validated at the boundary** into our types. Prefer `undefined` over `null` except where an API returns `null`.
- Exhaustive `switch` over unions (TypeScript must error when a new member is added).

## Modules

Fixed map — each module has one job. Don't add a module without a reason; don't let one grow a second job.

Files live in a folder by what they are for: **`scan/`** (what to scan and how bad), **`report/`** (what the developer sees, all pure), **`io/`** (the outside world: network and the runner). Only the entry point, the orchestration and the shared types sit at the root of `src/`. A new file goes in the folder that matches its job; a new folder needs a reason, like a new module.

| Module | Job | Side effects? |
|---|---|---|
| `types.ts` | Shared types only | — |
| `scan/target.ts` | Event → scan target / skip / error | pure |
| `scan/severity.ts` | `fail-on` thresholds | pure |
| `scan/ignore.ts` | `.quandle-ignore.yml` parse, validate, expiry, filter | pure |
| `scan/mock.ts` | Canned results for tests | pure |
| `report/render.ts` | Markdown for summary / comment / issue, plus the **only** escaping functions (Markdown-safe and log-safe text) | pure |
| `io/api.ts` | OIDC token + engine HTTP call | network |
| `report/comment.ts` | Finds our own PR comment (marker **and** author) and decides create / update / leave | pure |
| `report/issue.ts` | Finds our own open production issue (marker **and** author) and decides create / update / close / leave | pure |
| `io/github.ts` | GitHub REST calls on an injected Octokit: PR lookup, comment list/create/update, issue list/create/update/close, the ignore file from the default branch. Never throws: every call returns ok or our own reason | network |
| `main.ts` | Read inputs, wire the steps, set outputs/result — through an injected `ActionRuntime` | orchestration only |
| `io/runtime.ts` | Builds the real `ActionRuntime` from `@actions/core`, the environment and the file system (all injected, so it is tested). Reads the GitHub event. | I/O adapter |
| `index.ts` | Entry point: one call, `main(runtime)`. No logic at all. | wiring only |

- **Functional core, imperative shell.** Only `index.ts` and the files in `io/` (`runtime.ts`, `api.ts`, `github.ts`) import `@actions/core` / `@octokit/*` or do I/O. `main.ts` reaches the runtime only through `ActionRuntime`, so the whole flow is testable with a fake.
- **Named exports only**, no default exports. (Only exception: tool config files whose tool requires one, e.g. `vitest.config.mts`.)
- Import order: node built-ins, third-party, local (`./`). Type-only imports use `import type`.
- No circular imports. `types.ts` imports nothing.

## DRY — by knowledge, not by text

- **One source of truth per decision:** severity ranks, markers, the OIDC audience, input names, status strings. Never encode the same rule in two places.
- Don't extract an abstraction for two similar-looking lines. Extract on the **third real repetition** (rule of three). The wrong abstraction is worse than duplication.
- Constants live once, in the module that owns them, and are imported from there. No magic strings or numbers inline.
- A union and its runtime list are kept in sync by the exhaustive-list pattern (see Types), never by hand. Error messages that list allowed values are built from that list.

## Comments and TODOs

- **Every file we write in `src/`, `test/` and `scripts/`, plus our own config files (`vitest.config.mts`), starts with a file header**, before any import:

  ```ts
  // ==========================================================================
  // Quandle GitHub Action · src/render.ts
  // Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.
  //
  // What this file does, in a few plain sentences.
  // What it must never do (when that matters: no I/O, never throws, …).
  // Rules: FND-3, OUT-1
  // ==========================================================================
  ```

  - Line 2 is the repo-relative path. Line 3 is always exactly `// Written by Feudal Security, LLC (Quandle). MIT License, see LICENSE.`
  - `Rules:` lists the spec IDs the file implements (or tests). Omit for files that implement none.
  - Keep it current: when a file's job changes, its header changes in the same diff.

- **Every named function has a spec comment directly above it**, written as `//` line comments (not `/** */`):

  ```ts
  // Decides what to scan for this GitHub event, or why not to scan.
  // The deploy's own URL always wins; the url input is only a fallback.
  // Returns: scan (with url, environment, sha), skip (quietly), or error (config problem + fix hint).
  // Rules: TGT-1, TGT-2, TGT-3, TGT-4, TGT-5, TGT-6, TGT-7
  export function quandle_target_resolve_scanTargetFromEvent(event: EventContext, urlInput: string | undefined): Target {
  ```

  - Line 1+: what it does, in plain sentences.
  - `Returns:` what comes back, and when each case happens.
  - `Rules:` the spec IDs it implements. Omit only for small helpers that implement no rule.
  - Add `Never throws.` / `Side effects: …` when that matters to the caller.
- Comments inside a function explain **why**, not what. When a rule looks arbitrary, say which rule it is: `// Fail open: our outage must never break a user's build.`
- Types, fields and constants use `//` comments too, one style everywhere.
- No commented-out code. No dead code.
- `TODO` only with a version tag: `TODO(v1.1): …`.

## Errors

- Errors are values where it's natural (`Target` has `kind: 'error'`); throw only for truly unexpected failures.
- Error messages are one line, start with `Quandle:`, and say how to fix it when it's the user's mistake: `Quandle: \`url\` input is required for workflow_dispatch runs`.
- The *policy* (what fails the job vs fails open) is in `quandle_knowledge.md` — follow it, don't reinvent it per module.

## Security coding rules

**Assume every log line is public.** Workflow logs, job summaries, PR comments and issues on public repos can be read by anyone. Write every line of output as if an attacker will read it.

### Never dump errors

- **Nothing may throw before `main`'s `try` starts.** No dependency that does work at import time (e.g. `@actions/github` parses the event file on import). Anything that can fail is called from inside the run, through `ActionRuntime`.
- **Never let a raw error reach the runner.** No uncaught throws, no `throw err` out of `main`, no stack traces in the log.
- **Never log an error object, request or response.** No `console.log(err)`, no `core.info(JSON.stringify(err))`, no `` `${err}` `` of an HTTP/Octokit error — they can carry headers, tokens, URLs with query strings, and response bodies.
- Every caught error is converted at the boundary into **our own one-line message** that we wrote: what failed, a status code at most, and how to fix it if it's the user's mistake. Original messages from libraries, the engine or the scanned site are never echoed verbatim.
- Stack traces and detail go nowhere — not even `core.debug` (debug logs are public too on public repos).
- No `console.*` anywhere. All output goes through `@actions/core` (`info`, `warning`, `setFailed`, `summary`), in the modules allowed to use it.

### Never leak secrets

- Call `core.setSecret()` on every secret **the moment it exists**: `bypass-secret`, `github-token`, the OIDC token after it's fetched.
- Never put a secret in a log, summary, comment, issue, output, error message, URL or query string. Secrets travel only in headers or request bodies over HTTPS.
- Findings evidence is shown only as the engine's redacted form. Never reconstruct, un-redact, or show more of it.
- No real secrets in tests or fixtures. Fake values are obviously fake and **not** realistic full-length key formats (GitHub push protection will flag them): `'FAKE_TEST_KEY'`, not `'sk-proj-…'` with 160 random chars.

### Treat all input as untrusted

- Untrusted: action inputs, the event payload (branch names, PR titles and commit messages can be attacker-controlled on fork PRs), engine responses, anything from the scanned site, the ignore file.
- **Validate at the boundary into our types, with allowlists, not denylists.** Unknown values are errors, not defaults.
- URLs: parse with `new URL()`; allow only `https:` / `http:`; reject embedded credentials (`user:pass@`); cap length.
- **Never emit untrusted text raw to the log.** Pass it through the log-safe escaping function in `render.ts` (strips newlines and control characters, caps length) — a line starting with `::` is a **workflow command** (`::add-mask::`, `::stop-commands::`, `::error::`) and untrusted text must never be able to inject one.
- **Escape everything untrusted before it goes into Markdown** (summary, comment, issue): no injected links, images, HTML, `@mentions` or code fences. One escaping function, owned by `render.ts`, used everywhere.

### Fail safe, never fail clean

- If an engine response is missing, malformed or fails validation, the result is `engine-error` — **never** "0 findings". Absence of data is not a clean scan.
- Unknown enum values from the engine (a new severity or state) → treat as an error, not as `low`.

### Network

- The OIDC token is sent **only** to the allowlisted Quandle engine host, over HTTPS, and **never across a redirect** (`redirect: 'error'` on engine requests).
- Every request has a timeout and a response size cap.
- Parse JSON in a `try`, then validate its shape before use.

### Code and supply chain

- **No literal invisible or bidirectional characters anywhere in the repo** (zero-width spaces/joiners, LRM/RLM, bidi overrides and isolates, word joiners, BOM, Unicode tag characters, soft hyphens, variation selectors). Always write them as `\u` escapes (`'\u200b'`). Reviewers must be able to see every character ("Trojan Source"). `npm run check:source` enforces this across the **whole repo** (everything except `node_modules/`, `coverage/`, `.git/`, including `dist/`), locally and in CI.
- **Forbidden:** `eval`, `new Function`, dynamic `require`/`import()` of computed paths, `child_process`/shell, writing files outside the runner's documented files (`GITHUB_STEP_SUMMARY`, `GITHUB_OUTPUT` via `@actions/core`).
- Dependencies pinned to exact versions, lockfile committed, CI uses `npm ci --ignore-scripts` (no dependency install script ever runs in CI). Third-party actions in our workflows pinned by commit SHA, checked out with `persist-credentials: false` (no token left in `.git/config`).
- **Pins are kept current by Dependabot** (`.github/dependabot.yml`: npm + GitHub Actions, weekly; minor and patch updates grouped, **every major update in its own PR**). Every update is a PR that must pass full CI and is reviewed like code. Security alerts are fixed by deliberate upgrades, not by merging overlapping bot PRs: check `npm audit` (runtime and dev) reaches 0, and that `dist/` changes only as expected.
- **Bundled licenses ship with the bundle.** `npm run build` writes `dist/licenses.txt` with the license of every package bundled into `dist/index.js`; the CI "dist is up to date" check covers it.
- **The compiler enforces style where it can:** `noUnusedLocals`/`noUnusedParameters` (no dead code), `verbatimModuleSyntax` (`import type` for types), `exactOptionalPropertyTypes` (a missing field is never `undefined`).
- `dist/index.js` changes are reviewed like source: an unexplained diff in `dist/` is a red flag.
- Use the least GitHub permission needed for each call; never request a new one in code without a rule in `quandle_knowledge.md`.

## Tests

- **Spec first, then test first, for everything** — the enforced process is in `CLAUDE.md` ("Development process"). This section only covers how tests are written.
- **All tests live in `test/`**, never next to the source. Layout:
  - `test/<folder>/<module>/<full function name>.test.ts`: **one file per exported function**, in a folder per source file, under the same folder as in `src/` (`test/scan/target/…`, `test/main/…` for root files).
  - A function with many scenarios gets a folder instead: `test/main/quandle_main_run_action/<scenario>.test.ts`.
  - Private functions get **no** file: they are tested through the exported function that uses them, and listed in its header.
  - Shared fixtures and fakes live in `test/helpers/` (no tests there).
  - **Contract tests** check a repo file against the spec rather than a function (e.g. that `action.yml` declares exactly the inputs in IO-1). They live in `test/contracts/<file name>.test.ts`, with `Tests: <file>` in the header.
- **Every test file header** (in addition to the standard header lines) says exactly what it tests:

  ```ts
  // Tests: src/target.ts → quandle_target_parse_scanUrl
  // Also covers (private): none
  //
  // Proves a scan URL is accepted only when it is http/https, has no embedded
  // credentials, … (what the tests prove, in plain sentences).
  // Rules: TGT-8, TGT-10
  ```

  `Rules:` lists exactly the rule IDs that appear in the file's test names. **`npm run check:rules` enforces this** (locally and in CI), and fails on any rule ID, in `test/` or `src/`, that isn't defined in `quandle_knowledge.md`. It also lists spec rules that have no tests yet (a to-do list, not a failure).
- **At least one** test per rule in `quandle_knowledge.md` (most rules need several: every case, every edge).

### Test names are very descriptive

A failing test's name alone must tell the reader what broke, without opening the file.

- `describe` = the **full function name** under test: `describe('quandle_severity_check_shouldFailJob', …)`.
- Nested `describe` (optional) = the situation: `describe('when the finding is already-present', …)`.
- `it` = **the rule ID in brackets**, then a full sentence: **expected outcome + condition**, with the concrete values that matter.

```ts
describe('quandle_severity_check_shouldFailJob', () => {
  it('[SEV-2] fails the job when a new critical finding exists and fail-on is critical', …);
  it('[SEV-3] does not fail the job when the only critical finding is already-present on the first scan', …);
  it('[SEV-2] does not fail the job for a new high finding when fail-on is critical', …);
  it('[SEV-4] never fails the job when fail-on is never, even with new critical findings', …);
});
```

- No vague names: `it('works')`, `it('handles errors')`, `it('test 1')`, `it('edge case')`.
- Say the value, not "valid/invalid": `'rejects a file: URL as the scan target'`, not `'rejects invalid url'`.
- If the sentence needs "and" between two **outcomes**, it's two tests.
- Test behavior through the public function, not internals.
- **No network in tests.** Network modules take a small injected client interface; tests pass a fake. Don't mock globals or monkey-patch modules.
- Small builders for fixtures (`buildFinding({ severity: 'high' })`, in `test/helpers/`) instead of copy-pasted objects.
- **Type tests** prove rules the compiler enforces (illegal states, read-only data, exhaustive lists). They live in `test/types/`: each line that must not compile is marked `// @ts-expect-error <RULE-ID>: <why>`, so loosening a type makes `npm run typecheck` fail.
- **Every new safety check is proven by a planted failure.** Before trusting a check (a lint script, contract test, type test, leak detector, coverage gate), plant the exact bug it should catch, show it failing, then remove the plant and show it passing. A check that has never failed proves nothing.

## Formatting

**Prettier decides formatting, not people.** Config in `.prettierrc.json`: 2-space indent, single quotes, semicolons, trailing commas, 110 columns, LF line endings. Run `npm run format` before saying done; `npm run format:check` (part of `npm run all` and CI) fails on any unformatted file. Markdown and `LICENSE` are excluded (`.prettierignore`) so spec tables keep their layout. Comments are not rewrapped by Prettier: keep them under 110 columns by hand. The only lines allowed past 110 columns are ones Prettier cannot break: test names (descriptive on purpose) and long string literals. Split anything else into named variables.
