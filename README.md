<div align="center">
  <h1>DUMB Frontend</h1>
  <p><strong>The unified web interface for Distributed Unlimited Media Bridge.</strong></p>
  <a href="https://github.com/I-am-PUID-0/DUMB">
    <img
      alt="Distributed Unlimited Media Bridge ecosystem"
      src="https://dumbarr.com/assets/images/DUMB.png"
      style="max-width: 100%; height: auto;"
    />
  </a>
</div>

<div align="center">
  <a href="https://github.com/nicocapalbo/dmbdb/releases">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/nicocapalbo/dmbdb?style=for-the-badge" />
  </a>
  <a href="https://discord.gg/8dqKUBtbp5">
    <img alt="Join the DUMB Discord" src="https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?style=for-the-badge&logo=discord&logoColor=white" />
  </a>
  <a href="https://dumbarr.com">
    <img alt="DUMB documentation" src="https://img.shields.io/badge/Docs-dumbarr.com-00b8ff?style=for-the-badge" />
  </a>
  <a href="LICENSE">
    <img alt="License: GPL v3" src="https://img.shields.io/badge/License-GPLv3-blue?style=for-the-badge" />
  </a>
  <a href="https://github.com/nicocapalbo/dmbdb/actions/workflows/codeql.yml">
    <img alt="CodeQL" src="https://img.shields.io/github/actions/workflow/status/nicocapalbo/dmbdb/codeql.yml?branch=main&amp;label=CodeQL&amp;style=for-the-badge" />
  </a>
</div>

## About

`dmbdb` is the Nuxt 4 frontend shipped with
[DUMB](https://github.com/I-am-PUID-0/DUMB)—**Distributed Unlimited Media
Bridge**. It communicates with the DUMB API and reverse proxy to provide one
place to configure, operate, and troubleshoot the complete media stack.

Most users should run the maintained DUMB container rather than deploying this
repository separately. DUMB installs, builds, starts, and updates the frontend
alongside its API and managed services.

## Highlights

- Unified service dashboard with lifecycle controls, health, ordering, filters,
  dependency views, and update notices
- Guided onboarding for Debrid, Usenet, and hybrid workflows
- Per-service configuration, live logs, metrics, database health, and embedded
  upstream service interfaces
- Symlink repair, snapshots, scheduled backups, and job tracking
- Guarded SQLite-to-PostgreSQL migration workflows
- Optional notifications and AI-assisted diagnostics with redacted bundle
  previews
- JWT authentication, responsive layouts, and operator-focused navigation

See the [frontend documentation](https://dumbarr.com/frontend/) for complete
usage guides.

## Local development

Requirements:

- Node.js 24
- pnpm 10
- A reachable DUMB API

Set the backend address in a local `.env`:

```dotenv
DUMB_API_URL=http://127.0.0.1:8000
DUMB_TRAEFIK_URL=http://127.0.0.1:18080
```

DUMB-managed frontend processes receive the current Traefik URL automatically.
Set `DUMB_TRAEFIK_URL` explicitly only when running dmbdb separately or when
Traefik is not reachable at the default address from the frontend container.

Then install and start the development server:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The frontend listens on `http://localhost:3005` by default. Its server
middleware proxies DUMB API, WebSocket, and embedded service UI traffic so
browser requests remain on one origin.

## Validation

```bash
pnpm test:log-parsers
pnpm build
```

The project requires Node 24 and pnpm 10 as declared in `package.json`.

## Contributing, support, and security

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- Use [SUPPORT.md](SUPPORT.md) to choose the right support channel.
- Report vulnerabilities privately as described in
  [SECURITY.md](SECURITY.md); do not open a public security issue.
- Participation is governed by the
  [Code of Conduct](CODE_OF_CONDUCT.md).

dmbdb is licensed under the
[GNU General Public License version 3](LICENSE).

## Project links

- [DUMB repository](https://github.com/I-am-PUID-0/DUMB)
- [DUMB documentation](https://dumbarr.com)
- [Frontend guides](https://dumbarr.com/frontend/)
- [dmbdb releases](https://github.com/nicocapalbo/dmbdb/releases)
- [Security policy](SECURITY.md)
- [Contributor guide](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
