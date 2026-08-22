# learning.new V1 launch runbook

This runbook prepares and verifies the approved anonymous, unsaved, one-lesson
launch. It deliberately stops before production custom-domain or DNS changes.

The first complete preview verification is recorded in
[the 2026-08-22 release evidence](learning-new-launch-evidence-2026-08-22.md).

## Release identities

- primary Worker: `exercisebook-app`;
- action Worker: `learning-new-redirect`;
- release manifest: `learning-new-launch-2026-08-22`;
- planner policy: `day-one-fraction-preview@4`;
- content: `math.fractions.add-unlike-denominators@3`;
- content hash:
  `5b852e6db8ac41e9ab632365b362e3408c9ace58a6f87c7ad9965727e2b28a85`;
- source hash:
  `9654184d51610bbbdd82ce6b3d0f33de0addb51bc0427c99ef4ecc62a1983047`.

## Local release gate

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @exercisebook/web build
uv run --with playwright playwright install chromium
pnpm --filter @exercisebook/web preview --host 127.0.0.1 --port 5173
```

In another terminal:

```bash
uv run --with playwright python scripts/launch-browser-smoke.py
```

Review the desktop, mobile, and print captures under
`output/browser-smoke/`. No custom domain is involved in this gate.

## Preview deployment

Authenticate with Wrangler, build once, and deploy distinct preview Worker
names. The generated primary configuration contains the reviewed asset and
rate-limit bindings.

```bash
pnpm --filter @exercisebook/web build
pnpm exec wrangler deploy \
  --config apps/web/dist/exercisebook_app/wrangler.json \
  --name exercisebook-app-preview

pnpm exec wrangler deploy \
  --config apps/learning-new-redirect/wrangler.jsonc \
  --name learning-new-redirect-preview
```

Record each returned `workers.dev` URL, version ID, source commit SHA, UTC/JST
deployment time, and the previous version ID. Do not add `routes`,
`custom_domains`, or DNS records.

Run the remote smoke against those exact URLs:

```bash
pnpm exec tsx scripts/smoke-learning-new.ts \
  --primary https://PRIMARY_PREVIEW.workers.dev \
  --action https://ACTION_PREVIEW.workers.dev
```

## Monitoring and synthetic contract

The synthetic check runs every five minutes after production promotion and
alerts after two consecutive failures. It checks:

- action `GET /?token=synthetic` returns `302` with the exact query-free
  primary URL and no cookie;
- primary `/` returns `302 /new`;
- primary `/new` returns reviewed HTML and security headers;
- health identifies `learning-new-v1`;
- one bounded 8-minute POST returns `saved: false`, four student items, and CC
  BY 4.0 attribution;
- representative prototype routes remain `404`.

Workers Observability is enabled for both Workers. Application error logs are
limited to event name, route class, method, and error class. Request/response
bodies, URLs, query strings, headers, IP addresses, seeds, answers, and stack
traces are not logged by application code. Rate-limit `429` counts and
aggregate `5xx` counts are the first operational signals.

## Rollback rehearsal

Before production promotion, list versions and identify the prior known-good
version for each preview Worker:

```bash
pnpm exec wrangler versions list --name exercisebook-app-preview
pnpm exec wrangler versions list --name learning-new-redirect-preview
```

Rehearse rollback on the preview names only, then rerun the remote smoke. Never
rehearse against a production custom domain. The action rollback target must
still be the static, side-effect-free redirect to
`https://exercisebook.app/new`.

Use the exact recorded prior IDs and require non-interactive confirmation only
after checking each target with `versions view`:

```bash
pnpm exec wrangler versions view PRIMARY_PRIOR_VERSION \
  --name exercisebook-app-preview
pnpm exec wrangler rollback PRIMARY_PRIOR_VERSION \
  --name exercisebook-app-preview --yes

pnpm exec wrangler versions view ACTION_PRIOR_VERSION \
  --name learning-new-redirect-preview
pnpm exec wrangler rollback ACTION_PRIOR_VERSION \
  --name learning-new-redirect-preview --yes
```

For a first preview release with no older known-good version, deploy the same
reviewed source SHA twice, smoke the first version, and roll the second
deployment back to that already-smoked version. This rehearses the Cloudflare
rollback mechanism without inventing a different fallback artifact.

## Production GO / STOP gate

GO requires all of the following at one exact source SHA:

- local `pnpm check`, browser smoke, PR review, and CI are green;
- both preview URLs pass the remote smoke and rollback rehearsal;
- deployed version IDs and source SHA are recorded;
- `exercisebook.app` and `learning.new` remain unattached/non-resolving;
- monitoring ownership and alert destination are confirmed;
- the owner explicitly authorizes production custom-domain/DNS promotion.

STOP for any failed or missing item, any unexpected public route, release
authority drift, missing rate-limit binding, unreviewed content, unresolved
TLS/DNS ownership, or absent explicit final GO.

After a final GO, attach `exercisebook.app` first and prove the primary flow.
Attach `learning.new` only after the primary origin is green. Read back DNS,
TLS, redirect, creation, monitoring, and rollback identities separately.
