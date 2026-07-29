# Security Policy

## Supported versions

| Version or branch | Supported |
| --- | --- |
| Latest release on `main` | Yes |
| `dev` | Best effort |
| Older branches and releases | No |

## Reporting a vulnerability

Do not open a public issue, discussion, or Discord thread for a suspected
vulnerability.

Use GitHub's private vulnerability reporting flow:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Include reproduction steps, impact, the affected version or commit, and any
   suggested mitigation.

If private reporting is unavailable, contact a maintainer directly and share
the details privately.

## Response targets

- Initial triage response: within 7 days.
- Status update after validation: within 14 days.
- Fix and disclosure timing depends on severity, exploitability, and release
  risk.

## Scope

This policy covers the dmbdb frontend, its Nuxt server middleware, embedded
service proxying, WebSocket routing, authentication-related browser behavior,
dependencies, and repository workflows.

Reports that originate in the DUMB backend should follow the
[DUMB security policy](https://github.com/I-am-PUID-0/DUMB/security/policy).
Vulnerabilities in an upstream application embedded by dmbdb should normally
be reported to that application's maintainers unless dmbdb introduces or
amplifies the issue.

## Safe handling

Do not include live credentials, tokens, cookies, API keys, personal data, or
private deployment details in a report unless they are essential and have been
redacted as far as possible.
