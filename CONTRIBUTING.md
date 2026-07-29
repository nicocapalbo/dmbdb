# Contributing to dmbdb

Thanks for contributing to the DUMB frontend.

## Branch model

- `dev` is the collaboration and integration branch.
- `main` is the production and release branch.
- Open normal feature and bugfix pull requests against `dev`.

## Basic workflow

1. Fork the repository.
2. Create a focused branch from `dev`.
3. Make the change and add or update tests where practical.
4. Run the relevant validation commands.
5. Update DUMB_docs when user-facing behavior changes.
6. Open a pull request to `dev`.

Use Conventional Commit style for commits and pull request titles, for example
`fix(proxy): preserve embedded websocket routing`.

## Development environment

The supported local baseline is:

- Node.js 24
- pnpm 10
- A reachable DUMB API

The repository devcontainer provides the expected Node runtime. When working
outside it, install the versions declared in `package.json`.

Create a local `.env` with the backend address:

```dotenv
DUMB_API_URL=http://127.0.0.1:8000
```

Then install dependencies and start Nuxt:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Do not commit `.env`, tokens, cookies, API keys, private hostnames, or other
deployment-specific values.

## Required checks

Run the same core checks used by CI:

```bash
pnpm install --frozen-lockfile
pnpm test:log-parsers
pnpm build
```

For dependency changes, also run:

```bash
pnpm audit --audit-level moderate
```

If a check cannot be run, explain why in the pull request.

## Testing guidance

- Add focused Node tests under `tests/` for reusable helpers, parsers, proxy
  routing, cookie handling, provider metadata, and normalization logic.
- Test browser-facing changes at desktop and mobile widths.
- For embedded UI changes, verify normal DUMB API routes remain isolated from
  service-root APIs, app routes, static assets, and WebSockets.
- For auth, proxy, or cookie changes, check that secrets are not logged or
  forwarded to unrelated services.
- Include screenshots for visible UI changes when they help reviewers.

## Cross-repository coordination

dmbdb is the frontend for the
[DUMB backend](https://github.com/I-am-PUID-0/DUMB), and
[DUMB_docs](https://github.com/I-am-PUID-0/DUMB_docs) documents both projects.

- If a frontend change depends on a new API, capability, config key, or
  response shape, coordinate the backend change and state the required release
  order.
- If a change affects onboarding, settings, service pages, operator workflows,
  or troubleshooting, update DUMB_docs in the same logical change.
- Prefer capability-gated additions so newer frontends remain usable with
  older supported backends.

## Pull request expectations

- Keep the change scoped to one logical purpose.
- Explain the problem, implementation, and validation.
- Link related issues.
- Call out security, compatibility, migration, or rollout concerns.
- Do not commit generated Nuxt output, dependencies, local caches, or runtime
  data.

By contributing, you agree that your contribution is licensed under the
[GNU General Public License version 3](LICENSE).
