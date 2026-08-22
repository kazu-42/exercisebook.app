# Daily Plan Preview v1

Status: implementation specification
Updated: 2026-07-19

## 1. Purpose

Make the existing `/new` route perform one honest, useful piece of the Exercise
Book product promise:

> An anonymous learner chooses the reviewed fraction-addition goal and a bounded
> practice-time budget, then receives an explainable, deterministic worksheet
> that can be printed without creating a different set.

This is a **cold-start preview**, not a saved assignment and not an adaptive
mastery decision. It uses no learner evidence. It exists to validate the daily
set interaction before accounts, persistence, or a larger curriculum are built.

## 2. Scope

### Included

- one goal: `math.fractions.add-unlike`;
- practice budgets of 8, 12, or 20 minutes;
- explicit local study date, IANA time zone, and `en` locale;
- a versioned, deterministic, rule-based preview policy;
- a hard practice-time and reviewed-content cap;
- learner-readable selection rationale;
- materialization through reviewed `fractions.add@1` content and generator;
- a strict `POST /api/plans/preview` request and student-only response;
- an accessible `/new` form with loading, success, and recoverable error states;
- in-page printing of the already loaded student worksheet;
- deterministic, property, API, privacy, accessibility, and browser tests.

### Explicitly excluded

- accounts, cookies, local storage, D1, R2, Durable Objects, and Queues;
- durable assignments, attempt events, answer submission, or scoring;
- answer keys from the preview endpoint;
- mastery, readiness, diagnostic, due-review, or prerequisite-repair claims;
- free-form goals or other subjects/skills;
- live LLM generation or a fallback problem bank;
- hosted PDF generation;
- publication of draft curriculum;
- production deployment, DNS, or `learning.new` changes.

## 3. Vocabulary

- **Requested practice minutes**: the learner's hard upper bound for generated
  practice problems. It does not include reading the lesson or worked example.
- **Planned practice minutes**: the sum of `expectedMinutes` on materialized
  worksheet slots. It must not exceed the request.
- **Preview decision**: the internal canonical planner result, including the
  generator choice and public deterministic seed required for replay.
- **Preview response**: the public student-safe DTO. It never contains a base
  seed, slot seed, answer, scoring rule, misconception, hint, or solution trace.
- **Stable prefix**: for the same goal/date/time zone/locale and version set, a
  shorter budget's problems are the prefix of a longer budget's problems.

The 20-minute option initially produces 8 reviewed problems (16 planned
minutes), because the current content directive reviews at most 8 items. The
policy may leave budget unused; it may never exceed reviewed content or pad the
set with unreviewed generation.

## 4. Versioned identifiers

| Concern | Identifier |
| --- | --- |
| request schema | `exercisebook.daily-plan-preview-request/v1` |
| internal plan schema | `exercisebook.daily-plan-preview/v1` |
| public response schema | `exercisebook.daily-plan-preview-response/v1` |
| planner policy | `day-one-fraction-preview@4` |
| skill graph | `phase-1-math@1` |
| evidence snapshot | `none@1` |
| seed derivation | `exercisebook/public-plan-preview-seed/v1` |
| public seed version | `public-preview-v1` |
| generator | `fractions.add@1` |
| content | `math.fractions.add-unlike-denominators@3` |

A change that can alter item selection, order, seed derivation, time accounting,
or rationale requires the corresponding version to change. Historical fixed
vectors remain tied to their original versions.

`day-one-fraction-preview@1` was retired for new previews during pre-release
review after a generated practice answer could equal a rational exposed by the
application-owned worked example. A broad 365-day semantic scan then confirmed
that the example's visible operands (`1/2` and `1/3`) must be reserved along
with its result (`5/6`), not merely protected by field-name scanning. Version 2
makes the complete ordered tuple an explicit planner input instead of an
unversioned service constant. This correction was made before policy-v2 release
and fixed-vector lock. Version 1 remains a distinct historical contract; its
vectors must not be silently reinterpreted as version 2 output.

Version 4 is the public-launch successor. It preserves the reviewed budget,
selection, worked-example reservation, and generator behavior of version 2,
but selects the separately licensed content revision 3 authorized by the
server-only `learning-new-launch-2026-08-22` manifest. Policy 2 and content
revision 1 remain historical draft identities. Policy 3 and content revision 2
belong to the unapproved V2 presentation prototype. The launch does not
reinterpret any of those fixed identities as published V1 output.

## 5. Request contract

The endpoint accepts JSON only:

```ts
type DailyPlanPreviewRequestV1 = Readonly<{
  schema: "exercisebook.daily-plan-preview-request/v1";
  goalId: "math.fractions.add-unlike";
  practiceMinutes: 8 | 12 | 20;
  localStudyDate: string; // real YYYY-MM-DD date
  timeZone: string; // valid IANA identifier
  locale: "en";
}>;
```

Validation is strict and fail-closed:

- no coercion of strings to numbers;
- no unknown, duplicate, accessor, symbol, prototype-sensitive, sparse-array,
  cyclic, invalid-Unicode, or over-budget object graph shapes;
- no caller-selected seed, learner ID, name, answer, accommodation, token,
  deadline, or free-form text;
- unsupported goals, budgets, locale, dates, or time zones return a sanitized
  `400 invalid_request` response;
- non-JSON media types return `415 unsupported_media_type`;
- empty, malformed, or oversized JSON returns a sanitized 4xx response;
- errors never echo the request body.

The request body limit is 4 KiB in UTF-8 bytes. A declared larger
`Content-Length` is rejected before parsing; the measured body is checked even
when the header is absent or false.

## 6. Registry and availability input

The pure planner receives an explicit, version-pinned registry. It must not
look up an ambient `latest` version.

The registry records the exact policy, skill graph, content, and generator
revisions plus enabled/disabled status. If any required revision is unknown or
disabled, the planner returns a typed `unavailable` result and selects nothing.
This is the Phase 1.5 kill switch. It affects new previews only and never
rewrites historical instances.

## 7. Internal preview decision

The ready decision contains at least:

```ts
type DailyPlanPreviewV1 = Readonly<{
  schema: "exercisebook.daily-plan-preview/v1";
  id: string; // preview-<full-request identity SHA-256>
  goalId: "math.fractions.add-unlike";
  localStudyDate: string;
  timeZone: string;
  locale: "en";
  requestedPracticeMinutes: 8 | 12 | 20;
  plannedPracticeMinutes: 8 | 12 | 16;
  evidence: { kind: "none"; version: 1 };
  policy: { id: "day-one-fraction-preview"; version: 4 };
  skillGraph: { id: "phase-1-math"; revision: 1 };
  activities: readonly [
    {
      id: "current-frontier-practice";
      kind: "practice";
      skillId: "math.fractions.add-unlike";
      contentId: "math.fractions.add-unlike-denominators";
      contentRevision: 3;
      generatorId: "fractions.add";
      generatorVersion: "1";
      itemCount: 4 | 6 | 8;
      expectedMinutes: 8 | 12 | 16;
      selectionReasons: readonly ["current-frontier"];
      selectionExplanation: string;
      excludedCanonicalAnswers: readonly [
        { numerator: "1"; denominator: "2" },
        { numerator: "1"; denominator: "3" },
        { numerator: "5"; denominator: "6" },
      ];
    },
  ];
  generation: {
    baseSeed: string; // internal 64-character lowercase hex
    seedVersion: "public-preview-v1";
  };
}>;
```

An unavailable result has a stable code (`goal-unavailable`) and contains no
activity or generation seed.

The pure planner owns selection and rationale. The fraction generator receives
the plan, policy, graph, item count, and reason metadata as explicit validated
inputs; it must not invent planner provenance.

## 8. Deterministic identity and stable prefix

Two canonical hashes are derived with RFC 8785 canonical JSON and SHA-256.

### Sequence seed

```text
SHA-256(canonical-json({
  domain: "exercisebook/public-plan-preview-seed/v1",
  goalId,
  localStudyDate,
  timeZone,
  locale,
  policy,
  skillGraph,
  evidence,
  contentRevision,
  generatorVersion
}))
```

The requested budget and item count are intentionally absent so 8-, 12-, and
20-minute sets share a problem sequence prefix.

### Request identity

The preview ID uses a second hash over the complete validated request plus the
same version set, including the budget. The materializer carries that value in
its current `assignmentId` compatibility field, but the unsaved preview does
not become a durable assignment. Different budgets therefore have different
identities even though their problem sequence is a stable prefix.

No planner or generator behavior may depend on the server wall clock,
`Math.random()`, process environment locale/time zone, property insertion
order, or mutable global state.

## 9. Selection policy

The `day-one-fraction-preview@4` policy maps budget to the reviewed two-minute
slot model:

| Requested | Item count | Planned |
| ---: | ---: | ---: |
| 8 | 4 | 8 |
| 12 | 6 | 12 |
| 20 | 8 | 16 |

For every ready decision:

```text
sum(activity.expectedMinutes) == plannedPracticeMinutes
sum(materialized slot.expectedMinutes) == plannedPracticeMinutes
plannedPracticeMinutes <= requestedPracticeMinutes
itemCount <= policy cap
itemCount <= reviewed content directive count
```

The only allowed reason is `current-frontier`: the chosen exercise directly
practices the learner-selected goal. With no evidence, `due-review`,
`prerequisite-repair`, and `transfer` are forbidden.

The policy owns all reduced rational values structurally exposed by the
reviewed worked example as the activity's ordered `excludedCanonicalAnswers`
tuple: `[1/2, 1/3, 5/6]`. The example's `left`, `right`, and `result` values are
derived respectively from those same three policy-owned entries, so example
content and materialization exclusions cannot drift apart. The generator
validates that explicit input and, when a candidate answer matches any reserved
value, advances the same slot's deterministic retry sequence until it finds a
permitted problem. The selected attempt and duplicate-retry provenance remain
in the canonical worksheet instance. The service and projector must not add
hidden answer exclusions: changing the reserved tuple changes selection and
example behavior and therefore requires a policy version change after the
pre-release policy-v2 fixed-vector lock.

The reservation tuple is internal planner/materializer provenance and must not
appear in the student response. If the bounded deterministic retry sequence
cannot produce the requested eligible items, materialization fails closed; it
must not drop a slot, exceed the budget, or switch to an unreviewed generator.

Learner-facing explanation:

> This focused set practices the fraction goal you selected. It is a preview
> based on your goal and time limit, not a saved or mastery-based plan.

## 10. Materialization boundary

The Web application service composes, in order:

1. strict request validation;
2. pure planner decision with the explicit registry;
3. reviewed ContentDocument resolution;
4. fraction generator materialization with explicit planner provenance;
5. integrity-checked student projection;
6. trusted publication authorization and a re-sealed published instance;
7. strict public response validation.

The planner does not import Hono, React, Cloudflare, renderers, or storage. The
generator does not choose learning activities. The renderer does not regenerate
questions.

For a ready decision, all of these must agree:

- plan ID, policy version, and skill-graph revision;
- item and slot counts;
- planned and worksheet minutes;
- goal skill and every slot's skill;
- `current-frontier` selection reason;
- preview ID, worksheet `assignmentId`, and instance hash.

A mismatch is an internal failure; it must fail closed rather than repair or
regenerate the worksheet silently.

The final Web projection is a second, independent semantic leak boundary. It
compares every structured rational exposed by the worked example—left operand,
right operand, and result—with every generated canonical practice answer, then
scans every recognized answer-bearing string in the final worked-example
object. Any collision fails closed before a student DTO is returned; projection
must not retry generation, redact text, or substitute a different instance.

The remaining student DTO scan is deliberately field-sensitive:

- global worksheet fields are checked against every canonical practice answer;
- every non-prompt field of every item, including `printFallback` and response
  labels, is checked against every canonical practice answer;
- structured prompt operands may legitimately equal another slot's answer, so
  prompt `accessibleText` is derived from the validated operands rather than
  copied from upstream text, and each complete prompt is checked against only
  its own slot's canonical answer.

The regression contract uses a hash-correct two-slot instance: a rational that
is the second slot's answer is allowed as the first slot's structured operand,
but the same rational injected into the first slot's `printFallback` is rejected
after the instance is re-canonicalized and its hash recomputed. Instance
integrity cannot replace final student-visibility validation.

## 11. Public response contract

The `200` response is a strict object:

```ts
type DailyPlanPreviewResponseV1 = Readonly<{
  schema: "exercisebook.daily-plan-preview-response/v1";
  plan: {
    id: string;
    goalId: "math.fractions.add-unlike";
    requestedPracticeMinutes: 8 | 12 | 20;
    plannedPracticeMinutes: 8 | 12 | 16;
    itemCount: 4 | 6 | 8;
    policy: { id: "day-one-fraction-preview"; version: 4 };
    skillGraph: { id: "phase-1-math"; revision: 1 };
    evidenceKind: "none";
    selectionReasons: readonly ["current-frontier"];
    selectionExplanation: string;
    saved: false;
  };
  worksheet: StudentWebWorksheet;
}>;
```

The public response and all rendered/accessible/serialized student output must
exclude, at every depth:

- `answer`, `canonicalAnswer`, `accepted`, or `scoringRule`;
- hints, misconceptions, or solution traces;
- `baseSeed`, `slotSeed`, or seed-secret material;
- answer-key fields or hidden answer-bearing markup.

The endpoint returns `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff`, and JSON content type. It sets no cookie and
performs no storage write.

## 12. UI behavior

The `/new` page:

- labels the budget **Practice time**;
- says the preview is not saved and does not use learning-history evidence;
- sends the explicit date/time zone/locale in the body, never in the URL;
- disables duplicate submission while the current request is active;
- announces loading, success, and errors to assistive technology;
- cancels or ignores a stale request so an older response cannot overwrite a
  newer choice;
- preserves form values after a recoverable failure;
- renders requested time, planned time, problem count, and the selection
  explanation before the worksheet;
- prints the currently loaded worksheet through `window.print()`; the print
  action performs no second generation request;
- provides a direct lesson-review link;
- never presents the preview as adaptive, diagnostic, or mastery-based.

No preview data is written to cookies, localStorage, sessionStorage,
IndexedDB, Cache Storage, or a service worker.

## 13. Failure behavior

| Condition | HTTP/UI behavior |
| --- | --- |
| malformed/unknown/unsupported request | `400 invalid_request` |
| unsupported media type | `415 unsupported_media_type` |
| body over 4 KiB | `413 request_too_large` |
| required revision disabled/unavailable | `503 preview_unavailable` |
| generator or invariant failure | sanitized `500 internal_error` |
| offline/timeout/invalid response in browser | recoverable `role=alert` state |

Every error response uses `Cache-Control: no-store` and `nosniff`, and never
echoes request data or internal exception text.

The browser loader's bounded timeout covers both the request and post-header
response-body read. If the caller cancels while `response.json()` is pending,
the loader rejects with the caller's original abort reason; if the timeout wins
during that read, it rejects with the dedicated timeout error. Neither abort is
relabelled as an invalid response, and the timer and caller listener are always
removed when the request settles.

## 14. Acceptance criteria

### Planner and generator

- [x] Strict validators reject coercion, unknown keys, invalid dates/time
      zones/locales, unsupported budgets, and hostile object graphs.
- [x] 8/12/20-minute requests produce 4/6/8 items and 8/12/16 planned minutes.
- [x] Property tests prove both budget and reviewed-content caps.
- [x] Same complete inputs produce byte-identical canonical decisions and
      worksheet instances across repeated runs and object insertion orders.
- [x] 8-minute prompts equal the first four prompts of 12- and 20-minute sets;
      the first six 12-minute prompts equal the 20-minute prefix.
- [x] Wall clock, environment time zone/locale, and `Math.random()` do not
      affect output.
- [x] Disabling the policy, graph, content, or generator gives a typed
      unavailable result with no selected activity.
- [x] The generator receives rather than invents plan/policy/graph/reason data.
- [x] Policy v4 preserves policy v2's exact `[1/2, 1/3, 5/6]` plan-activity
      reviewed-example reservation; the example derives left/right/result from
      that tuple, and matching candidates retry deterministically with recorded
      provenance without changing shorter-budget prefixes.
- [x] Existing Phase 1 fixed vectors remain reproducible.

### API and privacy

- [x] Real planner -> content -> generator -> student projection integration
      passes through the Hono route.
- [x] Content type, body size, strict body shape, status, cache, and `nosniff`
      behavior are tested for success and every error family.
- [x] Repeated requests perform no durable or client-side writes.
- [x] The response contains no protected answer or seed data at any depth.
- [x] The final projector rejects any generated practice answer exposed by the
      worked example's structured left operand, right operand, result, or
      recognized visible strings; its hash-correct cross-slot regression allows
      legitimate prompt operands while rejecting the same value in another
      item's `printFallback`.
- [x] Displayed count/minutes/reasons and WorksheetInstance provenance agree.
- [x] Malformed service output fails closed with a sanitized `500`.

### UI and print

- [x] Keyboard-only form -> preview -> print flow works.
- [x] Initial, loading, success, validation, network, invalid-response, and
      stale-response states have component tests, including caller-abort and
      timeout identity while a successful response body is still pending.
- [x] Automated accessibility checks cover `/new` initial, success, and error
      states with no serious violations.
- [x] The print action uses the loaded instance and does not fetch again.
- [x] Student DOM and print DOM contain no protected answer or seed data.
- [x] Production-bundle browser smoke passes at desktop and 390 px with no
      console errors, failed first-party requests, third-party requests,
      cookies, or Web Storage writes.
- [x] Full `pnpm check` and dependency audit pass.

## 15. Rollback

- Disable `day-one-fraction-preview@4` for new previews or revert the feature
  commit.
- Keep `/worksheet/sample` as the fixed Phase 1 fallback.
- Do not mutate or reinterpret previously materialized instances.
- A UI/API failure never triggers different questions as a fallback.

## 16. Follow-on slices

After this slice is verified:

1. content-derived lesson and worked-example projection across Web and print,
   replacing the application-owned reviewed example while retaining the
   fail-closed collision scan; before any hosted student PDF, give the
   PrintDocument projector the same field-sensitive cross-slot answer boundary
   now enforced by the Web projector; a changed reviewed result must remain
   explicit versioned selection input rather than ambient projector behavior;
2. exact rational answer submission and formative feedback, with first attempt,
   retry, and hint use distinguished but no mastery claim;
3. a reviewed three-skill fraction path and an explicitly versioned union for
   additional problem types;
4. a local next-day rule-based planner once real evidence exists;
5. trusted public catalog and persistence only after licensing and production
   authority are resolved.

Before production exposure, harden the browser response boundary with a
bounded, duplicate-key-aware JSON decoder rather than relying on
`Response.json()`, and add endpoint rate limiting plus the full reviewed
security-header policy. The deterministic sequence is public replay
provenance, not cryptographic answer secrecy; answer submission must use an
authorized server-side contract and preview attempts must remain non-mastery
evidence.
