# Project decision log

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

## 2026-07-19 - Version instance-bound presentation beside V1

**Context**: V1 commits generated practice and content references but not the
exact lesson explanation or worked example shown by Web and print.

**Decision**: Add a parallel V2 content/instance/delivery/Web/Print lane. Policy
v3 pins the exact content identity, selected node IDs, and ordered
`[left, right, result]` tuple; `WorksheetInstanceV2` embeds the renderer-neutral
selected presentation before hashing. Preserve the complete V1 execution path
for history and rollback.

**Impact**: Lesson, worksheet, and print can prove semantic parity without
renderer-time content lookup. Disable policy v3 to roll new work back to V1;
never reinterpret or overwrite historical V1/V2 artifacts. See
[ADR-0003](docs/decisions/0003-instance-bound-presentation.md).

## 2026-07-19 18:40 - Backend - V2 boundary validation

**Context**: Independent review of the content-derived presentation foundation
found several cases where structurally invalid authoring or registry data could
bypass the intended canonical boundary or escape as a raw arithmetic error.

**Decision**: New V2 rational boundaries apply a bounded lexical strict-object
gate before the shared semantic `RationalJsonSchema`. Compiler-v2 presentation
normalization uses `Unicode White_Space` plus U+FEFF, rejects GFM delimiter rows
including one-column forms, and validates exact balanced `:::` container closing
fences from raw normalized source before Markdown parser recovery.

**Impact**: Do not directly apply the historical rational refinement to hostile
V2 strings, and do not rely on a permissive Markdown parser to define canonical
source syntax. The current source/content hashes remain unchanged. P17-003 is
complete only at the planner-policy layer; response-v2 and strict HTTP dispatch
remain separate wire-integration evidence.

## 2026-07-20 - Authorize detached V2 student delivery

**Context**: `WorksheetInstanceV2` adds a complete learner-facing presentation,
so answer disclosure can occur in explanation, example, attribution, or
practice roles even when the instance hash is valid. A coordinated mutation
could also make a canonical answer, scoring rule, and final solution agree with
each other while disagreeing with the prompt arithmetic. Trusted APIs exposed
from mixed schema source modules could be imported directly or re-exported
through a browser dependency barrel.

**Decision**: Project `StudentWorksheetDeliveryV2` from one safe-data-checked,
detached pre-await snapshot and compare its canonical bytes and SHA-256 before
authorization. Accept a canonical practice answer only when bounded exact
cross-multiplication proves it equals the prompt sum. Scan global,
presentation, and practice roles separately, reconstruct all three displayed
worked-example intermediate rationals, and keep canonical answers only on the
server-only trusted subpath. Use the pinned Vite/Oxc AST parser for import
policy: browser/renderer code and protected workspace barrels cannot reach the
trusted subpath or mixed implementation modules, computed module loads fail
closed, and Worker code remains the explicit server exception.

**Impact**: V2 student delivery can be reused by Web and print projectors
without exposing seeds, answers, scoring, solution traces, or misconceptions.
Hash-correct but semantically wrong or answer-bearing instances fail before
student delivery. V1 canonical bytes and Web/print artifacts remain unchanged;
final Web and PrintDocumentV2 scans remain downstream P17-006/P17-007 work.

## 2026-07-21 - Close compiler partition and client build-graph gaps

**Context**: Successive exact reviews found two different classes of guard
failure. Raw closing-fence validation could interpret valid YAML block-scalar
data as Markdown. Separately, future browser changes could make trusted or
Worker source reachable through module re-exports, Vite loaders and plugins,
package entry metadata, package-manager resolution, HTML asset attributes, or
CSS imports even though the current production graph was clean. Real Vite 8.1.5
builds proved the material resolver and asset paths before each class was
closed.

**Decision**: Partition one exact initial YAML frontmatter block before every
Markdown fence scan while hashing the complete normalized source. Parse
JavaScript and TypeScript with the pinned Vite/Oxc AST, reject computed loads
and every production Vite glob, and confine browser module/asset edges to
reviewed roots. Reject backslash-bearing load specifiers and unreviewed
production dependencies. Treat root and browser manifests, execution scripts,
the complete lockfile, pnpm workspace resolution, Vite and Wrangler
configuration, nested package scopes, the absence of a Vite public directory,
the HTML entry/asset surface, and the browser CSS asset surface as
exact-current review gates. CI runs a built-in-only digest check before package
installation, and the policy checks the lock before dynamically importing the
pinned Vite/Oxc parser. Production code cannot enter test/spec modules; the
trusted projector, Worker, and print roots retain only their documented
server-side exceptions.

**Impact**: Valid author metadata remains YAML data, and a routine config,
manifest, HTML, CSS, or loader change cannot silently make canonical-answer
context client-reachable. The real-repository check also requires the lockfile,
workspace, root and reviewed browser package manifests, HTML entrypoint,
Wrangler entrypoint, and exactly one reviewed Vite config; only isolated tests
opt into partial-repository mode. Legitimate upgrades or new
asset/plugin/package surfaces must update the policy and regression fixtures in
the same review. The built-in-only pre-install gate pins all current workspace
manifests as well as the root manifest, workspace configuration, and lockfile;
it runs before the first pnpm setup/cache/CLI operation and rejects
unknown/missing workspace manifests, repository-local `.npmrc`/`.pnpmfile.*`
inputs, and direct `*.gyp` entries before installation. The browser build
boundary also rejects every implicit PostCSS configuration location searched by
the pinned Vite stack, scans every browser-safe package root, and fails closed
on unreviewed Vite style languages, CSS Modules, and ICSS dependency forms.
Executable source roots also reject extensionless regular files and unreviewed
extensions that Vite could parse as JavaScript, while the pinned static-asset,
JSON, and inspected style surfaces remain explicit exceptions. The boundary
suite passes 58/58 plus the live scan; TypeScript 7.0.2, all 945 Vitest tests,
production builds, and unchanged V1/V2 content and V1 output identities provide
the branch evidence.

The compiler's raw Markdown classifier now rejects every directive-shaped line
whose fence is altered by punctuation, noncanonical indentation, Unicode
whitespace, control, format, or default-ignorable characters while leaving YAML
block-scalar data untouched. The shared student-delivery string scan computes a
deduplicated closure over NFKC, form-space, common outer URI-wrapper,
percent-collapse, and URI-decode states. Provably canonical common outer
wrappers compress at the same round while preserving relative percent depth;
the current value and its independently percent-collapsed derivative then
remain separate decode candidates. This prevents collapse-first decoding from
destroying an answer-bearing intermediate such as the `39/35` exposed from
`%2539%2F35`. Composed URI-to-NFKC-to-URI forms receive at most three decode
rounds and a 24-state cap, with either limit failing closed. The scan detects
mixed ASCII and fullwidth forms such as `%25%32%46` and continues after
valid-byte fallback when malformed percent text or truncated UTF-8 exposes
another encoded layer. Compiler tests pass 222/222 and schema tests pass
278/278 without changing either reviewed content hash.

The dedicated V2 materializer now consumes one complete detached
`DailyPlanPreviewV2`, reruns the pinned planner with the final V2 registry, and
canonical-compares the entire plan before content hashing or generation. This
binds the ID, seed, budget, item count, reasons, selected nodes, exclusion tuple,
content, policy, graph, and evidence values to a real planner output rather
than accepting independently assembled claims. Its fixed 12-minute instance
hash is
`934bd3949b6284bbb4061a29b3075560f9389b096ec4f913ad56788e06ac0d02`;
generic standalone instance validation remains version-shaped rather than
policy-specific. Generator-package entry locking and narrower trusted Worker
graph allowlists remain explicit defense-in-depth follow-up rather than a
claimed browser-boundary prerequisite.

## 2026-08-02 - Verify V2 service authority and emitted browser artifacts

**Context**: The strict V2 worksheet API was source-clean under the existing
import policy, yet a real Vite client build could still traverse broad workspace
barrels before tree-shaking removed some server-only answer authority. Source
reachability alone therefore could not establish what modules contributed to
the final client, and searching one JavaScript filename could miss protected
tokens in other emitted artifacts. Separately, schema-valid injected planner,
materializer, or projector results could disagree with the trusted computation
unless the application service reauthorized their complete semantics.

**Decision**: Keep production browser imports on exact reviewed public leaves
and validate their exact transitive graph. During the build, inspect final
Rollup `OutputChunk.modules` provenance and reject server, Worker, generator,
or unreviewed workspace contributors. After the build, scan every regular
artifact for protected answer, seed, scoring, and solution-trace canary tokens
under symlink-safe traversal bounded to 1,000 total entries, 20 MiB of
regular-file content, and depth 16. Treat that canary as defense in depth, not
proof of semantic absence. Tree-shaking is an optimization and never an
authorization boundary. The V2 service detaches and exact-replays injected
planner, materializer, and projector outputs against independent trusted
implementations. Only trusted planner unavailability and an explicit reviewed
presentation/materialization availability-code allowlist map to generic
unavailability. An injected unavailable outcome must match the trusted replay's
exact internal reason; defect-oriented and future codes remain exceptions.
Unexpected route failures produce only a fixed structured 500 classification
and a sanitized response.

**Evidence**: On `feat/v2-worksheet-api`, stacked on
`feat/content-derived-presentation` at `fe389bcb` (parent draft PR #4),
TypeScript 7.0.2 and 1,135 Vitest tests across 42 files pass, together with
61/61 source/config boundary tests, 37/37 final module-provenance tests, and
21/21 artifact-scanner tests. Reviewed content hashes and V1
WorksheetInstance/PrintDocument/HTML identities remain exact, and the V1
attribution schema retains one runtime object identity across its root,
safe-leaf, presentation, and worksheet exports. The 365-day maximum V2 response
is 5,964/32,768 bytes with 26,804 bytes headroom; the client build records 112
modules and the raw scanner covers 328,591 bytes. The Cloudflare development
stack is patched and pinned to `@cloudflare/vite-plugin@1.49.0`,
`@cloudflare/vitest-pool-workers@0.19.1`, `wrangler@4.116.0`, and resolved
`miniflare@4.20260730.0` / `sharp@0.35.2`; the 2026-08-02 `pnpm audit` run
reported no known vulnerabilities. Later advisory data may change that result.

**Impact**: This is a bounded backend checkpoint only. The active React UI
still uses V1, and standalone lesson delivery, React V2 integration,
`PrintDocumentV2`, printable V2 HTML, and browser/visual/accessibility/A4 gates
remain open. No merge or deployment is implied. The next non-UI slice is the
`PrintDocumentV2` semantic core, followed by integrated evidence and the final
Phase 1.7 review.

## 2026-08-02 - Freeze the PrintDocumentV2 semantic boundary before layout

**Context**: The V2 worksheet instance commits the selected lesson, worked
example, practice, provenance, and attribution, but print still needed a
versioned semantic document before HTML or PDF layout could safely evolve. The
preserved V1 pipeline is byte-addressed and cannot be widened, while the current
Web pages and future A4 presentation have not been accepted as a product or
layout direction.

**Decision**: Add a parallel `exercisebook.print/v2` contract with source schema
`exercisebook.worksheet-instance/v2` and projector `print-projector.v2`.
Separate student and answer-key projectors reject unsafe input graphs before
property access, detach one materialization before the first asynchronous hash,
and require exact canonical bytes and SHA-256. Student and shared key blocks are
reconstructed solely from `StudentWorksheetDeliveryV2`; the ordered key
appendix alone reads the same verified full-instance snapshot. The package root
selectively exports the reviewed V2 contract, validator, canonicalizer,
projectors, and worksheet verifier while keeping direct document
materialization, block internals/resource limits, and final trusted-answer
authorization private. Structural validation proves shape and internal
consistency, not source authority or student authorization; those properties
belong to the verified projector and, for external requests, trusted
application-service replay.

Production print source may import only exact `@exercisebook/domain`,
`@exercisebook/schemas`, and
`@exercisebook/schemas/trusted-student-projection` roots plus relative package
modules. Planner, generator, compiler, unreviewed subpath, and test-only imports
fail the boundary, so print cannot replan, regenerate, or resolve current
content. The shared student-visible scan reduces recognized fraction-like text
to bounded rational signatures after its normalization closure, including
slash/Unicode slash, spaced `over`, bounded TeX `\frac`, and bounded
numerator/denominator object-like forms. Decimal, percentage, and arbitrary
natural-language equivalents remain explicit residual risks; bounds fail closed
instead of accepting a partial scan.

The same bounded closure now applies one scanner-only NFKC/sign/separator/
default-ignorable transform to every raw and URI-decoded state. It maps the
reviewed Unicode minus, unary-plus, division, and solidus sets to ASCII, removes
default-ignorable separators, recognizes `over`, `divided by`, and `division
by`, and rejects all bidi controls because logical deletion cannot reproduce
visual order. The explicit sets are reviewable and intentionally exclude
unrelated letters and punctuation, ratio/colon notation, unreviewed or ambiguous
decorated operators, and arbitrary cross-script word skeletons. It does not
rewrite delivered text
or add a new normalization branch. Current V2 print is English-only; future RTL
support needs a structured-bidi contract.

**Evidence**: On `feat/v2-print-document`, stacked on
`feat/v2-worksheet-api` at
`ef05d7f340b14b5ade9fd55e8758e9fc5ca9d530` (parent draft PR #5), TypeScript
7.0.2 and 1,282 Vitest tests across 48 files pass. Focused evidence is 142/142
print-package tests across 10 files, 330/330 schema tests across 5 files, 50/50
equivalent-fraction guard tests, 62/62 source/config boundary tests plus the
live scan, 37/37 final module-provenance tests, and 21/21 artifact-scanner
tests. The fixed V2 worksheet instance hash is
`934bd3949b6284bbb4061a29b3075560f9389b096ec4f913ad56788e06ac0d02`.
The student PrintDocument hash is
`51892552e00caac748d0ceb2532ed7eb1d7a1e094eef887cb0cc941fd8f80111`
at 12,077 canonical bytes with 3,987,923 bytes below the 4,000,000-byte cap;
the answer-key hash is
`d5a5b226bb485ed8e3cb8a43ef05695015e2a00bb97fe6a85530c654b7db0ebd`
at 16,012 bytes with 3,983,988 bytes below the cap. The production client still
records 112 modules, and the raw artifact scanner covers 328,591 bytes. A real
V1 pipeline test freezes the worksheet instance, both PrintDocuments, and both
HTML identities. No child PR, merge, deployment, DNS, persistence, or license
mutation is claimed by this checkpoint.

**Impact**: This completes only the renderer-neutral PrintDocumentV2 semantic
core. The semantic `paper: "a4"` discriminator participates in document
identity but proves no page count, clipping, page break, text extraction,
accessibility, or rendered layout. Printable V2 HTML, content-addressed HTML
artifacts and manifests, a complete V2 print-semantic snapshot, standalone
lesson/Web/print parity, React integration, browser/A4 acceptance, and final
Phase 1.7 review remain open. The next safe non-UI slice is the V2 printable
renderer and artifact boundary. The following prepared-guard checkpoint removes
the repeated answer-signature preparation blocker without weakening trusted
replay or widening browser authority. Public synchronous rendering still
requires request-wide resource evidence and the separately discovered
materialization-envelope contract decision.

## 2026-08-02 - Prepare canonical answers once per authorization phase

**Context**: Role-sensitive V1/V2 delivery, Web, and Print authorization called
the legacy canonical-answer assertion repeatedly. Each call rebuilt every
answer's rational signature, so otherwise bounded 100–200-problem projections
performed quadratic BigInt work. The guard needed reuse without exposing
canonical answers to browser code or changing the established one-shot API.

**Decision**: Add an opaque, trusted-server prepared answer guard exported only
from `@exercisebook/schemas/trusted-student-projection`. Preparation validates
and detaches canonical answers once and constructs complete and per-slot
signature sets in O(N). The existing root one-shot assertion retains its
behavior and validation order for compatibility. Each prepared assertion has
one combined 4,096-candidate cap across structured and recognized-text
rationals, while all assertions in one phase share an 8,192-candidate cap.
End-to-end production Web or Print projection entrypoints execute two fixed
authorization phases; the replay-authorized V2 service executes three. These
phase-local caps fail closed but do not claim a request-wide deadline, memory
limit, or whole-CPU bound.

**Evidence**: The schema-valid, unique-answer boundary fixture consumes 6
candidates in delivery and `12 + 10N` in the final Print phase, or `18 + 10N`
across both direct V2 phases. At N=200 the heavier phase consumes 2,012/8,192
and the two-phase total is 2,018. Prepared trusted/full V2 p50 is 7.13/30.08 ms
at N=100 and 13.48/56.63 ms at N=200. These are local Apple M5 Pro / Node 26.5.0
reference measurements after 3 warmups and across 15 measured runs, not a CI
latency or SLO gate; deterministic counters and tests are the regression
evidence. Instrumented answer-guard BigInt conversions across trusted delivery
and final Print authorization are `24N + 36`: 4,836 at N=200 versus the former
guard-only 487,636 baseline, about 100.8x fewer. Other validation and
canonicalization BigInt work is outside that structural count. The aggregate
`pnpm check` is green with TypeScript 7.0.2 and 1,315/1,315 Vitest tests across
48 files. Focused totals are 143/143 print-package tests across 10 files,
358/358 schema tests across 5 files (including 162/162 schema-contract tests),
75/75 equivalent/prepared-guard tests, 67/67 source/config boundary tests plus
the live scan, 37/37 final module-provenance tests, and 24/24 artifact-scanner
tests. The production build records 112 client modules, the all-regular-file
scanner covers 328,591 bytes, and existing samples verify without identity
changes. This local checkpoint is on
`feat/prepared-answer-guard`, stacked on `feat/v2-print-document` at
`129f35edcc7118a84f383dc16d1b8a575892e3dc` (parent draft PR #6); no child PR,
merge, or deployment is claimed here.

The frozen V1 instance, student/key PrintDocument, and student/key HTML hashes
remain respectively
`5252ef64b127638b785a94b3a2c7d1859cd7299e7032bed10aa41e07b2c4d12b`,
`cd53a76b9c22c3a3e4af307f8d8bc19f60b9fd3845d5d4112637a2c5cb140c1f`,
`f69fcc570f557f163a1f08fb766a507afbd29bd987577e40aecc8ffef96d0ec3`,
`2ff0c371d280373cfc48283e8839f9766f328f6dd23ec35a150e28012228c22d`,
and `ac08a37f20b62a7ab2d7b1ca701b281c7124bc550db05ffc2175472fc6112aca`.
The V2 instance and student/key PrintDocument hashes remain
`934bd3949b6284bbb4061a29b3075560f9389b096ec4f913ad56788e06ac0d02`,
`51892552e00caac748d0ceb2532ed7eb1d7a1e094eef887cb0cc941fd8f80111`,
and `d5a5b226bb485ed8e3cb8a43ef05695015e2a00bb97fe6a85530c654b7db0ebd`.

**Impact**: Repeated answer-signature preparation is no longer the broad-
worksheet blocker, and no answer authority is newly browser-reachable. A
separate generated-style materialization fixture passes N=178 with 548,377
canonical bytes but fails N=179 with 551,466 canonical bytes because complete
safe-graph inspection exceeds the 1,000,000 string-code-unit cap. That is an
effective materialization-envelope contract issue, not a prepared-guard
failure. The advertised problem maximum versus envelope bound requires a
follow-up decision. Printable V2 HTML/artifacts, standalone lesson/Web parity,
React integration, browser/accessibility/A4 evidence, request-wide public
render budgets, and final Phase 1.7 review all remain open.

## 2026-08-02 - Freeze deterministic V2 printable HTML and sample artifacts

**Context**: The renderer-neutral `PrintDocumentV2` checkpoint did not yet
prove that an escaped browser document, its semantic reading order, and its
content-addressed developer artifacts all described the same authorized
worksheet. It also did not establish rendered A4 behavior. The current Web
pages and print styling remain a technical prototype rather than an accepted
product direction.

**Decision**: Add the parallel `printable-html.v2` renderer and
`exercisebook.print-semantic-snapshot/v2` snapshot without changing the frozen
V1 path. Validate and detach the complete PrintDocument before rendering;
escape all content; emit deterministic ordinal IDs, one labelled `role="math"`
per expression, and self-contained CSP-constrained HTML with no active or
external resource surface. The renderer may only present the validated AST; it
does not authorize student delivery, replan, regenerate, or resolve content.
Its module-private structural ceilings are 65,536 emitted elements and
16,000,000 UTF-8 bytes. They fail closed but are not a Worker CPU, memory,
latency, or public synchronous-render SLO.

The reviewed V2 sample command reconstructs the production path from constrained
Markdown through the pinned 12-minute plan, materialization, both print
projections, semantic snapshots, and HTML. It publishes an exact ten-file
bundle with no-clobber same-filesystem temporary writes, uses nonblocking opens
and descriptor-bounded reads so symlinks, FIFOs, oversized files, and other
non-regular paths fail promptly, and verifies the exact manifest, artifact set,
hashes, cross-artifact identities, variant parity, protected fields, and the
reviewed canonical-answer representations. Those lexical checks are defense in
depth; projector authorization and exact reviewed bytes remain authoritative.
`pnpm worksheet:samples` is the aggregate V1+V2 gate;
`pnpm worksheet:sample` remains the intentional V1-only command.

**Evidence**: The fixed source hash is
`456c8908debd52c7fcc5eba6e2e9a38434b5fcd8343e7a14a427faae34502523`
and the plan ID is
`preview-d8e7bffb76e814cf8fed232ed5817008d9291247f94d4e63bda6fbeb647daf33`.
The nine content-addressed artifacts are:

- ContentDocumentV2: 2,680 bytes,
  `944225a2dda87ae6ee61e53f21a929301f5264793d665ea2200b65fb0f5a71dd`;
- DailyPlanPreviewV2: 1,527 bytes,
  `a55f578df16f592c13b5d7d8dd03f196a03176af5827bfb2dc0e312d06eff8c3`;
- WorksheetInstanceV2: 20,941 bytes,
  `934bd3949b6284bbb4061a29b3075560f9389b096ec4f913ad56788e06ac0d02`;
- student and answer-key PrintDocumentV2: 12,077 and 16,012 bytes,
  `51892552e00caac748d0ceb2532ed7eb1d7a1e094eef887cb0cc941fd8f80111`
  and `d5a5b226bb485ed8e3cb8a43ef05695015e2a00bb97fe6a85530c654b7db0ebd`;
- student and answer-key semantic snapshots: 9,055 and 12,450 bytes,
  `313f7dc135ccbb2bc59967c9f78da8b42f1986136f4a2fb32eedb766ebf54d67`
  and `540ae4e7105b030597df2dd0fdfd04b5fb50d562d93d6f71942d45393412d167`;
- student and answer-key HTML: 23,436 and 29,297 bytes,
  `13b819ad153d7c0d2313d412720390ed9544bebf7033f5588e2baf86fc0a5f39`
  and `b49c3812a26b6754d783207d11b4480e20aef112f89087a808b4a60521cb026d`.

The validator-maximal element/cardinality answer-key fixture renders 814 blocks
as 59,046 elements and 2,493,161 UTF-8 bytes, leaving 6,490 elements below the
structural ceiling. Its byte count is specific to that fixture, not a claim
that every authored text field is simultaneously maximal.
Local Chromium 150 checks found no fetched resources, console errors/warnings,
duplicate IDs, missing `aria-labelledby` targets, active elements, or
horizontal overflow in either variant. The student/key documents respectively
contain 51/64 IDs, 20/32 references, and 7/13 labelled math roles; the key has
six ordered solution entries. An ad hoc automated accessibility scan of the
reviewed fixture reported zero violations; it is not assistive-technology
acceptance.

PDFs generated with CSS page size enabled are A4 at 594.96 x 841.92 points:
six student pages and eight answer-key pages. Extracted text preserves all six
ordered problems, working spaces, solutions, and attribution; visual inspection
of every rendered page found no clipping, overlap, or unreadable glyph in this
English fraction fixture. These local Skia PDFs are untagged and ignored test
evidence, not persisted artifacts or a deployed Browser Run backend.

A separate validator-accepted Japanese/long-text probe produces 137,077-byte
student and 590,485-byte answer-key HTML, with zero horizontal overflow across
117/184 authored text and math surfaces. CSS-page-size PDFs contain 26/93 A4
pages. Representative page images cover Japanese glyphs, mathematics, long
explanation continuations, page breaks, answer areas, both variants, and
attribution without clipping or unreadable text; full text extraction retains
the Japanese content. This is machine-local Chromium/font evidence, not a new
frozen identity or broad multilingual acceptance.

**Impact**: The earlier N=178/N=179 observation is a conjunctive structural
maximum caused by one aggregate inspection charging the same semantic text in
both `instance` and its redundant `canonicalJson`, not a defect reachable from
the reviewed planner, which emits only 4, 6, or 8 items. Do not raise the global
graph cap, lower the schema slot maximum, or claim every simultaneous maximum
shape is accepted. A future capacity change should budget the detached instance
graph and canonical UTF-8 representation independently.

Printable V2 HTML, snapshots, exact golden artifacts, and bounded local
browser/A4 evidence are now present. Product-taste acceptance, React V2 and
standalone lesson/Web parity, broader multilingual/font matrices,
tagged/accessible PDF evaluation, hosted Queue -> Browser Run -> R2 rendering,
authenticated persistence, request-wide public render budgets, final
Phase 1.7 integration/release review, merge, deployment, DNS, and licensing
remain pending. The printable-artifact frozen diff itself passed exact-current
whole-diff and Codex reviews with no actionable finding. The bounded checkpoint
is published as stacked draft PR #8 with base `feat/prepared-answer-guard` and
head `feat/v2-printable-html`; its initial two-commit head
`ddf449364832d96fff57e0b05c2ac0196f6c8157` passed exact-head GitHub CI and was
reported clean and mergeable. No merge, deployment, DNS, persistence, or
license mutation is claimed.
