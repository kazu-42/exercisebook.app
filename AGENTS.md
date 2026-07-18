# Exercise Book engineering guardrails

These are the default rules for humans and agents changing this repository.
More specific product requirements or task instructions take precedence. If a
change alters a durable boundary, compatibility contract, privacy posture, or
domain role, update the relevant ADR.

Read [the architecture](docs/architecture.md) and
[ADR-0001](docs/decisions/0001-core-architecture.md) before changing a core
contract.

## Product boundary

Exercise Book is not an AI chat that invents worksheets on demand. It uses
reviewed content, reviewed generators, and attributable learning evidence to
produce reproducible daily plans and concrete exercise-book instances.

- An LLM may help draft, translate, classify, or review content.
- LLM output must not be the sole authority for a correct answer, scoring rule,
  prerequisite, or published explanation.
- Do not use live LLM generation as an automatic fallback for a missing problem
  bank.
- The exact instance presented to a learner must remain reconstructable with
  the same prompts and scoring conditions.

## Domain and URL roles

- `exercisebook.app` is the canonical application, API, content, identity, and
  artifact origin.
- `learning.new` is a stateless redirect into the primary-origin create-plan
  flow.
- A `GET` to `learning.new` must not create durable state. Crawlers, previews,
  and prefetchers can issue it.
- Durable creation requires an explicit, idempotent primary-origin `POST`.
- Forward only allowlisted, non-sensitive parameters across the redirect.
- Do not put learner IDs, names, answers, accommodations, free-form prompts, or
  tokens in action-domain URLs.
- Do not duplicate cookies, OAuth callbacks, APIs, or indexed content on
  `learning.new`.

## Domain invariants

### Content

- The authoring surface is Markdown + YAML + allowlisted directives.
- Do not permit general MDX, raw HTML, arbitrary JavaScript, or a raw TeX
  document as ordinary learning content.
- Markdown is an editing format; a versioned Content AST is the published
  source of truth.
- Unknown directives, generators, skills, schemas, or missing license metadata
  are publication errors.
- Every interactive node requires `printFallback`, alternative text where
  applicable, and a keyboard-accessible Web path.

### Generation

- Do not make problem content depend on `Math.random()`, current time,
  environment locale, time-zone defaults, or object enumeration order.
- Record generator ID/version, RNG algorithm/version, base seed, and stable
  slot sub-seeds in the instance manifest.
- Derive prompt, canonical answer, solution trace, hints, and distractors from
  the same semantic model.
- Rejection sampling requires a fixed maximum attempt count and deterministic
  fallback.
- Do not change fixed test-vector output without changing the generator
  version.
- Test that student variants do not leak answers through hidden markup,
  metadata, alt text, URLs, or PDF text layers.

### Assignment consistency

- Persist and hash-verify the exact `WorksheetInstance` before presentation.
- Retrying an idempotent create request must return the same assignment.
- Web and PDF must render the same instance hash.
- A renderer may change layout; it must not regenerate or reinterpret content.
- Content-addressed artifacts are immutable.

### Learning

- Only `hard_prerequisite` edges form a DAG. Do not mix them with
  `recommended_before`, `related`, `part_of`, `supports`, or standards
  alignment.
- Mastery requires multiple template families, multiple sessions, and delayed
  first-attempt/no-hint evidence.
- Hinted correct, retried correct, paper self-report, and unassisted probe are
  different evidence strengths.
- Keep practice and mastery probes distinct.
- An attempt against an invalidated item does not update learner state; record
  a void event and recompute derived state.
- A daily set has a hard time or item cap. Never respond to difficulty with an
  unbounded drill.
- Persist selection rationale and planner-policy version.

### Privacy and safety

- Public content browsing does not require an account.
- Do not add advertising, third-party behavioral trackers, or sale of learner
  profiles.
- Use age bands instead of exact birth dates unless exact age is necessary.
- Never place learner IDs, names, answers, accommodations, or secrets in public
  R2 keys, URLs, logs, or analytics.
- Private PDFs require an authenticated Worker and
  `Cache-Control: private, no-store`.
- Treat author Markdown, SVG, TeX, shell fragments, and URLs as separate
  untrusted boundaries. Parse, sanitize, and resource-limit each one.

### Licensing

- “Free to view” is not permission to redistribute or adapt.
- Record source URL/revision, content hash, author, attribution, license, and
  modifications for every external asset.
- Do not mix CC BY, CC BY-SA, CC BY-NC, ND, and custom terms without an explicit
  compatibility decision.
- Unknown or incompatible licensing blocks publication.

## Architecture boundary

Dependencies point inward:

```text
framework adapters -> application use cases -> domain model
print projector    -> WorksheetInstance AST + PrintDocument AST
PDF backends       -> PdfBackend port      -> PrintDocument AST
storage adapters   -> repository ports    -> domain model
```

- The domain model must not import Cloudflare, Hono, React, D1, R2, Pandoc,
  Typst, or LuaLaTeX.
- The application projector, not a PDF backend, converts a
  `WorksheetInstance` into a validated `PrintDocument`.
- PDF implementations are replaceable `PdfBackend` adapters.
- D1 owns metadata and transactional state; R2 owns immutable artifacts and
  large payloads.
- Queue consumers assume at-least-once delivery and are idempotent.
- Use a Durable Object only for measured same-ID ordering requirements.
- Do not introduce a graph DB, vector DB, BKT, IRT, DKT, or RL before its data
  and decision gate exists.

## Failure and rollback rules

- A PDF failure must not make the semantic Web worksheet unavailable.
- Never “recover” a renderer failure by silently generating different
  questions.
- Content and generator defects use revision kill switches; preserve historical
  instances and void affected evidence.
- Planner rollback changes the active version for new plans, not old
  assignments.
- Renderer rollback changes the backend/image for new jobs and never overwrites
  old artifacts.
- The safe rollback for `learning.new` is a static redirect to
  `https://exercisebook.app/new`.
- Queue dead-letter replay retains the original job ID, `renderSpecHash`, and
  claim contract; it never rebinds the client request mapping.

## Tests required by change type

- **Generator:** fixed seeds, constraints, answer/solution consistency,
  duplicate rate, maximum attempts, broad seed ranges.
- **Content compiler:** schema, unknown directive, raw HTML, assets, license,
  skill graph.
- **Planner:** prerequisite closure, budget cap, due review, reason codes,
  determinism, kill switch.
- **Evidence/mastery:** hint/retry distinction, multiple families, delayed
  probe, void attempt.
- **Renderer:** Web/PDF semantic parity, student/answer-key projection, page
  count, extracted text, fonts, visual snapshots.
- **Render API:** same-key replay, different-payload conflict, keyed request
  HMAC, variant/release authorization at create/status/download.
- **Queue/job:** duplicate, out-of-order, stale-worker fencing, result-pointer
  race and relation validation, crash before/after pointer creation, retry
  classification, dead-letter replay.
- **Action domain:** no mutation on `GET`, query allowlist, sensitive-parameter
  stripping, safe redirect fallback.
- **Privacy lifecycle:** export, access revocation, profile/link/event/state
  erasure or anonymization, private-object reference traversal, tombstone,
  retention-window deletion, and shared-object GC safety.
- **Security:** oversized YAML/Markdown/SVG, path traversal, network attempt,
  TeX timeout, credential absence.

Run the repository scripts when they exist:

```bash
pnpm typecheck
pnpm test
pnpm worksheet:sample
```

If PDF layout changes, render pages to images and visually inspect at least:
Japanese text, mathematics, long explanations, page breaks, answer areas, and
student/answer-key variants.

## Decision records

Add an ADR under `docs/decisions/` for a change to a long-lived boundary,
compatibility contract, data migration, external API dependency, licensing
policy, privacy posture, or domain role. Do not create ADRs for ordinary local
implementation details.

Update `memory.md` when a significant discovery, tradeoff, warning, or decision
would affect another contributor.
