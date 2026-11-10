# Security policy

Quandle is a security tool, so we treat reports about it as urgent.

## Reporting a vulnerability

Please report privately, never in a public issue:
use **Security → Report a vulnerability** on this repository,
or email **security@quandle.ai**.

Include what you found, how to reproduce it, and what an attacker could do with it.

## Scope

- This Action's code (`src/`, `dist/index.js`), its example workflows, and anything it writes:
  logs, job summaries, PR comments, issues and outputs.
- Anything that leaks a secret, a token or a URL's query string, injects Markdown or workflow
  commands, or sends data anywhere other than the Quandle engine and the GitHub API.

The Quandle engine is not in this repository. Report engine issues the same way; we route them.

## Supported versions

Only the latest `v1` release receives fixes.
