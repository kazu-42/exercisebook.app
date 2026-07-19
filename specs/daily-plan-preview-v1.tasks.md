# Daily Plan Preview v1 implementation tasks

Status: active
Branch: `feat/daily-plan-preview`
Base: `feat/phase-1-walking-skeleton`

This is the execution ledger for
[Daily Plan Preview v1](daily-plan-preview-v1.md). A checked box means the
implementation and its named verification have both passed; code existing by
itself is not completion.

## Dependency graph

```text
DPP-001
   |
   +----> DPP-002 ----> DPP-004 ----+
   |                                |
   +----> DPP-003 ----> DPP-004 ----+----> DPP-007 ----> DPP-008 ----> DPP-009
   |                                |
   +----> DPP-005 ------------------+
   |                                |
   +----> DPP-006 ------------------+
```

## Tasks

### DPP-001 — Lock the executable contract

- Status: complete
- Size: S
- Owner: coordinator
- Deliverables: specification, roadmap phase, durable decision entry
- Evidence: contract names, budgets, privacy boundary, failure matrix,
  rollback, and acceptance criteria are explicit

### DPP-002 — Pure planner and pinned registry

- Status: complete
- Size: M
- Owner: planner/generator lane
- Dependencies: DPP-001
- Deliverables: `@exercisebook/planner`, request/registry/decision validators,
  ready/unavailable result, public deterministic identity, kill switches,
  exact policy-v2 `[1/2, 1/3, 5/6]` worked-example reservation as explicit plan
  provenance and the example's left/right/result derived from that same tuple
- Required evidence: initial failing tests; mapping and hostile-shape unit
  tests; at least 10,000 property cases for budget/cap; repeated and
  insertion-order determinism vectors; package typecheck

### DPP-003 — Explicit generator planning provenance

- Status: complete
- Size: M
- Owner: planner/generator lane
- Dependencies: DPP-001
- Deliverables: explicit requested item count and plan/policy/graph/reason
  inputs; reviewed-content cap; explicit reserved canonical-answer input with
  deterministic retry provenance; updated content materializer callers
- Required evidence: old Phase 1 fixed hash unchanged; changed policy metadata
  changes the instance; stable-prefix prompts pass

### DPP-004 — Hono application service and API boundary

- Status: complete
- Size: M
- Owner: API lane
- Dependencies: DPP-002, DPP-003
- Deliverables: strict public response contract, real composition service,
  `POST /api/plans/preview`, sanitized body/media/availability/internal errors
- Required evidence: real integration; cache/security headers; body limit;
  deterministic replay; broad date/seed semantic scan; deep student leak scan;
  operand/result worked-example collision rejection; hash-correct cross-slot
  `printFallback` leak rejection; no persistence adapter

### DPP-005 — Strict Web worksheet delivery contract

- Status: complete
- Size: M
- Owner: frontend lane
- Dependencies: DPP-001
- Deliverables: bounded runtime schemas for student and answer-key Web DTOs;
  sample and preview loaders validate before rendering; final student
  projection independently fails closed on worked-example operand/result
  collisions and applies field-sensitive cross-slot scanning
- Required evidence: missing/unknown/hostile/oversized shapes fail; nested
  student answer and seed fields fail; global/non-prompt fields reject every
  answer; legitimate prompt operand reuse passes; malformed responses become
  recoverable UI errors; caller/timeout abort identity survives a pending
  post-header body read

### DPP-006 — Accessible `/new` preview and same-instance print

- Status: complete
- Size: M
- Owner: frontend lane
- Dependencies: DPP-001
- Deliverables: interactive form, explicit preview copy, async state machine,
  stale-request cancellation, plan summary, loaded worksheet, in-page print
- Required evidence: user-event normal/error/race/print tests and axe checks for
  initial, success, and error states

### DPP-007 — Integration repair and full static gate

- Status: complete
- Size: S
- Owner: coordinator
- Dependencies: DPP-002 through DPP-006
- Deliverables: resolve cross-lane contracts, lockfile, dependency boundaries,
  policy-v2 fixed vectors, version/provenance contract, and trace acceptance
  criteria to tests
- Required evidence: format, TypeScript 7, schema/content freshness,
  boundaries, all tests, build, and sample artifacts pass
- Recorded evidence: `pnpm check` passed 27 files / 391 tests with TypeScript
  7.0.2; schema/content/boundary/build gates passed and the Phase 1 sample
  instance remained
  `5252ef64b127638b785a94b3a2c7d1859cd7299e7032bed10aa41e07b2c4d12b`

### DPP-008 — Production-bundle browser and print verification

- Status: complete
- Size: S
- Owner: coordinator
- Dependencies: DPP-007
- Deliverables: real browser flow at desktop and 390 px, request/storage/leak
  inspection, student print rendering, screenshots/PDF only as local evidence
- Required evidence: no console error, failed first-party or third-party
  request, cookie/storage write, answer/seed leak, overflow, or route failure
- Recorded evidence: keyboard-only 20-minute flow stayed on `/new`, printed
  once without another generation, and preserved history; desktop and 390 px
  had zero overflow/console/storage/third-party/protected-token findings; the
  formerly colliding `2026-07-30` set had eight items and zero reserved-value
  collisions; its visually inspected student PDF is two-page A4 with no forms,
  JavaScript, encryption, clipping, or protected tokens

### DPP-009 — Independent review and stacked draft PR

- Status: pending
- Size: S
- Owner: independent reviewer then coordinator
- Dependencies: DPP-008
- Deliverables: correctness/privacy/accessibility/operability review, repaired
  findings, final full gate, focused commit, pushed branch, draft PR targeting
  `feat/phase-1-walking-skeleton`
- Required evidence: clean worktree after commit, remote SHA readback, draft PR
  readback, CI result; no merge or deployment

## Deferred findings (not silently dropped)

- ContentDocument-derived worked example and lesson projection across Web and
  PrintDocument: next correctness slice before curriculum breadth.
- The canonical student PrintDocument projector still needs the Web
  projector's field-sensitive all-answer scan before any hosted/public PDF;
  `/new` is safe because it prints the already-sanitized Web DTO locally.
- Browser preview responses need a bounded, duplicate-key-aware JSON decoder;
  `Response.json()` alone is not the production trust boundary.
- Anonymous preview endpoints need reviewed rate limiting/abuse controls and
  the complete production security-header policy before deployment.
- The deterministic preview sequence is public replay provenance, not
  cryptographic answer secrecy. Future answer submission must be authorized
  server-side, and preview attempts remain explicitly non-mastery evidence.
- Exact rational answer submission, formative feedback, hint/retry evidence:
  next product-value slice after this preview.
- Automated cross-browser CI: introduce after the current CLI browser smoke
  establishes stable scenarios and ownership/cost are explicit.
- License selection, trusted curriculum review, Cloudflare project/DNS, and
  production deployment remain owner decisions.
