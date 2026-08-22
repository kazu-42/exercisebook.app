# Learning New Launch v1 tasks

Source: [Learning New Launch v1](learning-new-launch-v1.md)

## Dependency graph

```text
LNV1-001 spec and release base
  -> LNV1-002 trusted publication
  -> LNV1-003 public application boundary
       -> LNV1-005 primary preview deployment
LNV1-001
  -> LNV1-004 action-domain redirect
       -> LNV1-006 complete-flow preview acceptance
LNV1-002 + LNV1-003 + LNV1-004
  -> LNV1-007 CI, monitoring, rollback, and final evidence
```

Production custom-domain/DNS promotion is intentionally excluded and requires a
separate owner GO.

### LNV1-001 Build the isolated minimum release base

- **Type**: release / refactor / docs
- **Size**: M
- **Dependencies**: none
- **Scope**:
  - use a fresh branch from `origin/main`;
  - integrate only the Phase 1 walking skeleton, V1 daily preview, and student
    delivery hardening checkpoints;
  - record the approved launch intent and non-goals;
  - exclude the content-derived V2, PrintDocument V2, prepared-answer, and V2
    printable stacks.
- **Acceptance**:
  - exact commit provenance is documented;
  - the minimum baseline passes its original full gate;
  - the original V2 worktree and branches remain unchanged.

### LNV1-002 Authorize one public lesson through a trusted manifest

- **Type**: feature / security / licensing
- **Size**: M
- **Dependencies**: LNV1-001
- **TDD order**:
  1. reject no manifest;
  2. reject draft or wrong license;
  3. reject wrong content/revision/hash/version;
  4. reject disabled or unknown release;
  5. accept the exact detached owner-approved release;
  6. prove public output contains CC BY 4.0 attribution but no authority fields.
- **Acceptance**:
  - Apache-2.0 and CC BY 4.0 license files are present;
  - author content remains unable to self-publish;
  - only the exact release manifest authorizes preview materialization;
  - browser/import-boundary gates protect the manifest.

### LNV1-003 Enforce the production application surface

- **Type**: feature / security / frontend / backend
- **Size**: L
- **Dependencies**: LNV1-002
- **TDD order**:
  1. deny prototype application and API routes;
  2. allow only `/new`, `/api/plans/preview`, `/api/health`, and reviewed assets;
  3. redirect `/` to `/new`;
  4. enforce methods, media type, body limits, and response limits;
  5. add complete security headers and sanitized errors;
  6. add fail-closed anonymous rate limiting;
  7. verify accessibility, races, browser print, and emitted-client privacy.
- **Acceptance**:
  - unapproved routes cannot use SPA fallback;
  - a normal learner can complete the creation flow with keyboard and mobile;
  - expected failures do not leak or log learner material;
  - all repository gates pass.

### LNV1-004 Implement the independent action-domain Worker

- **Type**: feature / infra / security
- **Size**: M
- **Dependencies**: LNV1-001
- **TDD order**:
  1. GET exact redirect;
  2. HEAD exact redirect without body;
  3. drop unknown, duplicate, encoded, and sensitive query data;
  4. reject non-GET/HEAD methods;
  5. reject noncanonical host/path ambiguity;
  6. prove no state binding, cookie, cacheable redirect, or open redirect.
- **Acceptance**:
  - the Worker is independently deployable;
  - it owns no learner/application bindings;
  - its known-good rollback behavior is identical to the safe ADR fallback.

### LNV1-005 Prepare the primary Cloudflare preview deployment

- **Type**: infra / CI
- **Size**: M
- **Dependencies**: LNV1-003
- **Scope**:
  - reviewed preview configuration and scoped credential contract;
  - exact-SHA build/deploy/smoke scripts;
  - no custom route or production DNS declaration;
  - capture Worker version and rollback identity.
- **Acceptance**:
  - a non-production preview URL serves the reviewed build;
  - `/new`, health, POST, headers, rate limiting, and denied routes pass smoke;
  - rollback is rehearsed and read back.

### LNV1-006 Prepare the action-domain preview deployment

- **Type**: infra / test
- **Size**: S
- **Dependencies**: LNV1-004, LNV1-005
- **Scope**:
  - deploy the redirect Worker without a custom domain;
  - test redirect behavior through its preview URL using an explicit Host-safe
    test seam rather than mutating DNS;
  - verify the complete redirected primary flow synthetically.
- **Acceptance**:
  - no production DNS/custom domain changed;
  - preview redirect and primary creation flow are green;
  - the deployed source and version identities are captured.

### LNV1-007 Seal release evidence and stop at the DNS gate

- **Type**: QA / operations / docs
- **Size**: M
- **Dependencies**: LNV1-002, LNV1-003, LNV1-004, LNV1-005, LNV1-006
- **Scope**:
  - full repository gates and exact-head CI;
  - production-bundle browser and accessibility smoke;
  - synthetic monitor definition and alert path;
  - rollback runbook and rehearsal evidence;
  - registrar lock/renewal/MFA/DNSSEC readiness readback;
  - final GO/STOP report with exact Worker, Git, and preview identities.
- **Acceptance**:
  - every non-DNS acceptance criterion in the launch spec is green;
  - the worktree, branch, PR, CI, preview deployments, and docs agree;
  - `exercisebook.app` and `learning.new` remain non-resolving;
  - the next operation is clearly identified as the owner-controlled production
    custom-domain/DNS promotion.

