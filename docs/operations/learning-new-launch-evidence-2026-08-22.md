# learning.new V1 preview release evidence — 2026-08-22

This is the non-production evidence record for the approved anonymous,
unsaved, one-English-lesson V1 launch. It does not authorize or record a
production custom-domain or DNS change.

## Runtime source and review identity

- reviewed runtime source SHA:
  `dc8363274833c176a1b988a1b0bdad6be7e0af79`;
- runtime source tree: `13ceb39efd230bb4a51582176cafbbb1c3fe71a8`;
- branch: `release/learning-new-v1`;
- pull request: `https://github.com/kazu-42/exercisebook.app/pull/9`;
- runtime exact-head CI run: `32551937135`;
- CI jobs: `Format, types, tests, and build` and
  `Production bundle browser smoke`, both successful.

The documentation commit containing this record necessarily has a later SHA.
Its exact-head CI and final main ancestry are GitHub closeout evidence rather
than self-referential fields in this source file.

## Local and CI gates

- `pnpm install --frozen-lockfile`: passed;
- `pnpm audit`: no known vulnerabilities;
- `pnpm check`: passed with TypeScript 7.0.2, 32 test files and 511 tests,
  schema/content/import-boundary gates, both Worker builds, a four-artifact
  public client bundle, and historical sample replay;
- production-bundle Playwright smoke: passed through keyboard creation at
  desktop and mobile sizes, with visually reviewed print output;
- browser evidence found no cookie, Web Storage, IndexedDB, third-party
  request, console error, failed first-party request, prototype route, answer
  authority, or release-authority token.

## Preview deployments

Primary preview:

- URL: `https://exercisebook-app-preview.ghive42.workers.dev`;
- first known-good version: `a50e20f1-75c0-43b6-82e9-16d10468ab36`;
- rehearsal version: `4d60e165-4356-4175-b3bc-61bfa1323ab0`;
- bindings: reviewed Static Assets plus
  `PREVIEW_RATE_LIMITER` at 120 requests per 60 seconds.

Action preview:

- URL: `https://learning-new-redirect-preview.ghive42.workers.dev`;
- first known-good version: `476121a1-2edc-44e8-8dc3-89f7fed6ff71`;
- rehearsal version: `5a5a9faf-43c4-4633-b95b-e7bbd95a3865`;
- bindings: none.

The rehearsal versions carried the exact Git SHA in their Cloudflare version
message. Both rehearsal versions passed the complete remote smoke. Each Worker
was then rolled back to its first already-smoked version at 100% traffic, and
the complete remote smoke passed again. Cloudflare deployment readback showed
the first known-good version active at 100% for both Workers.

The first action smoke was issued immediately after initial deployment and
received one transient `500`. Direct GET/HEAD readback seconds later returned
the expected `302`, and the complete smoke passed before the version was
accepted as known-good. Neither the issue nor an application exception was
reproduced across the rehearsal deployment or post-rollback smoke. Production
promotion must therefore include a bounded propagation wait and repeated
external readback rather than treating the deploy command as readiness proof.

## Public domain readback

Read back at `2026-08-22T04:35:41Z`:

- both registrations were active through July 2027 and had
  `client transfer prohibited` registrar status;
- both remained delegated to `anna.ns.cloudflare.com` and
  `damon.ns.cloudflare.com`;
- public DNS-over-HTTPS returned no A, AAAA, or CNAME answer for either domain;
- HTTPS could not resolve, so no production origin or action flow was exposed;
- RDAP reported `zoneSigned: true` but `delegationSigned: false`, and public DS
  lookup returned no domain DS record. DNSSEC delegation is therefore not yet
  a verified GO item.

At that readback there were about 58.4 days to the 2026-10-20 readiness target
and 65.7 days to the 2026-10-27 06:48:39 JST hard policy point.

## Remaining production STOP gates

- PR #9 must be merged and final main ancestry read back;
- the production monitoring owner and alert destination must be confirmed;
- registrar auto-renewal, account MFA, and recovery contacts are not proven by
  public RDAP and require account-level readback;
- DNSSEC delegation, production TLS/custom-domain ownership, and attachment
  order require an explicit owner GO;
- attach `exercisebook.app` first and prove the primary flow before attaching
  `learning.new`.

Until those gates are closed, both production domains remain intentionally
non-resolving. The tested `workers.dev` previews are not production DNS.
