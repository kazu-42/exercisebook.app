# ADR-0001: Core architecture and domain roles

- Status: Proposed
- Date: 2026-07-19
- Owners: Exercise Book maintainers

This ADR records the target architecture. It does not assert that the
Cloudflare services, domain routing, production application, Browser Run PDF
service, or LuaLaTeX backend described below are deployed. Phase 1 stops at a
local Web/PrintDocument/printable-HTML walking skeleton.

## Context

Exercise Book is intended to provide free learning across ages and subjects,
while producing a daily set of practice, explanations, and printable pages for
each learner. The curriculum must be structured enough to preserve
prerequisites and evidence quality, but flexible enough to change with a
learner’s goals.

The project owns two domains:

- `exercisebook.app`;
- `learning.new`.

It also needs to support:

- accountless public learning and optional persistent profiles;
- deterministic generated problems;
- semantic Web and high-quality PDF output;
- Cloudflare-native delivery;
- strict child privacy and content licensing;
- renderer and adaptive-model evolution without rewriting learning history.

The most expensive failure would be to let frameworks, PDF source, or a
probabilistic service become the source of truth. That would make an assignment
impossible to reproduce, audit, invalidate, or render consistently.

## Decision

### 1. Domain roles

`https://exercisebook.app` is the single canonical origin for the application,
content, API, authentication, and artifacts.

`https://learning.new` is a stateless action entrypoint that begins the
create-plan/create-exercise-book flow. Its `GET` handler has no durable side
effect and forwards only allowlisted, non-sensitive parameters to
`https://exercisebook.app/new`. Durable creation occurs through an explicit,
idempotent `POST` on the primary origin.

Cookies, OAuth callbacks, indexed content, learner state, and private artifact
delivery are not duplicated on the action domain.

### 2. Canonical learning contracts

The durable domain contracts are:

- a versioned skill graph;
- reviewed content and generator revisions;
- an explainable planner-policy revision;
- deterministic RNG identity and stable slot seeds derived with binary-key
  HMAC-SHA256 over an RFC 8785 canonical tuple;
- a concrete immutable `WorksheetInstance`;
- append-only attempt/evidence events;
- content-addressed artifact and render manifests.

Markdown + YAML + allowlisted directives is an authoring format. A versioned
Content AST is the releasable content contract; a future trusted release
manifest, not author-controlled frontmatter, makes a revision published. The
materialized `WorksheetInstance` is the assignment contract. Phase 1 accepts
draft content only.

Web and PDF render the same instance. A renderer cannot generate, select, or
reinterpret problems.

### 3. Dependency direction

Use ports and adapters:

```text
framework adapters -> application use cases -> domain model
print projector    -> WorksheetInstance AST + PrintDocument AST
PDF backends       -> PdfBackend port      -> PrintDocument AST
storage adapters   -> repository ports    -> domain model
```

The domain is independent of Hono, React, Cloudflare bindings, D1, R2, Pandoc,
Typst, and LuaLaTeX.

### 4. Cloudflare container allocation

- Workers Static Assets serve public application assets.
- A Worker API adapts HTTP to application use cases.
- D1 stores relational metadata and transactional state.
- R2 stores immutable content, instance, Print Document, Render Spec, media,
  font, PDF, manifest, and create-only result-pointer objects.
- Queues carry at-least-once rendering and batch work.
- Workflows are reserved for durable multi-step operations.
- Durable Objects are reserved for measured same-ID ordering or live-session
  requirements.
- `learning.new` uses a minimal independently deployable redirect Worker with
  no learner-state bindings.

An instance is written and hash-verified in R2 before its assignment pointer is
committed in D1. Retrying creation returns the same assignment. Reconciliation
repairs lost requested/prewarm render enqueues and result-pointer/D1
split-brain.

### 5. Rendering strategy

- implemented Phase-1 reference: renderer-neutral PrintDocument plus printable
  A4 HTML;
- future hosted MVP candidate: Browser Run;
- future experiment: Typst WASM if memory, performance, CJK, and accessibility
  benchmarks pass;
- future high-quality candidate: restricted LuaLaTeX Container.

All backends implement one renderer port. Backend, image, font, template, and
renderer revisions are recorded in the artifact manifest.

### 6. Initial adaptation policy

Begin with a reviewed skill graph and deterministic rule-based planner. The
planner orders due retrieval, prerequisite repair, current frontier, and
transfer practice under a hard time/item budget.

BKT, IRT/CAT, DKT, and reinforcement learning are deferred until stable skill
labels, sufficient samples, calibration, and long-term outcome metrics exist.

LLMs may assist authoring and review but are not the learner-time source of
truth for answers, scoring, prerequisites, or published explanations.

## Invariants

- A learner never receives an assignment before its exact instance is durable.
- Content revision, generator/RNG revision, policy revision, and seeds make
  generation reproducible.
- Web and print preserve the same semantic instance.
- Student variants contain no answer projection.
- Unknown schema, directive, generator, skill, provenance, or license fails
  publication closed.
- Queue handlers are idempotent under duplicate and out-of-order delivery.
- Content-addressed artifacts are immutable.
- Public catalog access does not depend on identity, PDF, or `learning.new`.
- `GET https://learning.new` does not mutate durable state.
- Historical assignments and evidence remain attributable to the versions that
  produced them.

## Consequences

### Positive

- Assignments are reproducible, auditable, and safely invalidatable.
- Web and multiple PDF engines can evolve independently.
- The core domain can be tested without Cloudflare.
- Public learning degrades gracefully when identity or rendering fails.
- The `.new` domain gives a memorable action without creating a split-origin
  application or accidental crawler-triggered writes.
- Simple initial adaptation remains explainable to learners, guardians, and
  reviewers.

### Costs and tradeoffs

- Content must pass compilation and review before publication.
- Storing exact instances uses more object storage than reconstructing from
  mutable templates.
- R2/D1 split writes require idempotency, reconciliation, and orphan cleanup.
- Multiple renderers require parity tests and versioned manifests.
- A rule-based planner is less statistically sophisticated at first.
- The action-domain redirect needs independent monitoring and configuration,
  even though it owns no product state.

## Failure handling

- A storage failure before assignment commit returns no assignment.
- A lost HTTP response after commit is recovered by idempotent lookup.
- A lost requested or policy-prewarmed render enqueue is repaired by
  reconciliation.
- Duplicate Queue work converges through a unique render key and
  compare-and-set state transitions.
- Renderer failure leaves the semantic Web worksheet available and never causes
  semantic regeneration.
- A defective item/generator is disabled for future use; affected evidence is
  voided while exact historical instances remain for audit.
- Identity failure leaves public and anonymous flows available.
- Action-domain failure falls back operationally to direct
  `exercisebook.app/new` access.

## Rollback

- **Content/generator:** disable the active revision, preserve old instances,
  void affected evidence, and publish a new revision.
- **Planner:** move the active pointer for new plans to the prior policy; do not
  rewrite old plans.
- **Renderer:** select the prior backend/image for new jobs; never overwrite an
  old content-addressed PDF.
- **Application:** use a prior Worker version while keeping schema migrations
  backward compatible through the rollback window.
- **Action domain:** deploy a static, side-effect-free redirect to
  `https://exercisebook.app/new`.

## Alternatives considered

### Treat Markdown, HTML, or TeX as canonical

Rejected because these formats mix authoring/layout concerns with runtime
semantics and cannot safely guarantee Web/print/scoring parity.

### Generate problems live with an LLM

Rejected as a default path because correctness, scoring consistency,
reproducibility, latency, and safety cannot be guaranteed by a prompt alone.

### Build the full application on both domains

Rejected because it duplicates identity, cookies, canonical URLs, cache rules,
monitoring, and privacy boundaries. It also makes `.new` prefetch behavior
dangerous.

### Use LuaLaTeX inside a normal Worker

Rejected because the runtime does not provide a conventional process model and
the isolation/resource requirements belong in a Container or Sandbox.

### Use a graph database and advanced adaptive model immediately

Deferred because early content/evidence quality, not model sophistication, is
the limiting factor. Repository ports allow later migration after measured
need.

### Use Workflows or Durable Objects for all operations

Rejected as unnecessary complexity. Queues plus idempotent D1 state cover
one-step rendering; stronger orchestration is added only where its invariant is
required.

## Verification

This decision is considered implemented only when tests show:

- fixed seeds reproduce the same semantic instance;
- retrying creation returns the same assignment;
- student Web/PDF projections contain no answers;
- Web and PDF reference the same instance hash;
- duplicate Queue delivery produces one terminal winning result;
- renderer failure does not block Web learning;
- public catalog access survives identity and action-domain failure;
- a `GET` through `learning.new` creates no plan or assignment;
- revision rollback affects new work without mutating historical records.

## References

- [Exercise Book architecture](../architecture.md)
- [Engineering guardrails](../../AGENTS.md)
