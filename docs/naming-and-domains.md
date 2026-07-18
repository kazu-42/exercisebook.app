# Naming and domains

Decision date: 2026-07-19 JST

## Final decision

The public name is **Exercise Book**.

| Purpose | Value |
|---|---|
| Product name | `Exercise Book` |
| Primary domain | `exercisebook.app` |
| Action domain | `learning.new` |
| GitHub repository | `kazu-42/exercisebook.app` |
| Internal package/repository slug | `exercisebook` |
| Working tagline | `A new exercise book, every day.` |

“Exercise book” is an established English compound noun, not a coined word. It
connects the initial product—daily generated practice and printable material—to
the Web application without constraining the system to one subject.

The tradeoff is that the term is school-oriented and is more common in British
English than American English. It may also be understood as a blank notebook.
The product description and tagline should therefore consistently show that
the book is generated, interactive, and personalized.

## Domain roles

### `exercisebook.app`

This is the canonical origin for:

- public explanations and exercises;
- the learner application;
- printable exercise books and answer keys;
- authoring and review tools;
- public curriculum and skill-graph documentation;
- API endpoints.

The `.app` namespace requires HTTPS in browsers. Cloudflare-managed TLS satisfies
that transport requirement, but deployment must not publish an HTTP-only
origin.

### `learning.new`

This is not a second brand or a homepage.

Google Registry's [`.new` registration
policy](https://www.registry.google/policies/registration/new/) requires a
`.new` domain to resolve to an action-generation or online-creation flow. The
intended behavior is:

```text
learning.new
  -> https://exercisebook.app/new
  -> create a new daily exercise book
```

The following are invariants:

- do not redirect `learning.new` to `/` or a marketing page;
- do not put a homepage or “Start creating” interstitial in front of the
  creation UI;
- if authentication or essential setup is required, preserve the creation
  intent and resume directly into the same action;
- do not use the domain for search results, a content catalog, or a generic
  dashboard;
- test signed-in, signed-out, expired-session, and first-time-user paths after
  every authentication change.

The creation UI may ask only for information necessary to complete the action,
such as a goal or available study time, and may require an explicit submit so a
prefetched `GET` cannot create durable state. That submission should create or
materialize a new exercise-book draft rather than merely explain how to do so.

The policy waives enforcement for 100 days after registration only while the
domain does not resolve. Based on the registration event below, the 100-day
point is `2026-10-26T21:48:39.928Z` (`2026-10-27T06:48:39.928+09:00`). Do not
point `learning.new` at a placeholder, parked page, or ordinary homepage during
implementation. Keep it non-resolving until the compliant creation route and
its authentication continuation have been tested.

## Registry readback

Google Registry's official RDAP service was queried after purchase.

| Domain | HTTP | RDAP result | Registration event |
|---|---:|---|---|
| `exercisebook.app` | 200 | `exercisebook.app` | `2026-07-18T21:49:16.815Z` |
| `learning.new` | 200 | `learning.new` | `2026-07-18T21:48:39.928Z` |

The UTC registration timestamps correspond to the 2026-07-19 purchase in JST.

At the initial readback, both registered domains were delegated to
`anna.ns.cloudflare.com` and `damon.ns.cloudflare.com`, but neither had an A,
AAAA, or CNAME answer. Both HTTPS requests therefore failed at DNS resolution.
That is an acceptable pre-launch state and, importantly, does not expose a
non-compliant parked page on `learning.new`.

Recheck commands:

```bash
curl -i https://pubapi.registry.google/rdap/domain/exercisebook.app
curl -i https://pubapi.registry.google/rdap/domain/learning.new
```

IANA's [RDAP server
requirements](https://www.iana.org/help/rdap-requirements) specify a 200
response for an existing domain object and a 4xx response when the domain does
not exist in the RDAP service.

## Collision review

The name was screened through general Web search, education products, app
stores, and GitHub. No prominent exact-name adaptive-learning product using
`Exercise Book` as its standalone brand surfaced in the preliminary review.

This is not a trademark clearance. Ordinary-language names are inherently
difficult to protect and can coexist in unrelated or even adjacent uses.
Before substantial advertising or international commercial use, search the
relevant jurisdictions and service classes through resources such as
[J-PlatPat](https://www.j-platpat.inpit.go.jp/) and the [WIPO Global Brand
Database](https://branddb.wipo.int/), then obtain professional advice where the
risk justifies it.

## Operational checklist

- enable registrar lock, automatic renewal, account MFA, and recovery contacts;
- place DNS under the production Cloudflare account and enable DNSSEC;
- keep registration and renewal billing alerts separate from application
  monitoring;
- publish `exercisebook.app` as the canonical URL in metadata and sitemaps;
- keep `learning.new` non-resolving until its compliant action flow is ready;
- configure `learning.new` as an action-preserving redirect or Worker route;
- assign the repository owner to verify readiness by 2026-10-20 JST and treat
  2026-10-27 06:48:39 JST as the hard policy point; non-resolution is not an
  indefinite waiver after 100 days;
- add synthetic checks for the primary homepage and the complete `.new`
  creation flow;
- retain a documented non-`.new` path to the same action for debugging and
  accessibility;
- never depend on the `.new` redirect as the only way to create an exercise
  book.
