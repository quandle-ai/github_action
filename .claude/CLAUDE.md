# Quandle GitHub Action

Open-source thin client for Quandle: resolves the deploy URL, authenticates with GitHub OIDC, calls the closed Quandle engine, renders results. **All detection logic lives in the engine, never here.** This repo will be public and it's a security tool — the code is part of the trust story, people will read it.

Read these before writing code:

- @coding_style.md — naming, functions, types, modules, DRY, comments, errors, security, tests, formatting
- @quandle_knowledge.md — domain rules the code must follow (targeting, severity, ignores, trust boundary)

`quandle_knowledge.md` is the source of truth for behavior. If the code and it disagree, **stop and ask** — don't silently pick one. If a change needs a new rule, propose the rule first.

## Working rules

- **No code without an explicit "go"** from the maintainer for that piece of work. Planning and docs are fine.
- Work on a branch. **Never commit or push unless asked.**
- **Small, reviewable diffs.** The maintainer reviews every line. One concern per change; no drive-by refactors.
- **No new dependencies without approval.** Pin exact versions (`"1.2.3"`, not `^`). Prefer the standard library.
- Don't decide product, licensing, branding or public-facing wording — propose and ask. User-visible messages and descriptions (error texts, warnings, `action.yml` descriptions, example-workflow comments) are shown **verbatim in the change report**; approving the change approves them. README, Marketplace text and anything marketing-like is always asked about separately.
- After a change: list every file touched and why, and call out any decision you made that isn't already in `quandle_knowledge.md`.
- This repo is public. Never put private material in it: no business plans, research data, pricing or engine internals.

## Development process: spec first, then test first (enforced, no exceptions)

Every change to behavior goes **spec → failing test → code → refactor**, in that order. Skipping or reordering a step means the work is rejected and redone, however small the change. "It's a one-liner" is not an exception. Neither is "I'll add tests after".

### 1. Spec (`quandle_knowledge.md`)

- **No behavior without a spec rule.** Every behavior the code has must be stated in `quandle_knowledge.md` *before* any test or code for it exists.
- A new or changed rule is **its own step**: propose the exact wording, get the maintainer's approval, then write it into the file. Never in the same breath as the code. This includes wording you add while implementing an approved idea: show it **before** writing it, never flag it afterwards.
- Found an ambiguity or gap while testing or coding? **Stop.** Propose a spec change. Never resolve it in code or in a test.
- Code doing something the spec doesn't say (extra behavior, "helpful" defaults, silent fallbacks) is a defect, even if it works.

### 2. Red: failing test

- Write the test(s) for the rule first, in `test/`, named per `coding_style.md`.
- **Run them and show the failure output.** It must fail for the right reason (on the behavior, not a typo or missing import). Valid kinds of red:
  - **A failing assertion** against a signature-only stub (`not implemented`) or the current code. The normal case.
  - **A typecheck failure** for type rules: a `// @ts-expect-error` line reported as unused means the illegal code still compiles.
  - **The `check:rules` untested list**, for a rule that exists but has no test yet.
- **Pinning tests** cover behavior that is already correct (e.g. a leak sweep) and pass immediately. Allowed only when declared as pinning in the report **and** proven able to fail with a planted bug (see `coding_style.md`).
- Every spec rule has at least one test; every test traces to a spec rule. A test with no rule means the spec is missing something. A rule with no test is not done.

### 3. Green: minimal code

- Write the **least** code that makes the failing test pass. No extra branches, options or "while I'm here" generalisation.
- **Never write production code without a failing test that requires it.**
- Run the full suite and show it passing.

### 4. Refactor

- Clean up (naming, DRY, structure per `coding_style.md`) only while all tests are green. Re-run after.

### Hard rules

- **Never edit, weaken, skip (`.skip`, `.only`, `todo`) or delete a test to make it pass.** A test changes only for one of these reasons, always stated explicitly:
  - an approved spec change;
  - a move or split between files, with the total test count reported before and after (it must match);
  - a fixture or builder change forced by stricter types, with every assertion unchanged;
  - a runtime test replaced by a type test, once the state it checked can no longer be written (the type test covers the same rule ID).
- **Bug fixes start with a failing test that reproduces the bug**, then the fix.
- I/O modules (`api.ts`, `github.ts`, `runtime.ts`) are TDD'd too, through injected fakes.
- Code without tests is not done, whatever it does.

### Reporting each change

Show, in order: the spec rule (quoted), the red test run output, the green test run output, and the list of files touched.

## Before saying "done"

Run `npm run all` and report the actual output. It runs, in order: `check:source` (no invisible characters, whole repo), `check:rules` (rule IDs traceable), `format:check` (Prettier), `typecheck` (strict `tsc`), `test:coverage` (all tests, 100% coverage of `src/`), and `build` (`dist/index.js` and `dist/licenses.txt`). Both `dist/` files must be rebuilt and match the source. Line endings are LF.
