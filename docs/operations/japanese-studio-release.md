# Japanese studio release candidate runbook

For the owner-authorized hosted evaluation and dynamic syllabus release, use
[the current hosted release runbook](studio-syllabus-release.md). This document
describes the original fixed sample build; its pending activation text records
the earlier candidate decision, superseded by ADR-0005.

This runbook builds and verifies a deployable candidate for the Japanese
workbook studio. It performs no hosted deployment, production route change,
or DNS change. The active English application and `learning.new` redirect
remain separate. The boundary is recorded in
[ADR-0004](../decisions/0004-japanese-studio-release-candidate.md).

The finite catalog contains three topics, two levels, and four/six/eight
questions: eighteen workbooks and thirty-six PDF variants. Workbook delivery
uses `studio-workbook-v1` with `saved: false`. No learner identity, answers,
history, or mastery evidence is stored.
The Worker uses the existing application's compatibility date, 2026-07-14,
which is supported by the pinned local workerd. Do not replace it with today's
date without checking that runtime; a Wrangler dry-run does not boot workerd.

## Prepare and build

Run from the repository root with Node and pnpm versions matching
`package.json`:

```sh
pnpm install --frozen-lockfile
uv run --no-project --with playwright==1.63.0 playwright install chromium
pnpm studio:content:check
pnpm studio:test
pnpm typecheck
pnpm studio:release
pnpm studio:deploy:check
```

On a Linux CI runner, install the browser with its system dependencies:

```sh
uv run --no-project --with playwright==1.63.0 playwright install --with-deps chromium
```

`studio:release` checks compiled content, builds the client, materializes the
eighteen fixed selections, renders both variants, and runs
`apps/studio/scripts/verify-release.py` through uv. It rejects source changes
during rendering. The PDF subprocess runs offline with a restricted
environment; no Cloudflare credential is required for this build.
Catalog and PDF verification run against staging before the active local
package is replaced. A failed render or verification preserves the preceding
candidate. The archived package is the source for local recovery.

`studio:deploy:check` invokes `wrangler deploy --dry-run`. It verifies Worker
packaging and bindings without uploading or activating a Worker. A successful
dry-run alone does not establish runtime or content readiness.
Both this command and studio:worker first run studio:release:check, comparing
the recorded source inventory and every artifact against current files.
Changing the grader, client, font, or build inputs requires a fresh release.

Generated artifacts:

| Path | Purpose |
| --- | --- |
| `apps/studio/.release/catalog.json` | Private Worker catalog, answer keys, and release identity; never a public asset |
| `apps/studio/.release/public/` | Exact client assets and content-addressed PDFs, accessible only through Worker routing |
| `apps/studio/.release/build-record.json` | Source inventory, source revision/digest, renderer identity, and 36 PDF hashes |
| `output/studio-releases/<releaseId>/` | Archived exact candidate package |
| `output/studio-release/verification.json` | Per-PDF inspection results |
| `output/studio-release/*.png` | Twelve representative page images: all topics, standard level, eight questions, both variants and pages |

The release ID is `studio-rc-` plus SHA-256 of its canonical catalog payload.
Each workbook has a separate semantic hash. The manifest records actual PDF
bytes; rebuilding on a different host need not produce the same PDF bytes.
Record the source revision/digest and release ID together when reviewing.

## Exercise the built Worker

Start the Worker locally:

```sh
pnpm studio:worker
```

In another terminal:

```sh
uv run --no-project --with playwright==1.63.0 python apps/studio/scripts/smoke.py \
  --base-url http://127.0.0.1:4180 \
  --output output/studio-worker
```

This exercises the prebuilt catalog and PDFs on the Worker runtime. The current
`studio:dev` and `studio:preview` commands also use this Worker; the old Vite
middleware is no longer a supported verification
target. The smoke covers keyboard creation, answer input and feedback, actual
PDF downloads, navigation, mobile widths, and the absence of cookies,
browser storage, third-party requests, and browser exceptions.

Inspect the browser screenshots in `output/studio-worker/` and the twelve PDF
page images in `output/studio-release/`. Check Japanese glyphs, negative signs,
the stated relation for each transformation, explanation legibility, writing
space, and page breaks. Automated extraction checks cannot establish visual
quality or the educational clarity of every explanation.

The dedicated CI job repeats the content check, release build and PDF
verification, Wrangler dry-run, and built-Worker smoke. It uploads the PDF
verification report, twelve page images, browser evidence, thirty-six PDF
files, and build record. CI has read-only repository permissions and performs
no deployment.

## Candidate acceptance and public activation

An engineering candidate is ready for review when the repository checks,
studio tests, release verifier, dry-run, and local Worker journey pass for the
same source and release, and the screenshots have been inspected. Preserve
the reports with that identity. This runbook is not a completed evidence
record: actual results must be recorded after executing the checks.

The Japanese source is original draft material under the reserved identifier
`LicenseRef-ExerciseBook-Review-Only`. This grants no public distribution
rights. The existing English lesson's CC BY 4.0 approval does not cover it,
and mathematical tests do not constitute a claim of educator approval.

Before a hosted public release, prepare the exact reviewed content/license
record and authorized source hashes, the target Worker/version and rollback
identity, hosted smoke evidence, and the corresponding monitoring update.
Public activation remains pending that release decision. Do not use Vite as
the hosted server or point the existing production domains at this candidate
as a side effect of verification.

The future public monitoring contract must reflect the Japanese create,
grade, and PDF flow before promotion. The current production synthetic checks
the English `learning-new-v1` contract and is intentionally unchanged here.

## Failures and rollback

Source, license, hash, or catalog validation failure stops the release. Repair
the cause and rebuild; do not disable a gate or silently choose other
questions. Missing or invalid PDF assets fail the download while the current
Web workbook and entered answers remain usable. Worker errors use sanitized
event records; never add learner answers, request bodies, URLs, or IP addresses
to diagnostic logs.

For a local candidate, rebuild the intended source or restore its complete
archived package. Do not mix a catalog from one release with assets from
another. For any later hosted promotion, record and rehearse rollback of the
entire Worker version before attaching traffic. A rollback must not change
content at an existing artifact hash or reinterpret an old workbook ID.
