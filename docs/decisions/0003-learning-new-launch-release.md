# ADR-0003: Authorize the minimal learning.new launch release

- Status: Accepted
- Date: 2026-08-22
- Decision authority: Repository owner

## Context

The `.new` action domain must enter a useful creation flow, but the repository
also contains draft and prototype surfaces that have not been approved for
publication. Author-controlled Markdown metadata cannot safely distinguish a
reviewed launch revision from an accidental build input. A public `GET` must
also remain side-effect free because crawlers, previews, and prefetchers can
issue it.

The owner approved one English unlike-denominator lesson, an anonymous and
unsaved V1 preview, Apache-2.0 for software, CC BY 4.0 for the approved lesson
and project documentation, and autonomous preview deployment. Production DNS
and custom-domain attachment remain a separate owner-controlled decision.

## Decision

### Trusted publication authority

The launch content stays `draft` in authoring Markdown and compiled Content
AST. A server-only release manifest is the sole publication authority. It
pins the owner approval, exact content/source hashes, license and attribution,
planner policy, skill graph, generator, and reviewed registry.

The application validates and detaches that manifest at construction. For each
preview it verifies the exact content and runtime registry, materializes the
draft worksheet, verifies its canonical envelope and provenance, changes only
the approved attribution status to `published`, validates again, and computes
a new worksheet instance hash. Missing, disabled, malformed, or drifted
authority fails closed.

Planner policy `day-one-fraction-preview@4` selects content revision 3. Policy
2 and content revision 1 remain historical V1 draft identities. Policy 3 and
content revision 2 remain assigned to the unapproved V2 presentation prototype.
None of those identities is reinterpreted as the public V1 release.

### Public primary surface

The production build publishes only:

- `GET`/`HEAD /new`;
- `POST /api/plans/preview`;
- `GET`/`HEAD /api/health`;
- `GET`/`HEAD for exact hashed build assets;
- a temporary side-effect-free `GET`/`HEAD /` redirect to `/new`.

Static Assets always invoke the Worker first. Asset miss fallback is disabled.
All other paths and methods return sanitized `404` or `405` responses, so the
old lesson, fixed sample, answer key, and other prototype routes cannot become
public through SPA fallback.

The anonymous POST requires Cloudflare's rate-limit binding. The initial limit
is 120 requests per 60 seconds for the anonymous preview class in each
Cloudflare location. The binding is deliberately mandatory: absent or invalid
rate-limit state produces a sanitized `500` instead of silently disabling
abuse protection.

### Action-domain surface

`learning.new` is a separate Worker with no resource binding. `GET` and `HEAD`
on `/` return `302` to exactly `https://exercisebook.app/new`. Every query and
incoming cookie is dropped. Other methods return `405`, other paths return
`404`, and no body is consumed for redirect creation.

### Deployment boundary

Both Workers may be built, tested, and deployed to `workers.dev` preview URLs.
Neither configuration contains a production route or custom domain. Attaching
`exercisebook.app` or `learning.new`, or changing production DNS, requires a
separate final owner GO.

## Invariants

- A `GET` never creates a plan, worksheet, learner record, cookie, or durable
  object.
- Only the exact approved content hash can acquire a public attribution state.
- The learner-facing instance hash commits the published attribution.
- Public DTOs and client assets contain no release authority, draft license,
  answer projection, seed, or prototype route.
- Retrying the same explicit request and reviewed versions reconstructs the
  same plan and worksheet.
- Browser printing uses the already loaded authorized instance.

## Failure modes and recovery

- Manifest/content/runtime drift: fail the preview before public projection;
  disable the release or redeploy the prior version.
- Rate-limit binding missing or failing: return a sanitized `500`; repair the
  binding rather than bypass it.
- Asset mismatch: return `404`; rebuild and review the exact artifact list.
- Primary preview defect: roll back to the prior Worker version while leaving
  production DNS untouched.
- Action redirect defect: roll back to the known-good static redirect Worker.
- Content defect: disable the active manifest/content revision for new
  previews; preserve historical hashes and publish a new content revision.

## Consequences

The launch is intentionally narrower than the local prototype and every asset
request incurs Worker execution before static delivery. That adds small cost
and latency, but makes the public allowlist enforceable and auditable for the
deadline release. The trusted manifest introduces a second publication step,
but prevents author files, stale registries, or build discovery from granting
themselves public authority.
