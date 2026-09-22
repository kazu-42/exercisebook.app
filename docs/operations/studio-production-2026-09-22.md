# Japanese syllabus release — 2026-09-22

The owner explicitly requested deployment and educational syllabus design.
This release promotes the original Japanese material and deterministic
workbook generator under the hosted-evaluation decision in ADR-0005.

## Deployed identities

| Item | Value |
| --- | --- |
| Primary origin | `https://exercisebook.app` |
| Action origin | `https://learning.new` redirects to `https://exercisebook.app/new` |
| Primary Worker | `exercisebook-app` |
| Primary version | `a6e263ab-2dc0-4314-9ec2-198be93778ed` |
| Prior primary version | `5892fa23-56f5-4e9e-a08e-0c9a925b75af` |
| Verified preview version | `af2a29f7-74cd-4447-a75f-e2e98b5a12b9` |
| Release | `studio-rc-b0f8ec5e8a42d425a34d348d46a15adcbc9d4bac50a5f3c1f29230fc20ce6db5` |
| Runtime source commit | `bbc3c3333dc9cd1e89761d0e447b4823e8b86850` |
| Source inventory SHA-256 | `d9eebb1a05649701af977110a7e42bac639f3ccc1c23fa59c49092905f6405ca` |

The primary deployment completed before 2026-09-22 10:55:56 UTC. It uses the
same checked artifact package as the preview. Later documentation commits do
not change the recorded runtime source or regenerate released artifacts.
The exact package is archived in `output/studio-releases/<releaseId>/`.

## Verification

[CI run 35717888225](https://github.com/kazu-42/exercisebook.app/actions/runs/35717888225)
passed all three jobs: 53 files / 821 tests, TypeScript 7, formatting, compiled
content, dependency boundaries, builds, dependency audit and eight ZIP patch
regressions, preserved V1 artifacts, eighteen studio samples / thirty-six PDFs,
and the local Worker browser journey. The generated-PDF gate independently
checked 1,536 eight-item sets (12,288 answers), twelve PDFs and twenty-four pages.

Hosted syllabus verification covered two-week partial and four-week plans,
canonical JSON download, desktop and 390/320 px layouts, same-session replay,
initially hidden checkpoint examples, all-week printing, and zero axe violations.
Hosted workbook verification covered real creation, grading, both PDF variants,
keyboard interaction, and injected creation/grading/PDF failure recovery.

The real cloud API returned the same snapshot on same-key replay, 409 on
conflicting conditions, and a different hash for a new creation key. A key
created before the font compatibility deployment returned its original bytes
afterward. Generated PDF GET requests returned 405; creation uses POST.

| Cloud artifact | First generation | Cached replay | Size | SHA-256 |
| --- | --- | --- | --- | --- |
| Eight-item standard equations, student | 8.573 s | 1.022 s | 633,743 bytes | Recorded in `output/studio-cloud-generated/pdf-proof.json` |
| Same instance, answers | 14.055 s | 0.438 s | 475,611 bytes | Recorded in the same proof |

Each PDF has two A4 pages, the correct instance identity, ordered content,
embedded Noto fonts, and no student-answer leakage. Page images were visually
inspected. Primary-origin replay returned the exact preview workbook and PDF
bytes with `Cache-Control: private, no-store`, using the existing D1/R2 records.
The temporary verification key was erased after that check and is absent from
logs and evidence files.

Evidence directories are `output/studio-worker-final`, `output/studio-hosted-final`,
`output/studio-production`, `output/studio-syllabus-hosted`,
`output/studio-syllabus-production`, and `output/studio-cloud-generated`.

## Monitoring and rollback

The first primary browser check detected a zone-injected Cloudflare Web
Analytics script. CSP blocked it before execution. The application subsequently
adds `no-transform` to private/no-store HTML responses, keeping JS/CSS
compression unchanged, and the synthetic requires this protection. Cloudflare
documents [automatic-injection exclusion](https://developers.cloudflare.com/web-analytics/get-started/#sites-proxied-through-cloudflare)
and [the general no-transform directive](https://developers.cloudflare.com/cache/concepts/cache-control/#other).
The zone's RUM configuration was not changed; the current Wrangler OAuth lacks
Account Settings Write. The deployment must be verified with a real browser,
because curl responses did not reproduce the injection.

The scheduled workflow now runs `scripts/smoke-studio-synthetic.ts`. It checks
the action redirect, primary assets, health, catalog, and a bounded unsaved plan.
It does not create durable workbooks or spend Browser Run time. During the
contract transition, `LEARNING_NEW_PRODUCTION_ENABLED` is disabled; restore it
after the new workflow is merged, then dispatch and verify the production run.

Rollback restores the complete prior primary version with
`pnpm exec wrangler rollback 5892fa23-56f5-4e9e-a08e-0c9a925b75af --config apps/studio/wrangler.production.jsonc`.
Disable the new synthetic during rollback and use the preserved legacy checker
until its matching workflow is restored. Leave the additive D1 tables, stored
snapshots, private R2 objects, and action-domain redirect intact.

The released scope is six foundational algebra skills across signed numbers,
expression values, and linear equations. Plans are anonymous and unsaved;
JSON export and print are available. There is no learner account, persistent
history, evidence-based mastery claim, or full secondary-school syllabus.
