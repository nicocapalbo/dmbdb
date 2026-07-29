# Repository Guidelines for Agents

## Project purpose

dmbdb is the Nuxt 4 frontend for DUMB (Distributed Unlimited Media Bridge). It
provides onboarding, service controls, configuration, logs, metrics, database
tools, notifications, AI diagnostics, and embedded service UIs. Nuxt server
middleware proxies DUMB APIs, service HTTP traffic, and WebSockets so browser
traffic stays on one origin.

## Companion repositories

- Backend: <https://github.com/I-am-PUID-0/DUMB>
- Frontend: this repository
- Documentation: <https://github.com/I-am-PUID-0/DUMB_docs>

Coordinate backend API or capability changes with DUMB. Update DUMB_docs for
user-facing flow, setting, onboarding, or troubleshooting changes.

## Development and validation

Run repository commands inside the `dmbdb_dev` devcontainer.

```bash
pnpm install --frozen-lockfile
pnpm test:log-parsers
pnpm build
```

The supported baseline is Node 24 and pnpm 10. Add focused tests under `tests/`
for reusable behavior.

## Important areas

- `server/middleware/proxy.js` and `server/plugins/websocket.ts` are
  security-sensitive cross-service routing boundaries.
- `server/utils/` contains server-only routing and cookie helpers.
- `components/onboarding/`, `pages/onboarding.vue`, and `stores/onboarding.js`
  own guided setup.
- `pages/services/[id].vue` and its components own service-page workflows.
- `stores/`, `services/`, and `plugins/axios.js` define API state and auth
  behavior.

## Safety and compatibility

- Keep DUMB API routes isolated from embedded service root APIs and WebSockets.
- Do not log or forward tokens, cookies, credentials, or unrelated
  shared-origin headers.
- Gate new backend-dependent behavior by capabilities when compatibility
  matters.
- Do not commit `.env`, generated output, dependencies, caches, or local
  deployment data.

Normal changes target `dev`; `main` is the release branch. Keep changes local
for user review unless explicitly asked to commit or publish.
