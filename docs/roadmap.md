# Exercise Book roadmap

Status: working plan
Updated: 2026-07-19

This roadmap is not a deployment-status page. Phase 1 is implemented as a
local walking skeleton and Phase 1.5 is active on a stacked draft branch;
production DNS, hosted Cloudflare persistence, and PDF backends remain gated
future work.

## Product direction

Exercise Book aims to make high-quality learning material freely available
across ages and subjects. A learner supplies a goal, available time, and current
evidence; the system creates a bounded daily set of explanations, practice,
review, and transfer tasks. The same concrete set works as an interactive Web
experience and as a printable worksheet.

The broad architecture is designed early, but curriculum scope expands only
after correctness, learning, accessibility, licensing, privacy, and operational
gates are met. “All grades and subjects” is a direction, not the MVP backlog.

## Non-negotiable invariants

- Public curriculum is usable without an account.
- A daily set has a hard time/problem budget; struggling learners never receive
  an unbounded drill.
- Every presented problem is an immutable, replayable worksheet instance.
- Prompt, answer, scoring, hints, and solution share one semantic model.
- Web and PDF render the same instance.
- Mastery distinguishes first attempt, retry, hint use, delay, and transfer.
- Hard prerequisites are not silently removed by personalization.
- A planner can explain why each item was selected.
- Content, generators, policies, renderers, and licenses are versioned.
- Ads, third-party learner trackers, and sale of child learning profiles are
  outside the product.
- LLM output cannot publish itself or become the only authority for an answer,
  scoring rule, prerequisite, or license.

## Phase 0 — Repository and decision baseline

Outcome: a reviewable project with explicit boundaries.

Deliver:

- pinned TypeScript 7 workspace with pnpm and Vite;
- Exercise Book identity and `exercisebook.app` as the primary application
  domain;
- repository license decisions for software, original curriculum, and project
  documentation;
- engineering guardrails and ADR format;
- CI skeleton, formatting, type checking, and test commands;
- domain model vocabulary and initial privacy/licensing posture;
- architecture, content-authoring, research, and roadmap documents.

Exit gate:

- the workspace compiler reports TypeScript major version 7;
- repository and domain names agree;
- no old project identity remains in public-facing files;
- code/content licenses are explicitly approved by the owner;
- CI can fail a deliberately broken fixture;
- rollback for a bad deployment is documented.

Rollback:

- repository-only changes are reverted by commit;
- `exercisebook.app` DNS remains disconnected until a minimal static deployment
  is verified;
- `learning.new` remains non-resolving until the complete creation and
  authentication-continuation flow is tested;
- no learner data exists in this phase.

Domain deadline gate:

- owner: repository owner;
- readiness target: 2026-10-20 JST;
- hard policy point: 2026-10-27 06:48:39 JST;
- before the hard point, either deploy a tested, policy-compliant redirect into
  the real creation flow or make an explicit registrar/domain-retention
  decision;
- do not treat non-resolution as an indefinite fallback after the 100-day
  enforcement waiver.

## Phase 1 — Correct local vertical slice

Outcome: one small topic works end to end without hosted infrastructure.

Suggested curriculum slice:

- 30-50 reviewed skills from fraction meaning and operations toward ratio and
  simple linear relationships;
- a smaller first implementation may start with 5-10 fraction skills.

Deliver:

- Markdown/YAML/directive compiler;
- normative exported runtime validators (bounded original-input guard followed
  by versioned Zod contracts) plus checked-in structural JSON Schema
  interoperability projections for Content AST and Worksheet Instance;
- exact integer/rational problem model and answer types;
- exact binary-key HMAC-SHA256/RFC 8785 slot derivation, stable presentation
  slots, explicit seed-secret version input, generator versioning, and fixed
  vectors;
- bounded deterministic commutative-prompt deduplication with retry provenance;
- draft-only compilation/materialization; published content waits for the
  trusted release manifest in Phase 2;
- semantic Web renderer;
- Print IR with student and answer-key variants;
- one interactive component with keyboard and print fallback;
- printable A4 HTML for manual/local browser printing, with no PDF backend;
- correctness, property, parity, accessibility, and HTML rendering tests.

Exit gate:

- same inputs produce byte-equivalent canonical instance JSON;
- large seed tests produce no invalid or ambiguous items;
- canonical answer equals the final solution step;
- student output contains no hidden answer;
- Web and PrintDocument/printable HTML preserve prompt/order/answer semantics
  and attribution;
- Phase-1 English fraction math, working-space, and page-break fixtures pass;
- every asset has provenance and license metadata.

Rollback:

- disable a content/generator version through a registry;
- historical fixtures remain replayable;
- no automatic migration of assigned instances.

## Phase 1.5 — Anonymous day-one plan preview

Outcome: `/new` produces a useful, bounded set instead of discarding the
learner's goal and time choice.

This is a cold-start product-validation slice. It is not saved, uses no learner
history, and makes no adaptive or mastery claim.

Deliver:

- strict `DailyPlanPreviewV1` request, internal decision, and public response
  contracts;
- an explicit version-pinned registry and revision kill switches;
- a pure deterministic policy for the reviewed fraction-addition goal;
- 8-, 12-, and 20-minute practice budgets producing at most 4, 6, and 8
  reviewed problems respectively;
- stable-prefix problem sequences across budgets;
- explicit plan, policy, graph, and reason provenance passed into the
  generator rather than invented there;
- `day-one-fraction-preview@2` plan activities explicitly reserve every
  reduced rational exposed by the reviewed worked example as the ordered tuple
  `[1/2, 1/3, 5/6]`; the example's left/right/result derive from the same tuple,
  with deterministic generator retries recorded in worksheet provenance;
- student-only `POST /api/plans/preview` composition through content,
  generator, integrity gate, and Web projection;
- an accessible `/new` loading/success/error flow with visible selection
  rationale;
- printing of the already loaded student instance without regeneration;
- strict response validation, answer/seed leak protection, and production
  bundle browser smoke tests.

Exit gate:

- planned slot time never exceeds the learner's requested practice budget or
  reviewed content cap;
- identical explicit inputs and versions produce byte-equivalent decisions and
  instances without ambient clock, locale, time-zone, or randomness inputs;
- shorter-budget prompts are prefixes of longer-budget prompts;
- disabled/unknown revisions produce a typed unavailable result and no set;
- public responses and rendered student output contain no answers, scoring
  data, solution traces, base seeds, or slot seeds;
- generated practice answers never collide with an operand or result exposed
  by the reviewed worked example, and the final student projector independently
  scans the complete example and fails closed on a semantic answer leak;
- the page says the preview is unsaved and not mastery-based;
- keyboard, accessibility, failure/race, mobile, print, and full repository
  gates pass.

Rollback:

- disable `day-one-fraction-preview@2` or revert the stacked feature commit;
- keep the fixed `/worksheet/sample` Phase 1 route available;
- never silently substitute a different problem sequence after a failure.

See [Daily Plan Preview v1](../specs/daily-plan-preview-v1.md).

## Phase 2 — Public read-only catalog

Outcome: anyone can browse explanations, worked examples, and fixed practice
without creating an account.

Deliver:

- Workers Static Assets and API Worker;
- content release manifest and immutable public R2 assets;
- D1 catalog metadata;
- semantic URLs, search metadata, sitemap, and attribution pages;
- WCAG 2.2 AA baseline;
- locale-aware public content with no learner tracking;
- deploy previews and production smoke tests.

Exit gate:

- static requests do not unnecessarily invoke Worker code;
- public/private R2 boundaries are tested;
- no account or tracking is required for public content;
- performance and accessibility budgets pass on low-end/mobile conditions;
- asset license and attribution CI is complete;
- rollback to the previous Worker/content manifest is rehearsed.

Rollback:

- redeploy the prior Worker version;
- point the release manifest to the prior immutable content revision;
- do not overwrite cached public objects.

## Phase 3 — Generated daily worksheet MVP

Outcome: a learner can request, open, and print a reproducible daily set.

Deliver:

- goal, time budget, diagnostic snapshot, and local study date inputs;
- explainable rules-based planner;
- prerequisite closure, due review, goal frontier, and transfer buckets;
- persisted worksheet instances before presentation;
- D1 render-job metadata, R2 instance/PDF storage, and Queues;
- Browser Run `/pdf` backend;
- student, answer-key, and teacher variants;
- authenticated private artifact delivery;
- render reconciliation, DLQ replay, observability, and kill switches.

Cloudflare shape:

```text
Workers Static Assets + API Worker
  -> D1 metadata
  -> private/public R2 artifacts
  -> Queue
  -> Browser Run /pdf
```

Workflows are not part of this phase. One worksheet render is one idempotent
Queue job.

Exit gate:

- duplicate/out-of-order Queue tests are safe;
- crash after R2 upload can reconcile without duplicate visible state;
- render p95, failure rate, page count, bytes, and Browser Run usage meet the
  written budget;
- PDF semantic/visual validation and missing-glyph tests pass;
- planner always respects the hard time/problem cap;
- every item includes a learner-readable selection reason;
- disabling planning or PDF rendering does not remove the public catalog.

Rollback:

- freeze new planning independently from existing worksheet access;
- switch new render jobs to a prior explicit renderer/template version;
- serve already validated immutable artifacts;
- void defective content attempts before mastery updates.

## Phase 4 — Learning evidence and safe accounts

Outcome: the next daily set uses real evidence while preserving anonymous public
access.

Deliver:

- optional parent-managed or appropriately consented learner accounts;
- pseudonymous learner IDs and data minimization;
- attempt ledger with first response, retry, hints, mode, and scorer version;
- initial explainable mastery state machine;
- delayed review at conservative versioned intervals;
- practice vs unassisted mastery probes;
- export/delete and retention controls;
- paper completion/self-report clearly separated from Web-scored evidence.

Initial evidence policy should require multiple template families, sessions,
and delayed no-hint evidence before `mastered`. It is a versioned hypothesis,
not a scientific constant.

Exit gate:

- threat/privacy review covers child data, guardian flows, logs, analytics, and
  deletion;
- an invalid item can be voided without updating learner state;
- hint/retry/paper evidence does not count as unassisted evidence;
- a historical state decision can be explained from its evidence and policy;
- no sensitive learner data appears in URLs, object keys, caches, or logs;
- account deletion/export is tested end to end, including access revocation,
  profile/link/event/state erasure or anonymization, private D1/R2 reference
  traversal, tombstones, retention-window deletion, and shared-object
  garbage-collection safety.

Rollback:

- planner can fall back to a non-adaptive or locally stored plan;
- mastery policy is selected by explicit version;
- the evidence log remains append-only: corrections append void/superseding
  events, then derived learner state is recomputed from valid events without
  rewriting history;
- accounts can be disabled without hiding public curriculum.

## Phase 5 — Print quality backends

Outcome: choose a better print backend only if measurements show that Browser
Run cannot meet required quality or cost.

### Typst WASM experiment

Benchmark:

- Japanese 1/5/20/50-page documents;
- font memory and subset strategy;
- dense math, SVG, raster images, tables, and page breaks;
- cold/warm latency, peak memory, concurrency, and failure rate;
- text extraction, tagged PDF/accessibility, and visual snapshots.

Adoption gate:

- meets a written p95/memory/error budget under current Worker limits;
- CJK and math quality match or exceed the Browser Run baseline;
- no arbitrary Typst enters from authors;
- operating it is simpler or materially cheaper/better.

### LuaLaTeX Container

Add only for a measured requirement such as superior Japanese book typography,
complex math layout, or reviewed TikZ output.

Adoption gate:

- pinned image, TeX Live snapshot, packages, templates, and fonts;
- non-root, network-denied, credential-free compile;
- no raw author TeX;
- timeout/process/memory/output/page limits and fuzz tests;
- cold-start, queue capacity, cost, and failure budgets;
- semantic and visual parity with the same Worksheet Instance;
- canary and instant switch back to Browser Run.

Sandbox is reserved for per-job untrusted code isolation if raw code is ever an
explicit product requirement. The preferred policy is not to accept raw TeX.

Rollback:

- backend selection is a server-side feature flag;
- every job names an explicit renderer version;
- prior immutable artifacts continue to work;
- content and learner history are independent of the print backend.

## Phase 6 — Authoring and open curriculum operations

Outcome: trusted contributors can propose content without weakening correctness
or licensing controls.

Deliver:

- browser editor and local CLI using the same compiler/schema;
- fixed-seed preview, Web/PDF/answer-key preview, and accessibility outline;
- named correctness, pedagogy, accessibility, and license review states;
- source/edition/hash/provenance records;
- attribution generation;
- controlled import adapters for selected OER sources;
- CASE/QTI import/export adapters where interoperability is useful;
- correction, deprecation, and affected-instance tooling.

LLMs may assist drafts, translations, tagging suggestions, and review triage.
They do not approve publication.

Exit gate:

- malformed/hostile source corpus passes parser and renderer security tests;
- no asset can publish without compatible license/provenance metadata;
- reviewers can compare source, AST, generated samples, and rendered variants;
- corrections disable new use without destroying historical instances;
- contributor actions are audited and reversible.

Rollback:

- pause author/import publication independently;
- return to the prior content release manifest;
- quarantine a source collection or license class.

## Phase 7 — Evidence-based expansion

Outcome: expand subjects, ages, locales, and modeling only where the foundation
continues to work.

Expand in this order:

1. more template families and transfer tasks for existing skills;
2. adjacent skills and domains with reviewed prerequisite edges;
3. additional locales and accessibility modes;
4. science, language, humanities, computing, vocational, and adult-learning
   vertical slices;
5. richer projects, simulations, and mixed Web/print experiences.

Do not introduce BKT, IRT/CAT, DKT, reinforcement learning, a graph database, or
a vector database merely because the platform is broad.

Model adoption gates:

- stable skill definitions and sufficient evidence per skill/family;
- held-out delayed retention and transfer evaluation;
- calibration, false-mastery, subgroup, and opportunity-to-learn analysis;
- explainability and safe fallback;
- comparison with the rules-based baseline;
- no optimization solely for completion, streaks, or next-answer accuracy.

Workflows may be introduced here for long-running release pipelines,
human-in-the-loop review, or multi-step imports—not as a replacement for simple
Queue jobs.

## Cross-phase quality scorecard

### Learning

- 7-day and 30-day delayed retention;
- transfer to unseen template families or contexts;
- first-attempt/no-hint performance;
- false mastery after delayed probe;
- goal attainment per learner time.

### Content

- correctness defect and ambiguous-item rate;
- generator rejection, duplicate, and invalid rate;
- skill and template-family coverage;
- review freshness;
- license/provenance completeness.

### Fairness and accessibility

- outcome, difficulty exposure, path, and opportunity-to-learn by relevant
  groups where legally and ethically measurable;
- WCAG audit results;
- interactive/keyboard/print fallback coverage;
- accommodation behavior without using accommodation as an ability proxy.

### Operations

- plan/render success and p50/p95 latency;
- Queue retry/DLQ/reconciliation rate;
- PDF missing-glyph, corruption, and visual-regression rate;
- R2/D1/Browser Run/Container usage and cost per active learner;
- privacy, security, and deletion test results.

These metrics are release evidence, not vanity dashboards. Completion rate,
streaks, and time-on-site are guardrails only; they are not proof of learning.

## The next concrete milestone

The active milestone is Phase 1.5: make `/new` create an anonymous, explainable,
deterministic practice preview that obeys a hard time budget and prints the same
loaded student instance. Its executable contract and acceptance matrix are in
[Daily Plan Preview v1](../specs/daily-plan-preview-v1.md).

The next correctness slice is content-derived lesson and worked-example
projection so reviewed content, Web, and print no longer rely on an
application-owned example. The next product-value slice is exact rational
answer submission and formative feedback for one problem. It must distinguish
first attempt, retry, and hint use while keeping answers out of the student
payload and making no mastery claim. The current public deterministic sequence
is replay provenance, not cryptographic answer secrecy, and must never be used
to authenticate attempts or justify mastery. Curriculum breadth and
Cloudflare persistence remain behind those learning-value checks; public
curriculum publication remains behind the owner's license decision.
