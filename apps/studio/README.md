# Japanese workbook studio

A Japanese workbook release candidate for middle-school mathematics and
foundation review by older learners. Select a topic, level, and bounded
question count; solve the fixed set, check answers and explanations, or
download matching A4 problem and answer PDFs.

This app is separate from the deployed `@exercisebook/web` application. The
candidate can be built and exercised on a local Cloudflare Worker; no hosted
deployment, production route, or DNS change is part of that verification.
Content publication remains pending. There are no accounts, saved learner
assignments, learning history, or mastery claims.

## Build and verify the Worker candidate

From the repository root:

```sh
pnpm install --frozen-lockfile
uv run --no-project --with playwright==1.63.0 playwright install chromium
pnpm studio:content:check
pnpm studio:test
pnpm studio:release
pnpm studio:deploy:check
pnpm studio:worker
```

Open <http://127.0.0.1:4180>. `studio:release` builds the client, freezes eighteen
workbooks, renders thirty-six PDFs, and verifies the resulting files.
`studio:deploy:check` is a Wrangler dry-run and does not deploy.

With the Worker running, exercise its real API and PDF assets:

```sh
uv run --no-project --with playwright==1.63.0 python apps/studio/scripts/smoke.py \
  --base-url http://127.0.0.1:4180 \
  --output output/studio-worker
```

For complete commands, artifact locations, review requirements, and failure
handling, see the [release runbook](../../docs/operations/japanese-studio-release.md).
Run the repository's `pnpm check` before accepting a candidate. Visual review
of the generated pages is required in addition to automated checks.

## Edit locally

Prepare the local D1 migration and private R2 font object using the
[generated-workbook runbook](../../docs/operations/studio-syllabus-release.md#prepare-storage).
Then rebuild the checked release and start its actual Worker:

```sh
pnpm studio:release
pnpm studio:dev
```

`studio:dev` and `studio:preview` both run `studio:worker` at
<http://127.0.0.1:4180>. They verify the release before starting and use its
real syllabus, D1 snapshot, and Browser Run PDF APIs. They do not start a
separate Vite API or substitute in-memory storage. Stop the running Worker,
run `pnpm studio:release` after edits, and restart it. Running
`studio:build` alone does not update the checked Worker release.

The earlier Vite-only sample API remains covered by its historical unit tests;
it is not attached to the current application. See the
[generated-workbook runbook](../../docs/operations/studio-syllabus-release.md)
for the current hosted architecture, storage setup, PDF verification, and
deployment procedure. The fixed-sample sections below describe the retained
reference artifacts, not the complete current Worker behavior.

## Content and learning scope

- Three original draft topics: signed numbers, expression evaluation, and
  linear equations.
- Foundation/standard levels, with four, six, or eight questions.
- Forty-eight problems and eighteen fixed selections. The same conditions
  within a release give the same problems.
- Integer answers, including full-width digits, mathematical minus signs, and
  optional `x=` for equations. No symbolic-equivalence grading.
- Explicit explanation relations: equal expressions, equivalent equations,
  substitution, and verification in the original equation. Each step includes
  its mathematical statement and reason.
- Student-only initial data; answers arrive after an explicit grading,
  explanation, or answer-PDF request.
- State stays in the current page. Internal navigation preserves the current
  set; reloading or closing the page discards inputs and results.

The source lessons live in `content/studio/*.md`; a strict Markdown/YAML
compiler produces the versioned lesson AST with attribution, source hashes,
and semantic example inputs. The reserved content license identifier
`LicenseRef-ExerciseBook-Review-Only` does not grant public distribution rights.
The existing English lesson's CC BY grant does not cover these drafts.
Mathematical verification is not a claim of educator-approved curriculum.
These topics cover a small foundation range, not a full middle/high-school
course.

## Release boundaries

The delivery schema is `studio-workbook-v1`, always with `saved: false`.
The semantic envelope `exercisebook.japanese-fixed-workbook/v1` binds the
exact workbook, answer key, explanations, source hashes, and versioned
selection/grading rules with SHA-256 over RFC 8785 canonical JSON. It does not
extend or claim compatibility with the published fraction-only
WorksheetInstance, Content AST, PrintDocument, or evidence contracts.

The build writes a private `.release/catalog.json` and a separate
`.release/public` asset directory. Only the Worker can select the released
content and authorized PDF variant. Exact assets and PDFs are hash checked;
there is no SPA fallback or public raw-catalog route. The Worker performs no
PDF rendering and retains no submissions. API requests are bounded and rate
limited, responses containing submissions are not cached, and unexpected
infrastructure failures are reported without private request details.

The build renderer uses pinned Playwright 1.63.0 Chromium and the vendored
OFL-1.1 Noto Sans JP font, whose bytes and license are hash checked. It runs
offline with restricted environment, input/output limits, and a deadline.
Missing fonts or PDF failures fail explicitly; a failed download never
replaces the loaded workbook or clears answers. There are no third-party
fonts, analytics, or requests in the learning flow.

[ADR-0004](../../docs/decisions/0004-japanese-studio-release-candidate.md) records
the implementation decision and separate public activation boundary. Saved
assignments, cross-device history, attributable evidence, adaptive review,
and a broader reviewed curriculum remain later work.
