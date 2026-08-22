# Project decision log

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
