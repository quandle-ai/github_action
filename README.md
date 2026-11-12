# Quandle GitHub Action

Quandle checks every deploy from the outside, the way a visitor's browser sees it, and tells you only when that deploy exposed something new: secrets in shipped JavaScript, public source maps, CORS and security header problems, and exposed files such as `/.env`.

To install it, copy [`examples/quandle-install.yml`](examples/quandle-install.yml) into `.github/workflows/`. It works as-is. Full setup and documentation: [quandle.ai](https://quandle.ai).

## FAQ

**What does it send to Quandle?**
The deploy URL, the environment name, whether it is a production deploy, and the Vercel bypass secret if you set one. Never your source code. Your repository is identified through GitHub OIDC, so there is no API key to manage.

**Will it fail my build?**
Only for a *new* finding at or above `fail-on`, which defaults to `critical`. Findings that were already there before never fail the job. Set `fail-on: never` to only report.

**How do I turn on exposed-file checks?**
Quandle only requests files such as `/.env` and `/.git/HEAD` from a site that proves it belongs to your repository. The job summary shows one line; serve it in a file at `/.well-known/quandle.txt` (in Next.js, Vite and Astro, that is `public/.well-known/quandle.txt`). Preview deploys are covered too, since the file ships with your code.

**How do I ignore a finding?**
Add it to `.quandle-ignore.yml` on your default branch, by finding id or rule, with a reason and an expiry date up to a year out.

**How do I get updates?**
Use `@v1`. It moves to each new 1.x release automatically. If you pin a commit instead, as in [`examples/quandle-hardened.yml`](examples/quandle-hardened.yml), Dependabot can keep it current.

[MIT](LICENSE) © Feudal Security, LLC. Security issues: please report privately, see [SECURITY.md](SECURITY.md).
