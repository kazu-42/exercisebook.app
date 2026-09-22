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
| Primary version | `95e80df1-4680-42b6-9e92-3e4e52d7d4a6` |
| Prior primary version | `5892fa23-56f5-4e9e-a08e-0c9a925b75af` |
| Verified preview version | `ad91f915-b453-4d57-8cd8-4813637fd4c9` |
| Release | `studio-rc-2585a4a4b1f925028944ab5687bdd24a00271d089f89da0c91a54c82c9540938` |
| Runtime source commit | `3aa933dae5aad771f3818652d5fb38ac8a58ffbb` |
| Source inventory SHA-256 | `65f18bd1080990080828a14c294d214b3f20b5fd3c06020f1899cf8af7405b73` |

The initial primary promotion completed before 2026-09-22 10:55:56 UTC as
`a6e263ab-2dc0-4314-9ec2-198be93778ed`. The final HTML-protection update completed
before 11:07:13 UTC. It uses the same checked artifact package as the preview.
Later documentation commits do
not change the recorded runtime source or regenerate released artifacts.
The exact package is archived in `output/studio-releases/<releaseId>/`.

## Verification

[CI run 35719321632](https://github.com/kazu-42/exercisebook.app/actions/runs/35719321632)
passed all three jobs: 53 files / 824 tests, TypeScript 7, formatting, compiled
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
Account Settings Write. The final real-browser check verified 529 HTML bytes and
SHA-256 `333e153d625536aa00b74bb0d44e21d8cc747cba5899776ec233b2f32cb6c332`,
exactly matching the release. There was no beacon in the raw HTML or live DOM,
no external request attempt, and no browser console error. Both the full
syllabus journey and workbook/PDF/recovery journey then passed on the final
primary release. Keep real-browser verification: curl did not reproduce the
original injection.

The scheduled workflow now runs `scripts/smoke-studio-synthetic.ts`. It checks
the action redirect, primary assets, health, catalog, and a bounded unsaved plan.
It does not create durable workbooks or spend Browser Run time. For a contract
transition, temporarily disable `LEARNING_NEW_PRODUCTION_ENABLED`, restore it
after the matching workflow is merged, then dispatch and verify the production
run. The updated checker passed directly against both production domains after
the final deployment.

Rollback restores the complete prior primary version with
`pnpm exec wrangler rollback 5892fa23-56f5-4e9e-a08e-0c9a925b75af --config apps/studio/wrangler.production.jsonc`.
Disable the new synthetic during rollback and use the preserved legacy checker
until its matching workflow is restored. Leave the additive D1 tables, stored
snapshots, private R2 objects, and action-domain redirect intact.

The released scope is six foundational algebra skills across signed numbers,
expression values, and linear equations. Plans are anonymous and unsaved;
JSON export and print are available. There is no learner account, persistent
history, evidence-based mastery claim, or full secondary-school syllabus.
