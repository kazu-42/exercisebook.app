# Japanese syllabus and generated-workbook release

The verified primary deployment and exact rollback identity are recorded in
[the 2026-09-22 production record](studio-production-2026-09-22.md).

This is the hosted evaluation authorized by the owner on 2026-09-22.
[ADR-0005](../decisions/0005-syllabus-and-generated-workbooks.md) defines the
new boundaries. The initial fixed build was deployed and passed a real browser
journey at `https://exercisebook-studio-preview.ghive42.workers.dev`.

## Resources

| Resource | Identity | Contents |
| --- | --- | --- |
| Preview Worker | `exercisebook-studio-preview` | Japanese application and bounded APIs |
| Production Worker | `exercisebook-app`, custom domain `exercisebook.app` | Same verified release and storage bindings |
| D1 | `exercisebook-studio`, ID `4c33da0e-e0cf-4439-96f1-e0041203737c` | Immutable original question/answer snapshots, hashed request mappings, render claims |
| Private R2 | `exercisebook-studio-artifacts` | Approved font and immutable PDF bytes |
| Browser binding | `BROWSER` | Bounded PDF rendering of the print projection |

No user identity, submitted answers, scores, or syllabus plans are persisted.
R2 has no public bucket URL. Downloads pass through the Worker and use
`Cache-Control: private, no-store`. Do not add public R2 access or diagnostic
body/header logging.

## Prepare storage

The additive migration was applied to remote and local D1 on 2026-09-22.
The pinned font was uploaded to the private remote and local bucket. Repeating
the migration command is safe; do not recreate the resources on each deploy.

```sh
pnpm exec wrangler d1 migrations apply STUDIO_DB --config apps/studio/wrangler.jsonc --remote
pnpm exec wrangler r2 object put exercisebook-studio-artifacts/fonts/c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f.ttf \
  --file apps/studio/assets/fonts/noto-sans-jp/NotoSansJP-wght.ttf \
  --content-type font/ttf --remote
```

Use `--local` with the same config for local verification. All production
rendering checks the font's exact byte length and SHA-256 before launching a
browser. The OFL license and attribution remain vendored with the font.

## Verify and deploy

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm audit:dependencies
pnpm studio:pdf:samples
pnpm studio:release
pnpm studio:deploy:check
pnpm studio:worker
```

The release build retains the eighteen immutable sample books and thirty-six
sample PDFs. The separate generated-PDF gate checks 1,536 generated sets and
renders twelve stress-case PDFs across all six topic/level combinations.
It extracts and validates all twenty-four pages and produces visual evidence.
These are bounded representative layout checks, not a proof for every seed.

Wrangler's local Browser Run binding downloads its own Chrome on first use.
The first download is not part of the application's thirty-second render
budget; prepare the local browser before accepting a smoke result. A timeout
must remain a visible failed PDF request while the Web worksheet stays usable.

The local PDF subprocess deliberately inherits no package-registry or CI
credentials, including uv's custom cache setting. CI installs its pinned
Playwright dependency with `env -u UV_CACHE_DIR` so the offline subprocess can
read the same default cache. Installing only into setup-uv's temporary cache
does not prepare the offline renderer.

Run the local journey with the built Worker, then deploy the same checked bytes:

```sh
uv run --no-project --with playwright==1.63.0 python apps/studio/scripts/smoke.py \
  --base-url http://127.0.0.1:4180 --output output/studio-worker
pnpm studio:deploy
uv run --no-project --with playwright==1.63.0 python apps/studio/scripts/smoke.py \
  --base-url https://exercisebook-studio-preview.ghive42.workers.dev \
  --output output/studio-hosted
```

Also verify syllabus creation, week navigation, precise session start, retained
plan state on return, mobile 320/390 px, and the separate syllabus print layout.
Record release ID, source revision/digest, exact Cloudflare version, prior
version, API replay/conflict results, and downloaded PDF hashes. The checked
release package is archived under `output/studio-releases/<releaseId>/`.

`pnpm studio:dev` and `pnpm studio:preview` both run the checked Worker at
`http://127.0.0.1:4180`. They require a built release and the local D1/font setup;
there is no separate in-memory API that can bypass immutable persistence.

After preview verification, promote the same release with
`pnpm studio:deploy:production`. Disable `LEARNING_NEW_PRODUCTION_ENABLED` only
during the contract transition, update the scheduled check to the Studio
implementation, and restore it after the primary-origin smoke passes.
The prior production version is `5892fa23-56f5-4e9e-a08e-0c9a925b75af`.
Rollback uses `wrangler rollback <version> --config apps/studio/wrangler.production.jsonc`
and the matching previous synthetic.

The production action-domain redirect remains side-effect-free. Its target is
always the canonical `https://exercisebook.app/new`. Promotion must update the
production synthetic's implementation to the Studio contract before enabling
scheduled checks for the new release. The new readonly checker is:

```sh
node --experimental-strip-types scripts/smoke-studio-synthetic.ts \
  --primary https://exercisebook.app --action https://learning.new
```

It exercises an unsaved plan and never creates durable workbooks or invokes the
PDF browser. Full PDF verification remains a release smoke, rather than a
five-minute storage-generating probe.

## Failure and rollback

- A generated create requires a valid UUID `Idempotency-Key`. Retry the same
  key and conditions after a timeout; a 409 means different conditions reused it.
- The API must commit and re-read a hash-verified snapshot before presenting it.
  Missing storage returns 503; it never returns a fixed sample as recovery.
- PDF creation is an explicit same-origin POST with `{}` and one variant.
  The first result is retained and retries return those same bytes.
- A busy render or exhausted capacity returns 503 and `Retry-After: 60`.
  A job lease lasts sixty seconds; only the current token and lease may commit.
  A process crash can leave an unreferenced content-addressed object. Never
  garbage-collect shared objects solely because one job failed.
- Do not delete a completed pointer to repair a corrupt/missing object silently.
  Investigate storage, retain the snapshot, and publish a new renderer policy
  if a new artifact is needed. Keep old hash-addressed bytes immutable.
- Cloudflare Observability records fixed failure event names. Inspect aggregate
  create/render failures and rate limits without adding learner data to logs.
- Roll back a complete known-good Worker version. The new tables and private
  bucket are additive and should remain intact during rollback. Old UI sessions
  may receive an explicit unavailable response; they must never receive another
  workbook under the old ID. Restore the action domain's static redirect if it
  is ever changed separately.

The first hosted fixed version is `c766a968-110d-4417-a822-9cf8a5be1c67`, release
`studio-rc-64992f16e599460012f09af8aa15690a0e0175769dcb8aa1866525c3bf12bab4`.
Its hosted smoke passed creation, grading, both PDFs, mobile 320/390 px,
keyboard navigation, and injected create/grade/PDF failure recovery.
