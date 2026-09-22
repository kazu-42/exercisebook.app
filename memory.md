# Project decision log

## 2026-09-22 - Cloud Browser variable-font identity differs from macOS

Remote Browser Run successfully loads the exact pinned Noto font but reports
variable instances as `NotoSansJP_400wght` / `NotoSansJP_700wght`, whereas macOS
Chromium reports `NotoSansJP-Thin_Regular` / `NotoSansJP-Thin_Bold`. Keep SHA-256,
custom-font, network, and resource checks; accept only the verified legacy face
prefix or the weight-instance form bounded to 100–900. Do not remove font
validation or increase the production deadline to hide this compatibility
failure. Twelve regression cases cover valid instances and invalid names.
The corrected real adapter rendered an eight-question stored workbook on
remote Browser Run in 7.424 seconds including launch and close. CI separately
prepares Miniflare's browser outside the application request deadline and
retains HTTP status and Worker logs on PDF smoke failures.

## 2026-08-22 - Authorize the minimum learning.new launch release

**Context**: The `.new` policy deadline requires a useful action flow, while
the repository also contains lesson, sample, answer-key, and V2 prototypes that
have not been approved for public release.

**Decision**: Publish only one English unlike-denominator lesson through the
anonymous, unsaved V1 `/new` preview. Software is Apache-2.0; project
documentation and exact content revision 3 are CC BY 4.0. A server-only exact
release manifest pins content/source hashes, policy 4, graph, generator, RNG,
license, attribution, and the owner's 2026-08-22 approval. The primary Worker
fails closed outside `/new`, preview POST, health, and exact hashed assets. A
separate binding-free action Worker drops all query data and redirects
`GET`/`HEAD /` to exactly `https://exercisebook.app/new`.

**Impact**: Author Markdown remains draft and cannot self-publish. Missing or
drifted authority, runtime versions, rate limiting, or assets fail closed.
Preview Workers may be deployed and rollback-tested autonomously, but attaching
`exercisebook.app` or `learning.new` or changing production DNS requires a
separate owner GO. See [ADR-0003](docs/decisions/0003-learning-new-launch-release.md)
and the [launch runbook](docs/operations/learning-new-launch.md).

**Preview evidence**: Both `workers.dev` previews passed remote smoke before
and after a 100% prior-version rollback. One action request sent immediately
after the first deploy transiently returned `500`; direct GET/HEAD and every
subsequent full smoke passed. Treat deploy completion and edge readiness as
separate states and require a bounded propagation wait plus repeated readback.
Production DNS remained non-resolving, and DNSSEC delegation was not yet
present at the 2026-08-22 readback.

**Production synthetic**: The initial production monitor is a dependency-free
Node 24 check scheduled by GitHub Actions every five minutes. Scheduling stays
fail-closed behind the exact repository variable
`LEARNING_NEW_PRODUCTION_ENABLED=true`; manual dispatch is used against preview
before DNS promotion. Each run makes two bounded attempts, opens or updates a
durable owner-mentioned GitHub issue after failure, and closes it after the
next scheduled recovery. Do not enable the variable before both production
custom domains pass external smoke.

## 2026-07-19 - TypeScript 7 baseline

**Decision**: Use the stable `typescript@7.0.2` native toolchain as the
build-authoritative compiler. Pin it exactly, use erasable syntax, and keep
domain/application packages independent of the legacy compiler API.

**Impact**: CI must verify TypeScript major 7. Vite owns Web bundling. Do not
install `@typescript/native-preview` or silently fall back to TypeScript 5/6.
See [ADR-0002](docs/decisions/0002-typescript-7-toolchain.md).

## 2026-07-19 - Product identity

**Context**: The project needs a stable public identity for its purchased
domains.

**Decision**: The product is **Exercise Book**. The canonical application is
`https://exercisebook.app`. The separately purchased `https://learning.new` is
an action entrypoint for starting a new learning plan or exercise book, not a
second application origin.

**Impact**: Product copy, repository metadata, canonical URLs, APIs, identity,
and artifacts use Exercise Book and `exercisebook.app`. `learning.new` remains
stateless, performs no mutation on `GET`, forwards only allowlisted
non-sensitive parameters, and falls back to a static redirect to
`https://exercisebook.app/new`.

## 2026-07-19 - Canonical content model

**Context**: Web, print, dynamic problems, and future external authors need one
coherent content contract.

**Proposal**: Markdown + YAML is the constrained authoring surface. A versioned
Content AST and a fully materialized `WorksheetInstance` AST are canonical.
Web and PDF render the same instance hash.

**Impact**: General MDX, raw HTML, and raw TeX are not canonical content.
Renderers and storage adapters remain outside the domain model. See
[the architecture](docs/architecture.md) and
[ADR-0001](docs/decisions/0001-core-architecture.md).

## 2026-07-19 - PDF backends

**Context**: Cloudflare must support accessible Web output and high-quality
Japanese/mathematical print without coupling the product to one PDF engine.

**Proposal**: Use Browser Run for the hosted MVP, evaluate Typst WASM as
an optimization, and use a restricted LuaLaTeX Container for high-quality
output. Each backend implements the same renderer port.

**Impact**: Do not run TeX inside a normal Worker. Render jobs are idempotent,
at-least-once Queue work; PDFs and manifests are immutable R2 artifacts.
Renderer rollback never changes the assignment instance.

## 2026-07-19 - Initial adaptation policy

**Context**: A sophisticated adaptive model can hide weak content labels and
poor evidence quality during an early launch.

**Proposal**: Begin with a reviewed skill graph and an explainable, deterministic
rule-based planner. Defer BKT, IRT/CAT, DKT, and RL until explicit evidence and
calibration gates exist.

**Impact**: Prove one 30–50-skill vertical slice and measure delayed retention,
transfer, invalid-item rate, and false mastery before model complexity grows.

## 2026-07-19 - D1 and R2 transaction boundary

**Context**: R2 and D1 do not share an atomic transaction.

**Proposal**: Write and hash-verify an immutable instance in R2 before
transactionally committing its assignment pointer in D1. A committed assignment
may never point to a missing object.

**Impact**: Failed commits can leave harmless orphan objects for later garbage
collection. Lost render enqueues and upload/status split-brain are handled by
idempotent reconciliation.

## 2026-07-19 - Validate the day-one loop before persistence

**Context**: The Phase 1 `/new` form collected a goal and time choice but then
discarded both, while the fixed worksheet already proved the lower-level
compiler, generator, Web, and print contracts. Public curriculum publication is
also still blocked by the owner license decision.

**Decision**: Insert an anonymous `DailyPlanPreviewV1` slice before the public
catalog and persistence work. A versioned pure policy maps the one reviewed
fraction goal and an 8/12/20-minute practice cap to at most 4/6/8 problems. The
preview is deterministic, unsaved, evidence-free, and explicit that it is not
adaptive or mastery-based. The sequence seed excludes the budget so shorter
sets are stable prefixes; the request identity includes the budget so each set
has a distinct preview identity.

**Impact**: Planner decisions, provenance, budget enforcement, student-only API
projection, accessible failure states, and same-instance in-page printing are
proved locally before D1/R2/Queues or accounts are justified. The generator
receives plan/policy/graph/reason data rather than inventing it. The 20-minute
option initially plans 16 minutes because the draft content reviews only eight
two-minute problems; unused budget is safer than unreviewed padding. See
[the v1 specification](specs/daily-plan-preview-v1.md).

## 2026-07-19 - Version worked-example collision avoidance as planner policy

**Context**: Independent review found that the application-owned worked example
has canonical result `5/6`, while valid deterministic practice sequences can
also generate `5/6`. A subsequent broad 365-day semantic scan found the second
collision class: the example also structurally exposes `1/2` and `1/3` as its
operands, so a practice answer matching either value is disclosed too.
Field-name leak scans do not detect these semantic answer disclosures.
Injecting unrecorded exclusions in the application service would also make
replay depend on behavior absent from policy provenance.

**Decision**: Retire `day-one-fraction-preview@1` for new previews and enable
`day-one-fraction-preview@2`. Before release and fixed-vector lock, policy v2
was corrected to record exactly `[1/2, 1/3, 5/6]` in each plan activity as
`excludedCanonicalAnswers`. The reviewed example's left/right/result derive
from those same ordered entries. The generator deterministically advances retry
attempts for candidates matching any entry and records the selected attempt in
the canonical instance. The final student projector is an independent
fail-closed boundary: it scans every structured rational and recognized
answer-bearing string in the complete worked example against every generated
canonical answer. It never repairs, redacts, or regenerates at projection time.

**Impact**: Collision avoidance is reproducible, reviewable policy input rather
than a hidden service constant, and policy v1 vectors remain historical instead
of being reinterpreted. The next correctness slice derives lesson and worked
example data from `ContentDocument`. Before production, the browser response
decoder must become bounded and duplicate-key-aware, and anonymous endpoints
need rate limiting plus reviewed security headers. The public deterministic
sequence provides replay, not answer secrecy, and preview attempts cannot be
treated as mastery evidence.

## 2026-07-19 - Make every student delivery boundary field-sensitive

**Context**: A reviewer constructed a hash-correct two-slot instance in which
the first slot's `printFallback` disclosed the second slot's canonical answer.
Canonicalization and a recomputed matching instance hash proved integrity but
could not prove student-field safety. A blanket cross-answer scan of each whole
item was also incorrect: fraction operands can legitimately equal another
slot's reduced answer.

**Decision**: Scan student data by field role at the shared delivery boundary
and again after Web or Print projection. Global fields, prompt instructions,
and every non-prompt field are checked against all canonical answers. Structured
left/right operands may equal another slot's answer, but never their own;
prompt `accessibleText` and its accessibility summary must equal deterministic
derivations from those operands, so appended answer prose cannot inherit the
operand exception. Student PrintDocument helpers consume the answer-free
delivery, and the final validated PrintDocument independently verifies prompt
and fraction-bar operand roles while scanning captions, fallbacks, prose, and
all other fields against every answer. Worked-example structured values and
recognized strings retain their separate all-answer scan.

**Impact**: The repaired regression re-canonicalizes and re-hashes the mutated
two-slot instance: a cross-slot value in a structured prompt operand passes,
while that same value in another item's `printFallback` or appended prompt prose
fails closed. Safe existing canonical worksheet, student/answer-key
PrintDocument, and printable outputs remain unchanged; hash-valid but unsafe
instances are no longer student-presentable. See
[Student Delivery Hardening v1](specs/student-delivery-hardening-v1.md).

## 2026-07-19 - Bound strict browser response decoding

**Context**: `Response.json()` buffers outside an application-owned byte budget
and accepts duplicate object keys with JavaScript last-key-wins semantics. A
byte cap alone also permits unbounded zero-byte reads or excessive per-chunk
bookkeeping, and the fixed sample loader did not cancel on component cleanup.

**Decision**: Both browser worksheet loaders share a streaming response
decoder. Preview and sample routes own 32 KiB and 64 KiB delivered-byte limits;
the decoder additionally allows at most 1,024 non-final reads, counts empty
chunks, requires byte chunks, decodes UTF-8 fatally, and uses the existing
64-depth/512-value duplicate-aware JSON parser. Media type and declared length
are early fail-closed checks; actual delivered bytes remain authoritative.
Every early or streaming failure best-effort cancels the body without replacing
the primary error. Caller abort and 15-second timeout reasons retain exact
identity, and React cleanup actively aborts superseded sample work.

**Impact**: Producer-budget tests keep every reviewed 8/12/20-minute preview
and both fixed sample variants below their route caps before learner delivery.
Expected cleanup does not display an error or permit stale variant overwrite.
The decoder does not use Fetch convenience body decoders. Limit growth is an
explicit contract review rather than an incidental DTO-schema expansion.

## 2026-07-19 - Authorize one detached projection snapshot

**Context**: Integrity checks hash asynchronously. A caller that retained the
materialization object could mutate it while hashing, and several consumers
then re-read that caller-owned object for answer checks, answer-key projection,
or hash comparison. The values being authorized and the values being emitted
could therefore diverge even in single-threaded JavaScript across an `await`.

**Decision**: Student authorization captures every safe materialization field
and validates a detached instance before the first asynchronous yield. Trusted
Web and Print projectors receive the answer-free delivery plus detached
canonical answers through the explicit server-only
`@exercisebook/schemas/trusted-student-projection` subpath. Browser-reachable
modules cannot import that subpath under the repository boundary check.
Consumers never re-read the original materialization after awaiting. Both Web
variants and both PrintDocument variants validate their final DTOs; answer-key
PrintDocument keeps schema-valid source accessibility prose, while the student
variant requires exact operand-derived prose.

**Impact**: Caller-mutation regressions cover the shared projector, daily
service, Web student and answer-key, materialization verifier, and both print
variants. Existing generated worksheet, Web, and print bytes retain their
versioned identities. A source whose projected answer-key prose exceeds the Web
DTO bound now fails closed instead of returning an invalid object; the source
and target text-bound reconciliation remains explicit follow-up work.

## 2026-09-22 - Japanese workbook product prototype

The owner confirmed a middle/high-school audience first, elementary school
later, and daily incremental practice. Condition-matched workbooks, usable
learning material and answers, and high-quality printable PDFs are mandatory.
See `docs/product-direction-2026-09.md`.

`apps/studio` is an isolated, local-only prototype based on production main
`3de333b41c739bab52738e9bc06ff6ba9426916f`. It is not part of the deployed
Worker surface and does not widen the fraction-only production contracts.
It provides three original Japanese draft themes, two difficulty levels, and
4/6/8-question selections; forty-eight arithmetic-checked problems form eighteen
fixed workbooks. Creation, numeric grading, step-by-step feedback, and real A4
problem/answer PDF downloads work. There is no account, persistence, learning
history, or adaptive/mastery claim. Content still needs educational review.

The browser receives no practice answer model before an explicit grading or
answer request. Set identities bind fixed content; PDFs render that same set.
The local renderer uses offline Playwright 1.63.0 through uv with bounded
process input/output, time, and concurrency. Local Japanese fonts are embedded,
but cross-host layout identity is not yet a production guarantee.

Verification: `pnpm check` passed (38 test files / 577 tests), including existing
release-bundle isolation and sample replay. The real browser journey passed at
1440, 390, and 320 pixels, including keyboard operation, numeric input,
grading, explanations, two PDF downloads, page-local resume, empty cookies/
storage, and no third-party requests or JavaScript errors. Automated axe checks
reported no creation-page violations after contrast improvements. Six 8-item
PDFs across all three themes and both variants were verified as two A4 pages,
with matching prompt order, embedded Japanese fonts, complete explanations,
and inspected page images. A delayed PDF failure cannot corrupt a newly
created workbook's UI state; this has a regression test and independent review.

Run `pnpm studio:dev`, or `pnpm studio:build && pnpm studio:preview`, at
http://127.0.0.1:4178. See `apps/studio/README.md` for explicit browser setup,
verification, limits, and the next production-contract decisions. Do not expose
this Vite prototype server publicly.

## 2026-09-22 - Japanese studio release candidate and mathematical precision

The owner accepted the UI and requested deployment quality with precise logical
relations in worked solutions. Do not join transformations with an unqualified
arrow or call the example generic "thinking hints". Explanation steps now
distinguish equal-valued expressions, equivalent equations over the real
numbers, substitution under an explicit value, and verification of a candidate.
Equation operations state their reversible operation and nonzero divisor.
Independent tests parse displayed arithmetic/equations; they do not merely call
the same answer function used by the application.

The local-only prototype above is now accompanied by a separate deployable
Cloudflare Worker candidate. ADR-0004 records its scope: 18 fixed unsaved
workbooks and 36 prebuilt PDFs. It does not claim durable assignments, learner
history, adaptive mastery, or compatibility with the fraction-specific V1 AST.
The source is constrained Markdown/YAML, compiled to a versioned lesson AST;
original Japanese material retains an explicit review-only license pending a
public-content decision. The existing English release approval does not apply.

The candidate stores full frozen content privately in .release/catalog.json and
only hashed HTML/JS/CSS/PDF artifacts in .release/public. Worker routes and
release hashes are validated; raw catalog/source/artifact routes are closed.
An explicit answer action delivers a public-study answer variant. No identity,
answers, cookies, or learning evidence are stored. PDF problems and explanations
share the same exact instance and typed print projection. Original source,
grading implementation, policy, content, and explanations participate in
identity. A stale tab cannot be rebound to newly interpreted questions.

Rendering is a build-time adapter, with pinned Playwright 1.63.0 and a bundled
OFL Noto Sans JP revision, hash, license, and provenance. It rejects missing or
changed fonts, network access, OS-font fallback, and overflowing pages. All 36
PDFs must pass semantic text/order, page count, embedded-font, variant, and
byte-integrity verification before the active local release is replaced. A
source/artifact checker runs before Wrangler to reject mixing a stale release
with newly edited code. Exact candidate bytes are archived under output.

The production English Worker and learning.new routing are unchanged. Use
studio:release, studio:deploy:check (dry run), and studio:worker (127.0.0.1:4180).
The new CI job builds and verifies this same path on Linux. Public activation
still requires the precise Japanese content/license release decision described
in the runbook; automated arithmetic checks are not a claim of human
educational review.

The readiness audit also found four pre-existing dependency advisories.
Hono is now pinned to 4.13.5; a narrowly scoped miniflare>sharp 0.35.4 override
removes the vulnerable image dependency while retaining the Cloudflare and
TypeScript 7 toolchain. Remove that override when every Miniflare dependency
path supplies a fixed sharp version. The refreshed audit reports no
vulnerabilities, and the existing English Worker build and tests still pass.

Verified candidate: studio-rc-64992f16e599460012f09af8aa15690a0e0175769dcb8aa1866525c3bf12bab4.
The repository aggregate passed 43 files / 671 tests, typecheck, format, content
and schema checks, builds, import boundaries, and the reviewed sample gate.
After the final print-layout changes, the 20 relevant renderer/materialization
tests and final type/format checks passed. All 36 final PDFs / 60 pages passed
the release verifier; 12 representative pages and desktop/mobile screenshots
were inspected. Final Wrangler dry-run and the local Worker journey at port
4180 passed for this same release, including PDF/grade/create 503 recovery,
1440/390/320 widths, keyboard input, two actual PDF downloads, no browser
exceptions or third-party requests, empty cookies/browser storage, and zero
creation-page axe violations. CI is configured but was not run remotely.

The first actual Worker boot exposed an unsupported compatibility date that
dry-run did not detect. The candidate now uses the established 2026-07-14 date.
The release-source check demonstrably rejected the stale prior package after
that config edit. Rebuilding and re-running the real Worker resolved it.
# 2026-09-22: Hosted syllabus and dynamic workbooks

The owner explicitly authorized deployment, superseding the Japanese draft's
pending hosting decision. Initial fixed preview is live at
https://exercisebook-studio-preview.ghive42.workers.dev with Cloudflare version
c766a968-110d-4417-a822-9cf8a5be1c67 and release studio-rc-64992f16e599460012f09af8aa15690a0e0175769dcb8aa1866525c3bf12bab4.
Hosted browser creation/grading/PDF and 320/390 px recovery checks passed.

ADR-0005 adds an unsaved, deterministic syllabus (three goals, six skills,
81 bounded conditions) and seeded workbook creation. The exact question/key
snapshot commits to D1 before presentation, with hashed idempotency keys.
Learner answers, scores, identities, and syllabus data are not persisted.
Generated PDF creation is POST-only; a bounded Browser Run adapter projects the
same snapshot, uses the verified Noto font, and writes immutable R2 bytes.
D1 claim tokens and exact lease expiry fence stale workers. Dynamic failures
never fall back to the eighteen static sample books.

Resources created: exercisebook-studio D1 (4c33da0e-e0cf-4439-96f1-e0041203737c),
private exercisebook-studio-artifacts R2, migration0001 applied remote/local,
pinned font uploaded remote/local. Three standard-level Markdown lessons
prevent multiplication/negative substitution practice from showing an unrelated
foundation example. Original fixture vectors remain unchanged.

The shared JSON reader keeps its existing 512-value default; only syllabus
responses opt into4096, still bounded to64KiB. Actual largest plan is about34KiB.
The generator source revision must accept the real git40hex+source64hex format.
Reject bad method/origin/query/body and rate-limit before looking up a generated
ID in D1. These two integration bugs have regression tests.

Current entrypoint for deployment procedure:
docs/operations/studio-syllabus-release.md. Final hosted dynamic release evidence
must be recorded after executing the complete release journey.
