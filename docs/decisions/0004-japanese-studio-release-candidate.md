# ADR-0004: Package the Japanese studio as an immutable release candidate

- Status: Accepted; finite runtime and pending hosting decision superseded by ADR-0005
- Date: 2026-09-22

## Context

The owner's subsequent deployment request and syllabus scope are implemented
under [ADR-0005](0005-syllabus-and-generated-workbooks.md). The fixed candidate
contract described here remains the immutable sample/rollback boundary.

The Japanese studio demonstrates a useful workbook journey, but its Vite API
and local PDF subprocess are development tools. A deployable candidate needs a
bounded Worker runtime, exact Web/PDF correspondence, explicit mathematical
relations, and a reproducible record of the content being reviewed.

The current scope is finite: three topics, two levels, and four, six, or eight
questions give eighteen selections from forty-eight original problems. Adding
runtime rendering, learner identity, storage, or a general curriculum engine
would not improve the correctness of this release boundary.

The published fraction-only Content AST, WorksheetInstance, and PrintDocument
contracts cannot represent these integer exercises without a compatibility
change. The English release approval in ADR-0003 and its CC BY 4.0 grant also
do not authorize the Japanese draft material.

## Decision

### A separate, explicitly unsaved contract

The studio uses the `studio-workbook-v1` delivery contract with `saved: false`.
Its semantic hash envelope is `exercisebook.japanese-fixed-workbook/v1`, and
the complete release catalog is `studio-release-v1`. These are deliberately
separate from the published fraction contracts; existing V1 identities and
outputs retain their meaning.

Before presentation, the build materializes and stores all eighteen exact
workbooks, their answer keys, and source hashes. SHA-256 over RFC 8785
canonical JSON binds the workbook fields, explanations, answers, source
hashes, `fixed-prefix-v1` selection policy, and `integer-nfkc-v1` grading
policy. The public workbook ID is `studio-` followed by the complete instance
hash. Changing semantics or grading conditions changes that identity.

The Worker selects a prebuilt workbook; it does not regenerate questions or
run the authoring model. Repeating the same selection within a release
returns the same ID and content. This is the unsaved-preview exception in the
architecture, not a persisted learner assignment. No cookies, account, Web
Storage, learning evidence, or mastery state is created. Answers and results
exist only in the current browser page and the transient grading request.

### Mathematical relations are part of the content

Every explanation step records a relation, a mathematical statement, and its
reason. The supported relations are:

- `expression-equality`: expressions have the same value;
- `equivalent-equation`: a reversible operation preserves the solution set;
- `substitution`: a stated value is substituted for a variable;
- `verification`: a candidate solution is checked in the original equation.

A bare arrow does not stand for any of these relations. Equation explanations
state the operation on both sides and the nonzero condition for division.
Checking a candidate by substitution is identified as verification, rather
than presented as a proof that no other solution exists. The same structured
steps feed the lesson, answer screen, and answer PDF.

### Original source and publication remain distinct

The three original lessons are authored in `content/studio/*.md` using strict
YAML frontmatter and a bounded plain Markdown paragraph. The studio compiler
rejects unknown fields, schemas, paths, topics, licenses, raw HTML, directives,
YAML aliases/tags, and oversized input. It emits the versioned
`exercisebook.studio-lesson/v1` AST with source hash, revision, attribution,
and semantic example inputs. Worked examples and problem answers are derived
and checked from their mathematical models, without live LLM calls.

The candidate reserves `LicenseRef-ExerciseBook-Review-Only` to identify
unpublished original review material. This identifier grants no automatic
public distribution or adaptation rights and is not CC BY approval. The
authoring and compiled content remain `draft`. Deterministic checks establish
specific mathematical properties; they do not claim educator review of the
entire curriculum.

Public activation requires a later exact release record covering content
review, license and attribution, and the authorized hashes. Building, local
Worker verification, and Wrangler dry-run do not activate that release. The
existing application, action redirect, production routes, and DNS are not
changed by this decision. ADR-0003's separate production promotion boundary
remains in effect; its English content approval is not transferable.

### Build-time PDF production and private catalog

The build projects the already materialized workbooks into student and answer
HTML and renders all thirty-six PDFs before runtime. It records each source
instance hash, variant, print HTML hash, PDF byte hash and size, renderer
version, and hashed source inventory. PDF paths are content-addressed by the
actual bytes. The PDF renderer does not select or reinterpret exercises.

Playwright 1.63.0 and its Chromium build are pinned. The renderer loads only
the vendored Noto Sans JP font whose source revision, font SHA-256, OFL-1.1
license, attribution, and license hash are recorded under
`apps/studio/assets/fonts/noto-sans-jp/`. Rendering is offline, resource
bounded, and receives a restricted subprocess environment without service
credentials. Missing or changed font bytes fail rendering; installed system
fonts are not a recovery path. PDF byte identity across operating systems is
not promised; the manifest binds the actual reviewed artifact bytes.

`apps/studio/.release/catalog.json` contains answer keys and stays outside
`.release/public`. The Worker validates the catalog and its hashes, then
serves only allowlisted client assets and explicitly requested workbook/PDF
variants. It never exposes the raw catalog or arbitrary `/artifacts/` paths.
The student response and student PDF omit the answer projection; answers are
returned only for an explicit grading or answer-PDF request.

Static Assets invoke the Worker first and have no SPA or missing-file
fallback. API input, response relationships, PDF/asset integrity, origins,
request size/time, and a mandatory rate-limit binding are validated. Learner
submissions are not persisted or logged. API responses use
`Cache-Control: private, no-store`; operational failures produce sanitized
events through Worker observability.

## Failure and recovery

- Invalid source, compiled-content drift, or a changed build input fails the
  build. Repair the source and produce a new candidate.
- Invalid release or mismatched asset bytes fail closed. A missing PDF does
  not replace the workbook or clear entered answers.
- A failed PDF renderer prevents a new candidate from passing verification;
  it never substitutes different questions.
- Exact candidate bytes are archived under `output/studio-releases/` before
  replacing the active local package. Retain that archive with its release
  ID and verification evidence when evaluating a candidate.
- Unknown or retired workbook IDs are rejected instead of rebound to current
  content. The unsaved candidate does not promise cross-release restoration
  of browser sessions.
- A future hosted promotion must record its Worker version and prior known
  good version. Rollback restores the prior complete package; it does not
  overwrite a PDF at an existing content hash. The action-domain fallback
  remains `https://exercisebook.app/new`.

## Verification and consequences

The release gate includes independent arithmetic/substitution tests, relation
checks, source/compiler consistency, strict client/server boundaries, all
eighteen immutable selections, Worker validation and failure tests, and a
built-Worker browser journey. Every PDF is checked for hash, dimensions,
page count, text order, embedded approved fonts, and student answer leakage.
Representative pages must also be visually reviewed for Japanese text,
negative numbers, long explanations, answer areas, and page breaks.

CI builds and checks the candidate without deployment credentials. Its
success is evidence of the specified engineering checks, not permission to
publish draft curriculum. The limited catalog is intentionally repeatable;
new material, saved assignments, longitudinal evidence, and adaptation remain
separate product work.

## References

- [Core architecture](0001-core-architecture.md)
- [Existing launch release boundary](0003-learning-new-launch-release.md)
- [Studio release runbook](../operations/japanese-studio-release.md)
- [Current learning-content license](../../LICENSE-CONTENT.md)
