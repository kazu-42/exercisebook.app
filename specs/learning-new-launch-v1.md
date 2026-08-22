# Learning New Launch v1

Status: approved intent, implementation pending

Decision date: 2026-08-22 JST

Decision authority: repository owner

## Purpose

Launch the smallest real Exercise Book creation flow that makes
`https://learning.new` policy-compliant and useful before the `.new` action
domain deadline. A learner enters the action domain, arrives directly at the
primary-origin creation UI, explicitly requests a bounded practice set, and
receives one concrete reproducible worksheet preview.

This is a public product slice, not a placeholder, marketing page, saved
assignment, mastery system, or broad curriculum release.

## Approved product intent

- one reviewed English lesson: adding fractions with unlike denominators;
- anonymous access without an account, cookie, learner history, or browser
  storage;
- an explicitly unsaved V1 daily-plan preview;
- reviewed 8-, 12-, and 20-minute practice budgets;
- deterministic student Web output and browser printing of the already loaded
  instance;
- Apache-2.0 for project software;
- CC BY 4.0 for original learning content and project documentation;
- no unapproved prototype routes in the public release;
- autonomous implementation and preview deployment up to, but not including,
  production DNS/custom-domain promotion.

## Public surface

The primary application release permits only:

- `GET` and `HEAD /new`;
- `POST /api/plans/preview`;
- `GET` and `HEAD /api/health`;
- the exact regular static assets emitted by the reviewed production build.

`GET /` temporarily redirects to `/new`. Every other application or API route
fails closed with `404` or `405`; it must not fall through to an unapproved SPA
page. In particular, the launch excludes standalone lesson, fixed sample,
answer-key, authoring, catalog, V2 prototype, and arbitrary asset paths.

The action-domain release permits only:

- `GET` and `HEAD` on `learning.new`, returning a temporary redirect to the
  exact URL `https://exercisebook.app/new`;
- an empty redirect query allowlist: every incoming query parameter is dropped;
- no cookies, OAuth callbacks, APIs, learner state, storage binding, or indexed
  content;
- all other methods return `405` without redirecting or consuming a body.

## Creation request

The public creation request is the existing V1 contract:

- schema: `exercisebook.daily-plan-preview-request/v1`;
- goal: `math.fractions.add-unlike`;
- practice minutes: `8 | 12 | 20`;
- explicit local study date, IANA time zone, and locale `en`;
- JSON request body no larger than 4,096 delivered bytes;
- explicit primary-origin `POST`; navigation and prefetch `GET` requests never
  create or materialize a preview.

The request produces no durable state. Retrying identical explicit inputs and
reviewed versions reconstructs the same decision and worksheet instance.

## Creation response

The successful public response:

- validates against the V1 public response contract;
- is no larger than the route's reviewed response-byte limit;
- carries `saved: false` and makes no adaptive or mastery claim;
- contains a concrete bounded student worksheet and learner-readable selection
  rationale;
- includes only owner-approved attribution and CC BY 4.0 license metadata;
- contains no canonical answers, scoring rules, solution traces, base seeds,
  slot seeds, answer-key sentinels, or server-only release authority;
- is generated only from the exact content, planner, generator, RNG, and policy
  revisions authorized by the launch release manifest.

An unavailable reviewed revision returns a typed sanitized `503`. Invalid
input returns a bounded `4xx`. Unexpected defects are reported through the
configured aggregate observability boundary and return a sanitized `500`.

## Trusted release manifest

Author Markdown and compiled Content AST remain draft authoring artifacts. They
cannot publish themselves.

One trusted server-only launch manifest authorizes the release. It pins at
least:

- manifest schema and release ID;
- exact content schema, document ID, revision, source hash, and compiled
  canonical hash;
- exact license ID and attribution text;
- exact skill, selected goal, planner policy, graph, generator, RNG, and
  student-projector revisions;
- enabled state and a human approval record sourced from the 2026-08-22 owner
  decision.

The application validates and detaches the manifest during service
construction. Missing, unknown, disabled, malformed, draft-licensed,
hash-mismatched, or version-mismatched authority fails closed before generation
or public serialization. Browser code and public DTOs cannot import or expose
the manifest.

## Security and privacy

- Use a complete reviewed production header policy for HTML, API, redirects,
  and errors.
- The primary anonymous POST is rate-limited at the Cloudflare boundary and
  returns a deterministic sanitized `429` when denied.
- No learner input or raw network identifier is written to application logs.
- Request bodies, response bodies, stack traces, seeds, answers, tokens, and
  full URLs are never sent to observability.
- All early failures cancel or drain bounded request/response streams without
  replacing the primary error.
- Static output is self-contained under the reviewed build provenance gate; no
  third-party behavior tracker, advertising script, or external learner asset
  is permitted.
- The redirect Worker has no state bindings and drops all query data.

The initial rate limit is a technical rollout value, not a learning contract.
It may be tuned from aggregate denial/error measurements without changing the
public worksheet contract, provided unknown configuration fails closed.

## Accessibility and presentation

- `/new` remains keyboard operable with visible focus, labeled controls,
  loading state, sanitized error state, and an announced successful result.
- The page explicitly says the preview is unsaved and not based on history or
  mastery.
- The selected practice budget never exceeds the reviewed item/time caps.
- Student Web and browser-print views project the same authorized instance.
- The launch does not claim a final product visual direction, full WCAG 2.2 AA
  audit, tagged-PDF accessibility, or localization.

## Deployment and rollback

Two independently deployable Cloudflare Workers are required:

1. `exercisebook-app`: primary application, API, and reviewed static assets;
2. `learning-new-redirect`: state-free action-domain redirect.

Before production DNS promotion:

- an exact source SHA passes format, TypeScript 7, schemas, content, dependency
  boundaries, tests, production build, sample replay, and browser smoke;
- both Workers are deployed to non-production preview URLs;
- the primary creation flow and action redirect are smoke-tested from those
  URLs;
- a documented prior-version rollback is rehearsed;
- an external synthetic check is ready for redirect, page, health, and one
  bounded POST scenario;
- no custom domain or production DNS record is created or modified.

Promotion order after a separate owner GO is:

1. attach and accept `exercisebook.app`;
2. observe the primary flow while `learning.new` remains non-resolving;
3. attach `learning.new` only after the primary origin is green;
4. read back DNS, TLS, redirects, creation, monitoring, and rollback identity.

Application rollback selects a known-good Worker version. Action-domain
rollback selects the known-good static side-effect-free temporary redirect to
`https://exercisebook.app/new`; it never redirects to a homepage or regenerates
different questions.

## Explicit non-goals

- accounts, authentication, learner IDs, persistent assignments, learning
  history, attempts, evidence, or mastery;
- D1, R2, Queues, Durable Objects, Workflows, hosted PDF, or Browser Rendering;
- answer submission, scoring feedback, hints, or retry evidence;
- additional lessons, subjects, locales, Japanese UI, or a public catalog;
- standalone lesson, sample answer key, V2 React/PrintDocument publication, or
  final visual design;
- marketing homepage, indexed action-domain content, behavioral analytics,
  advertising, third-party trackers, or live LLM generation;
- production custom-domain/DNS mutation before a separate final owner GO.

## Acceptance criteria

- [ ] The exact public route/method matrix is enforced at the Worker boundary.
- [ ] `GET`/`HEAD learning.new` returns a non-cacheable temporary redirect to
      exactly `https://exercisebook.app/new` with no forwarded query or cookie.
- [ ] `GET`/`HEAD /new` returns the reviewed creation UI and creates no state.
- [ ] One explicit V1 POST produces a concrete deterministic unsaved worksheet.
- [ ] Only the exact owner-approved release manifest can authorize generation.
- [ ] Draft, disabled, missing, mismatched, or unknown release data fails closed.
- [ ] Student DTO, DOM, metadata, URLs, and browser artifacts contain no answer
      authority or seed material.
- [ ] Rate limiting, security headers, sanitized errors, and aggregate
      observability are verified without logging learner content.
- [ ] Keyboard, accessibility, mobile, print, timeout, cancellation, and request
      race tests pass.
- [ ] Production build provenance and emitted-artifact gates pass.
- [ ] Preview deployments, synthetic checks, and a rollback rehearsal are green.
- [ ] `exercisebook.app` and `learning.new` remain DNS-unmodified until the
      owner gives a separate final promotion GO.

