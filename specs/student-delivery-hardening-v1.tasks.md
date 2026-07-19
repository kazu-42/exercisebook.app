# Student Delivery Hardening v1 implementation tasks

Status: complete in draft PR #3
Branch: `feat/student-delivery-hardening`
Base: `feat/daily-plan-preview`

This is the execution ledger for
[Student Delivery Hardening v1](student-delivery-hardening-v1.md). A task is
complete only when its implementation and named evidence have passed.

## Dependency graph

```text
SDH-001
   |
   +----> SDH-002 ----+
   |                  |
   +----> SDH-003 ----+----> SDH-004 ----> SDH-005 ----> SDH-006
```

## Tasks

### SDH-001 — Lock contract and adversarial evidence

- Status: complete
- Size: S
- Owner: coordinator and read-only auditors
- Deliverables: executable spec, roadmap phase, failure matrix, limits,
  rollback, and a hash-correct leak reproduction
- Evidence: on base commit `e0c4d92`, a rehashed fixed sample with slot 2
  answer `11/28` in slot 1 `printFallback.text` was accepted by the shared and
  PrintDocument student projectors; both browser loaders used
  `Response.json()`

### SDH-002 — Field-sensitive shared and print boundary

- Status: complete
- Size: M
- Owner: schema/print lane
- Dependencies: SDH-001
- Deliverables: role-sensitive all-answer checks; exact operand-derived prompt
  and accessibility strings; student PrintDocument projection exclusively from
  `StudentWorksheetDeliveryV1`; and a final role-sensitive PrintDocument scan
- Required evidence: rehashed fallback and appended prompt-answer prose fail;
  legitimate structured operand reuse passes only in derived representations;
  own and duplicate-equal answers fail; a projector-role regression cannot
  move an allowed operand into caption/fallback/paragraph prose; existing
  student and answer-key PrintDocument semantic goldens and fixed vectors stay
  unchanged
- Evidence: `packages/schemas/src/schema-contract.test.ts` passed 88 tests,
  `packages/print-document/src` passed 45 tests, and
  `apps/web/src/worker/web-worksheet-projector.test.ts` passed 12 tests. The
  suite covers cross-slot fallback/prose rejection, legitimate operand reuse,
  own/duplicate answers, final PrintDocument field-role mutations, unsafe
  accessors, and caller mutation across asynchronous hashing. Student
  projection uses the answer-free delivery; answer-key projection preserves
  schema-valid source prompt text. Both checked-in semantic goldens and all six
  content-addressed sample artifacts remained unchanged.

### SDH-003 — Bounded strict browser response decoder

- Status: complete
- Size: M
- Owner: Web transport lane
- Dependencies: SDH-001
- Deliverables: shared duplicate-aware parser, streaming bounded decoder,
  route-owned 32 KiB/64 KiB limits, a 1,024-read ceiling, sample
  cancellation/deadline contract, producer-budget gate, and loader integration
- Required evidence: declared/measured limits, exact cap, multibyte and invalid
  UTF-8, literal/escaped/nested duplicates, malformed JSON, missing body,
  empty/many-small/non-byte chunks, disturbed body, early and pending abort,
  exact reason identity, cancellation-failure precedence, cancel/listener/lock
  cleanup, 64-depth/512-value request-parser parity, producer headroom, and
  no-error/no-stale component cleanup tests pass
- Evidence: `strict-json`, bounded-response, both loader, component, preview
  producer, and sample producer files passed 124 tests. The reviewed producer
  maxima are 4,899 bytes for previews, 4,238 bytes for the student sample, and
  8,562 bytes for the answer key; every response also passes the browser's
  64-depth/512-value strict parser. Decoder tests cover exact byte/read limits,
  fatal UTF-8, duplicate keys, missing/locked/non-byte bodies, abort identity,
  cancellation precedence, and listener/reader cleanup. The tagged React state
  prevents a loaded answer key from appearing while a student variant is
  pending.

### SDH-004 — Integration and immutable-output gate

- Status: complete
- Size: S
- Owner: coordinator
- Dependencies: SDH-002, SDH-003
- Deliverables: reconcile parallel changes, update documentation, and verify no
  unintended output/version change
- Required evidence: targeted packages, full `pnpm check`, TypeScript 7.0.2,
  schema/content/boundary/build gates, dependency audit, fixed Phase 1 hash,
  named Phase 1.5 plan/base-seed and sample assignment/instance vectors, both
  PrintDocument semantic goldens, and printable sample artifacts all pass
- Evidence: final `pnpm check` passed formatting, TypeScript `7.0.2`, schemas,
  content, import boundaries, 28 test files/461 tests, Worker/client builds,
  sample generation, and artifact verification. `pnpm audit --audit-level
  high` found no known vulnerabilities; `pnpm dedupe --check` and `git diff
  --check` passed. Fixed identities remain:
  - content-resolved instance
    `5252ef64b127638b785a94b3a2c7d1859cd7299e7032bed10aa41e07b2c4d12b`;
  - 12-minute plan
    `preview-0ceccc181b16205f75577fb8fcae010433680890fab0bafa759e8cb5e6cd4d45`
    and base seed
    `fe05015e60ae92979bbd77f1101c5789fa78fcfc0ad524268ef7eaff59102815`;
  - arbitrary-seed sample assignment
    `sample-0d2e4f18c887611e9b4e6739ef1cb3697df8f2ef1bc2b2cbceb6c5f8773470ef`
    and instance
    `69d9c7ebe12ab40093f3d084015b02a0f658f57566176793501a6fd208a65888`;
  - student/answer-key PrintDocuments `cd53a76b...40c1f` and
    `f69fcc57...0ec3`.

### SDH-005 — Production-bundle browser verification

- Status: complete
- Size: S
- Owner: coordinator
- Dependencies: SDH-004
- Deliverables: real `/new` and fixed sample load/variant/print checks at
  desktop and 390 px, including network, console, storage, and leak inspection
- Required evidence: no failed first-party or third-party requests, console
  errors, storage writes, overflow, duplicate fetch on print, or protected data
- Evidence: the final production bundle was exercised at 1440 px and an
  emulated 390 x 844 mobile viewport. `/new`, `/worksheet/sample`,
  `/worksheet/sample/answers`, and
  `/worksheet/sample/print?variant=student` loaded with only successful
  localhost requests and zero console messages. The 390 px pages had matching
  390 px client/scroll widths, no cookie/localStorage/sessionStorage writes,
  and no protected internal keys in student DOM. Student and answer-key routes
  showed the same fixed instance with 8 practice inputs/8 answer labels.
  Stubbing and invoking both print buttons recorded one print call and no
  second preview or sample request.

### SDH-006 — Independent review and stacked draft PR

- Status: complete
- Size: S
- Owner: independent reviewers then coordinator
- Dependencies: SDH-005
- Deliverables: adversarial correctness/security and UX/operations reviews,
  repaired findings, final full gate, focused commit, pushed branch, and draft
  PR targeting `feat/daily-plan-preview`
- Required evidence: clean worktree, remote SHA and draft/base/head readback,
  successful CI, no merge or deployment, and remaining findings recorded as
  explicit next-loop work
- Evidence: independent browser-transport, snapshot/privacy,
  integration/documentation, and release-readiness reviews approved after their
  findings were repaired. Implementation commit
  `1be4c7d8c80ab0c55e0ab1819086065aab4c8d08` was pushed to
  `feat/student-delivery-hardening`; draft PR #3 is open and mergeable with base
  `feat/daily-plan-preview` and the expected head. GitHub CI passed its full
  `Format, types, tests, and build` job in 44 seconds. The PR remains unmerged
  and nothing was deployed.

## Deferred findings (not silently dropped)

- Derive reviewed lesson/worked-example projections from ContentDocument.
- Add anonymous endpoint abuse controls and the full production header policy.
- Add exact rational answer submission and formative feedback without claiming
  mastery from preview activity.
- Reconcile the source solution-step text bounds with the combined
  `AnswerKeyWebWorksheet` solution-string bound; the current final validator
  correctly fails closed when projection expansion exceeds the target DTO.
- Decide licenses, trusted curriculum publication, Cloudflare project/DNS, and
  production deployment with owner authority.
